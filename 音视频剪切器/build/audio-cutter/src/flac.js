/* =====================================================================
 *  flac.js — FLAC 解析与剪切
 *  要点：
 *   - metadata block 解析（STREAMINFO 重写 / SEEKTABLE 丢弃 / 其余原样保留）
 *   - 帧头扫描：14bit sync + 字段合法性 + UTF-8 coded number
 *     （fixed blocking 验证帧号、variable 验证累计采样号）双校验防假阳性
 *   - FLAC 帧长无法从头解析，用“下一合法帧头”定界
 *   - 切割：帧边界吸附；STREAMINFO.totalSamples 重写、MD5 置零
 * ===================================================================== */
(function(root, factory){
  const C = (typeof module !== 'undefined' && module.exports) ? require('./common.js') : root.ACCommon;
  const api = factory(C);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACFlac = api;
})(typeof self !== 'undefined' ? self : globalThis, function(C){
  'use strict';
  const { u32, u16, u24, w32, w16, COLS, buildDensity } = C;

  const BS_CODE = [0, 192, 576, 1152, 2304, 4608, -1, -1, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
  const SR_CODE = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000, -1, -1, -1, -1];
  const BPS_CODE = [0, 8, 12, 0, 16, 20, 24, 32];

  function isSync(b, o){ return b[o] === 0xFF && (b[o+1] & 0xFC) === 0xF8; }

  /* 解析 UTF-8 coded number（FLAC 变体），返回 {value, len} */
  function utf8num(b, o){
    const c = b[o];
    let len, bits;
    if (c < 0x80){ len = 1; bits = 7; }
    else if (c < 0xC0){ return null; }
    else if (c < 0xE0){ len = 2; bits = 5; }
    else if (c < 0xF0){ len = 3; bits = 4; }
    else if (c < 0xF8){ len = 4; bits = 3; }
    else if (c < 0xFC){ len = 5; bits = 2; }
    else if (c < 0xFE){ len = 6; bits = 1; }
    else { return null; }
    if (o + len > b.length) return null;
    let v = c & ((1 << bits) - 1);
    for (let i = 1; i < len; i++){
      const cc = b[o + i];
      if ((cc & 0xC0) !== 0x80) return null;
      v = (v << 6) | (cc & 0x3F);
    }
    return { value: v, len };
  }

  /* 解析帧头，返回信息或 null */
  function parseFrameHeader(b, o, streamSr){
    if (!isSync(b, o)) return null;
    if (o + 4 > b.length) return null;
    const blocking = (b[o+1] >> 1) & 1;                 // 0=fixed(帧号) 1=variable(采样号)
    const bsCode = (b[o+2] >> 4) & 0xF;
    const srCode = b[o+2] & 0xF;
    const chCode = (b[o+3] >> 4) & 0xF;
    const bpsCode = (b[o+3] >> 1) & 0x7;
    if (bsCode === 0 || srCode === 0xF || chCode > 10 || bpsCode === 3) return null;
    const u = utf8num(b, o + 4);
    if (!u) return null;
    let p = o + 4 + u.len;
    let bs = BS_CODE[bsCode];
    if (bsCode === 6){ if (p + 1 > b.length) return null; bs = b[p] + 1; p += 1; }
    else if (bsCode === 7){ if (p + 2 > b.length) return null; bs = u16(b, p) + 1; p += 2; }
    let sr = SR_CODE[srCode];
    if (srCode === 12){ if (p + 1 > b.length) return null; sr = b[p] * 1000; p += 1; }
    else if (srCode === 13){ if (p + 2 > b.length) return null; sr = u16(b, p); p += 2; }
    else if (srCode === 14){ if (p + 2 > b.length) return null; sr = u16(b, p) * 10; p += 2; }
    else if (srCode === 0) sr = streamSr;
    const bps = BPS_CODE[bpsCode];
    if (!sr || !bs || !bps) return null;
    p += 1;                                              // CRC-8
    const headerLen = p - o;
    return { off: o, headerLen, blocking, bs, sr, bps, channels: chCode <= 7 ? chCode + 1 : 2, num: u.value };
  }

  function parse(b){
    // 部分工具会给 FLAC 加 ID3v2 前缀，先跳过
    let base = 0;
    if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33){
      const sz = ((b[6] & 0x7F) << 21) | ((b[7] & 0x7F) << 14) | ((b[8] & 0x7F) << 7) | (b[9] & 0x7F);
      base = 10 + sz + ((b[5] & 0x10) ? 10 : 0);
    }
    if (b.length < base + 8 || b[base] !== 0x66 || b[base+1] !== 0x4C || b[base+2] !== 0x61 || b[base+3] !== 0x43)
      throw new Error('不是有效的 FLAC 文件（缺少 fLaC 头）');

    /* ---- metadata blocks ---- */
    const blocks = [];
    let p = base + 4, last = false, streamInfo = null;
    while (!last && p + 4 <= b.length){
      const hdr = b[p];
      last = (hdr & 0x80) !== 0;
      const type = hdr & 0x7F;
      const len = u24(b, p + 1);
      const start = p + 4;
      if (start + len > b.length) throw new Error('FLAC metadata block 越界（文件可能损坏）');
      const blk = { type, start, len, raw: b.subarray(start, start + len) };
      blocks.push(blk);
      if (type === 0){
        if (len < 34) throw new Error('STREAMINFO 长度无效');
        const d = blk.raw;
        const sr = (d[10] << 12) | (d[11] << 4) | (d[12] >> 4);
        const ch = ((d[12] >> 1) & 7) + 1;
        const bps = (((d[12] & 1) << 4) | (d[13] >> 4)) + 1;
        const total = ((d[13] & 0x0F) * 4294967296) + (d[14] * 16777216) + (d[15] * 65536) + (d[16] * 256) + d[17];
        streamInfo = { sampleRate: sr, channels: ch, bitDepth: bps, totalSamples: total,
                       minBlock: u16(d, 0), maxBlock: u16(d, 2) };
      }
      p = start + len;
    }
    if (!streamInfo) throw new Error('缺少 STREAMINFO block');
    const audioStart = p;

    /* ---- 帧扫描 ----
     * 注意：切割产物从任意帧开始，帧内编号不会是 0，因此首个有效帧作为锚点，
     * 之后按“编号连续”双验证；不能假定起点编号为 0。 */
    const frames = [];
    let o = audioStart, expectSample = -1, expectFrame = -1, anchored = false;
    let guard = b.length;
    while (o < b.length - 4 && guard-- > 0){
      if (!isSync(b, o)){ o++; continue; }
      const h = parseFrameHeader(b, o, streamInfo.sampleRate);
      if (!h){ o++; continue; }
      if (!anchored){
        expectSample = h.num; expectFrame = h.num; anchored = true;   // 以首帧编号为基准
      } else if (h.blocking === 0){
        if (h.num !== expectFrame){ o++; continue; }
      } else {
        if (h.num !== expectSample){ o++; continue; }
      }
      // 找下一帧头定界
      let end = b.length;
      let q = o + h.headerLen;
      while (q < b.length - 1){
        if (isSync(b, q)){
          const h2 = parseFrameHeader(b, q, streamInfo.sampleRate);
          if (h2){
            const expectNextSample = expectSample + h.bs;
            const expectNextFrame = expectFrame + 1;
            const okNext = h2.blocking === 0 ? h2.num === expectNextFrame : h2.num === expectNextSample;
            if (okNext){ end = q; break; }
          }
        }
        q++;
      }
      frames.push({ off: o, end, samples: h.bs, blocking: h.blocking });
      expectSample += h.bs;
      expectFrame += 1;
      o = end;
    }
    if (!frames.length) throw new Error('未找到有效的 FLAC 音频帧');

    const sr = streamInfo.sampleRate;
    const ts = new Float64Array(frames.length);
    let t = 0, totalSamples = 0;
    const points = [];
    for (let i = 0; i < frames.length; i++){
      ts[i] = t;
      totalSamples += frames[i].samples;
      points.push([t, frames[i].end - frames[i].off]);
      t += frames[i].samples / sr;
    }
    const duration = streamInfo.totalSamples > 0 ? streamInfo.totalSamples / sr : t;
    const avgBr = duration > 0 ? Math.round((b.length - audioStart) * 8 / duration) : 0;

    const extra = [];
    extra.push(['容器', 'FLAC（原生）']);
    extra.push(['块大小', `${streamInfo.minBlock} ~ ${streamInfo.maxBlock} 样本`]);
    extra.push(['帧统计', `${frames.length} 帧 · ${frames[0].blocking ? '可变块' : '固定块'}`]);
    if (streamInfo.totalSamples) extra.push(['样本总数', String(streamInfo.totalSamples)]);
    extra.push(['切割精度', `帧边界（约 ${(frames[0].samples / sr * 1000).toFixed(0)}ms）`]);

    return {
      format: 'FLAC', codec: 'FLAC（无损压缩）', ext: 'flac', mime: 'audio/flac',
      duration, sampleRate: sr, channels: streamInfo.channels, bitDepth: streamInfo.bitDepth,
      bitrate: avgBr, vbr: true,
      density: buildDensity(points, duration),
      boundaries: ts, boundaryLabel: `帧边界（约 ${(frames[0].samples / sr * 1000).toFixed(0)}ms）`,
      _blocks: blocks, _streamInfo: streamInfo, _frames: frames, _audioStart: audioStart, _ts: ts,
      _keepBlockTypes: new Set([0, 1, 2, 4, 5, 6]),   // STREAMINFO/VORBIS_COMMENT/PICTURE/CUESHEET/APPLICATION 保留；SEEKTABLE(3) 丢弃
      extra, buf: b
    };
  }

  function cut(b, info, start, end){
    const F = info._frames, sr = info.sampleRate;
    const ts = info._ts;
    // 帧区间
    let s = 0;
    while (s < F.length && ts[s] < start - 1e-9) s++;
    let e = F.length - 1;
    while (e >= s && ts[e] > end - 1e-9) e--;
    if (e < s) e = Math.min(F.length - 1, s);
    const t0 = ts[s];
    const t1 = ts[e] + F[e].samples / sr;
    let keepSamples = 0;
    for (let i = s; i <= e; i++) keepSamples += F[i].samples;

    /* ---- 头部：fLaC + metadata blocks ---- */
    const parts = [];
    const keptBlocks = info._blocks.filter(bl => info._keepBlockTypes.has(bl.type));
    const header = new Uint8Array(4 + keptBlocks.reduce((sum, bl) => sum + 4 + bl.len, 0));
    header[0] = 0x66; header[1] = 0x4C; header[2] = 0x61; header[3] = 0x43;   // 'fLaC'
    let hp = 4;
    keptBlocks.forEach((bl, i) => {
      const isLast = i === keptBlocks.length - 1;
      header[hp] = (isLast ? 0x80 : 0) | bl.type; hp += 1;
      header[hp] = (bl.len >> 16) & 0xFF; header[hp+1] = (bl.len >> 8) & 0xFF; header[hp+2] = bl.len & 0xFF; hp += 3;
      if (bl.type === 0){
        // 重写 STREAMINFO：totalSamples + MD5 置零
        const si = bl.raw.slice();
        si[13] = (si[13] & 0xF0) | ((keepSamples / 4294967296) & 0x0F);
        si[14] = (keepSamples / 16777216) & 0xFF;
        si[15] = (keepSamples / 65536) & 0xFF;
        si[16] = (keepSamples / 256) & 0xFF;
        si[17] = keepSamples & 0xFF;
        si.fill(0, 18, 34);                             // MD5 置零（不重算，播放器自动忽略）
        header.set(si, hp);
      } else {
        header.set(bl.raw, hp);
      }
      hp += bl.len;
    });
    parts.push(header);

    for (let i = s; i <= e; i++) parts.push(b.subarray(F[i].off, F[i].end));
    const size = parts.reduce((s2, p2) => s2 + p2.length, 0);
    return { parts, size, t0, t1 };
  }

  return { parse, cut, parseFrameHeader, utf8num };
});
