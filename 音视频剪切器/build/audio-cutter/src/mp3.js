/* =====================================================================
 *  mp3.js — MP3 (MPEG-1/2/2.5 Layer III) 解析与剪切
 *  要点：
 *   - 保留 ID3v2 头 / ID3v1 尾原样
 *   - 帧扫描：同步字 + 比特率/采样率表 + 帧长公式 + 下一帧头交叉验证
 *   - Xing/Info/VBRI 识别（VBR 头帧）
 *   - 切割：帧边界吸附；源有 Xing 时在新输出第一帧重写 Xing（frames/bytes，无 TOC）
 *   - 已知物理特性：起点前 1~2 帧因比特库依赖可能有极轻微杂音
 * ===================================================================== */
(function(root, factory){
  const C = (typeof module !== 'undefined' && module.exports) ? require('./common.js') : root.ACCommon;
  const api = factory(C);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACMp3 = api;
})(typeof self !== 'undefined' ? self : globalThis, function(C){
  'use strict';
  const { u32, u16, w32, setType, COLS, buildDensity, snapTo, snapEndTo } = C;

  // 比特率表 (kbps)
  const BR_MPEG1_L3 = [32,40,48,56,64,80,96,112,128,160,192,224,256,320];
  const BR_MPEG2_L3 = [8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const SR = { 3:[44100,48000,32000], 2:[22050,24000,16000], 0:[11025,12000,8000] }; // key: version bits
  const VER_NAME = { 3:'MPEG-1', 2:'MPEG-2', 0:'MPEG-2.5' };
  const MODE_NAME = ['立体声','联合立体声','双声道','单声道'];

  function parseHeader(b, o){
    if (b[o] !== 0xFF || (b[o+1] & 0xE0) !== 0xE0) return null;
    const verBits = (b[o+1] >> 3) & 3;      // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
    const layerBits = (b[o+1] >> 1) & 3;    // 1=Layer III
    if (verBits === 1 || layerBits !== 1) return null;
    const brIdx = (b[o+2] >> 4) & 0xF;
    const srIdx = (b[o+2] >> 2) & 3;
    const pad = (b[o+2] >> 1) & 1;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
    const bitrate = (verBits === 3 ? BR_MPEG1_L3 : BR_MPEG2_L3)[brIdx - 1] * 1000;
    const sampleRate = SR[verBits][srIdx];
    const modeBits = (b[o+3] >> 6) & 3;
    const samples = verBits === 3 ? 1152 : 576;
    // Layer III 帧长：MPEG1: 144*br/sr，MPEG2/2.5: 72*br/sr（+padding）
    const frameLen = Math.floor((verBits === 3 ? 144 : 72) * bitrate / sampleRate) + pad;
    if (frameLen < 24 || o + frameLen > b.length + 1) return null;  // +1 容忍末帧截断
    return { verBits, layerBits, bitrate, sampleRate, pad, modeBits, samples, frameLen,
             mono: modeBits === 3, crc: ((b[o+1] & 1) === 0) };
  }

  function parse(b){
    /* ---- ID3v2 头 ---- */
    let pos = 0, id3v2 = null;
    if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33){
      const flags = b[5];
      const size = ((b[6] & 0x7F) << 21) | ((b[7] & 0x7F) << 14) | ((b[8] & 0x7F) << 7) | (b[9] & 0x7F);
      let end = 10 + size;
      if (flags & 0x10) end += 10;               // footer
      id3v2 = { off: 0, len: end };
      pos = end;
    }
    /* ---- ID3v1 尾 ---- */
    let id3v1 = null;
    if (b.length >= 128 && b[b.length-128] === 0x54 && b[b.length-128+1] === 0x41 && b[b.length-128+2] === 0x47){
      id3v1 = { off: b.length - 128, len: 128 };
    }
    const scanEnd = id3v1 ? id3v1.off : b.length;

    /* ---- 帧扫描 ---- */
    const frames = [];
    let firstFrameHdr = null, xing = null, vbri = null, lastGood = -1;
    let o = pos;
    // 跳过开头的 padding/垃圾（最多一定范围）
    let guard = 0;
    while (o + 4 <= scanEnd && guard++ < 100000){
      const h = parseHeader(b, o);
      if (!h){ o++; continue; }
      // 交叉验证：下一帧头（若空间足够）——防止假阳性
      let ok = true;
      const next = o + h.frameLen;
      if (next + 4 <= scanEnd && next <= b.length - 4){
        const h2 = parseHeader(b, next);
        if (!h2) ok = false;
        else if (frames.length > 0 && (h2.sampleRate !== frames[frames.length-1].h.sampleRate || h2.modeBits !== h.modeBits)) ok = false;
      } else if (next < b.length && next + 4 > b.length){
        ok = true;                                  // 末帧（截断容忍）
      }
      if (!ok){ o++; continue; }
      if (!firstFrameHdr) firstFrameHdr = h;
      frames.push({ off: o, size: h.frameLen, samples: h.samples, h });
      lastGood = frames.length - 1;
      o = next;
      if (o >= scanEnd) break;
    }
    if (!frames.length) throw new Error('未找到有效的 MPEG 音频帧（不是 MP3 文件？）');

    /* ---- Xing / Info / VBRI（在第一帧内搜索） ---- */
    {
      const f = frames[0], h = f.h;
      const sideInfo = (h.verBits === 3 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17)) + (h.crc ? 2 : 0);
      const start = f.off + 4 + sideInfo;
      const limit = Math.min(f.off + f.size - 8, start + 256);
      for (let q = Math.max(start, f.off + 4); q + 4 <= limit; q++){
        const tag = C.fcc(b, q);
        if (tag === 'Xing' || tag === 'Info'){
          const flags = u32(b, q + 4);
          let p = q + 8, nFrames = 0, nBytes = 0;
          if (flags & 1){ nFrames = u32(b, p); p += 4; }
          if (flags & 2){ nBytes = u32(b, p); p += 4; }
          xing = { off: q, tag, flags, frames: nFrames, bytes: nBytes, frameIdx: 0 };
          break;
        }
        if (tag === 'VBRI'){ vbri = { off: q, frameIdx: 0 }; break; }
      }
    }

    /* ---- 时间轴 ---- */
    const sr = frames[0].h.sampleRate;
    const spf = frames[0].h.samples;
    let t = 0;
    const boundaries = new Array(frames.length);
    for (let i = 0; i < frames.length; i++){
      boundaries[i] = t;
      t += frames[i].samples / sr;
    }
    const duration = t;
    const totalBytes = frames.reduce((s, f) => s + f.size, 0) + (id3v2 ? id3v2.len : 0) + (id3v1 ? id3v1.len : 0);
    const avgBr = duration > 0 ? Math.round(totalBytes * 8 / duration) : firstFrameHdr.bitrate;
    const cbr = frames.every(f => f.h.bitrate === frames[0].h.bitrate);

    const points = frames.map((f, i) => [boundaries[i], f.size]);
    const extra = [];
    extra.push(['容器', `MPEG 音频${id3v2 ? ' + ID3v2' : ''}${id3v1 ? ' + ID3v1' : ''}`]);
    extra.push(['帧统计', `${frames.length} 帧 · ${spf} 样本/帧`]);
    extra.push(['码率类型', cbr ? 'CBR 恒定' : 'VBR 可变' + (xing ? '（Xing/Info 头）' : (vbri ? '（VBRI 头）' : ''))]);
    extra.push(['声道模式', MODE_NAME[frames[0].h.modeBits]]);
    extra.push(['切割精度', `帧边界（${(spf / sr * 1000).toFixed(0)}ms）`]);

    return {
      format: 'MP3', codec: 'MP3 (MPEG-1/2 Layer III)', ext: 'mp3', mime: 'audio/mpeg',
      duration, sampleRate: sr, channels: frames[0].h.mono ? 1 : 2, bitDepth: null,
      bitrate: avgBr, vbr: !cbr,
      density: buildDensity(points, duration),
      boundaries, boundaryLabel: `帧边界（${(spf / sr * 1000).toFixed(0)}ms）`,
      _frames: frames, _id3v2: id3v2, _id3v1: id3v1, _xing: xing, _vbri: vbri, _cbr: cbr,
      extra, buf: b
    };
  }

  /* 帧索引：起点 = 第一个 t >= start 的帧；终点 = 最后一个 t+dur <= end 的帧 */
  function frameTime(F, sr){
    const ts = new Float64Array(F.length);
    let t = 0;
    for (let i = 0; i < F.length; i++){ ts[i] = t; t += F[i].samples / sr; }
    return ts;
  }

  function cut(b, info, start, end){
    const F = info._frames, sr = info.sampleRate;
    const ts = frameTime(F, sr);
    let s = 0;
    while (s < F.length && ts[s] < start - 1e-9) s++;
    let e = F.length - 1;
    while (e >= s && ts[e] + F[e].samples / sr > end + 1e-9) e--;
    if (e < s) e = Math.min(F.length - 1, s);
    // 保证至少保留 3 帧：Xing/Info 信息帧不含有效音频数据，ffmpeg 探测不将其计入，
    // 需再保留两个真实音频帧才能通过"连续两帧"校验
    if (e < s + 2) e = Math.min(F.length - 1, s + 2);
    const t0 = ts[s], t1 = ts[e] + F[e].samples / sr;

    const parts = [];
    if (info._id3v2) parts.push(b.subarray(info._id3v2.off, info._id3v2.off + info._id3v2.len));

    const keep = [];
    for (let i = s; i <= e; i++) keep.push(i);
    // 若源有 Xing，在新输出第一帧内、与源 Xing 相同的相对位置重写 Xing
    // （无论源 Xing 帧是被切掉还是被保留——保留时旧帧数/字节数已失真，必须重写）
    let xingNew = null;
    if (info._xing && info._xing.frameIdx !== undefined && keep.length){
      const rel = info._xing.off - F[info._xing.frameIdx].off;
      // 新第一帧必须放得下 Xing 头（tag+flags+frames+bytes 共 16 字节）
      if (rel >= 0 && rel + 16 <= F[keep[0]].size){
        xingNew = { frameIdx: keep[0], rel, nFrames: keep.length, nBytes: 0 };
      }
    }
    // VBRI 从不重写：若其所在帧被保留，抹掉标签避免解析器读到过期帧数
    let vbriClear = null;
    if (info._vbri && info._vbri.frameIdx !== undefined && s <= info._vbri.frameIdx && info._vbri.frameIdx <= e){
      vbriClear = { frameIdx: info._vbri.frameIdx, rel: info._vbri.off - F[info._vbri.frameIdx].off };
    }

    let bytes = 0;
    for (const i of keep){
      let seg;
      if (xingNew && i === xingNew.frameIdx){
        seg = new Uint8Array(F[i].size);
        seg.set(b.subarray(F[i].off, F[i].off + F[i].size), 0);
        // flags = frames|bytes（无 TOC，合法）；frames/bytes 大端
        const q = xingNew.rel;
        C.setType(seg, q, info._xing.tag);
        w32(seg, q + 4, 0x0003);
        w32(seg, q + 8, xingNew.nFrames);
        w32(seg, q + 12, xingNew.nBytes);   // bytes 稍后回填
        xingNew._segRef = seg; xingNew._q = q;
      } else if (vbriClear && i === vbriClear.frameIdx){
        seg = new Uint8Array(F[i].size);
        seg.set(b.subarray(F[i].off, F[i].off + F[i].size), 0);
        C.setType(seg, vbriClear.rel, 'None');   // 抹掉 VBRI 标签，解析器改按码率估算时长
      } else {
        seg = b.subarray(F[i].off, F[i].off + F[i].size);
      }
      bytes += seg.length;
      parts.push(seg);
    }
    if (xingNew && xingNew._segRef) w32(xingNew._segRef, xingNew._q + 12, bytes);
    if (info._id3v1) parts.push(b.subarray(info._id3v1.off, info._id3v1.off + info._id3v1.len));

    const size = parts.reduce((s2, p) => s2 + p.length, 0);
    return { parts, size, t0, t1 };
  }

  return { parse, cut, parseHeader };
});
