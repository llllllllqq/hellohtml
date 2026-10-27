/* =====================================================================
 *  m4a.js — M4A / MP4 音频（AAC / ALAC / Opus / AC-3 …）解析与剪切
 *  从 MP4 box 引擎移植并简化为音频单轨：
 *   ftyp/moov(mvhd,trak(tkhd,mdia(mdhd,hdlr=soun,minf(stbl))))
 *   stbl: stsd(mp4a+esds | alac | opus+dops | ac-3+dac3 …) + stts/stsc/stsz/stco
 *  切割：按 stbl 样本表选取样本区间，重建索引，删除 edts，时长字段重算。
 * ===================================================================== */
(function(root, factory){
  const C = (typeof module !== 'undefined' && module.exports) ? require('./common.js') : root.ACCommon;
  const api = factory(C);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACM4a = api;
})(typeof self !== 'undefined' ? self : globalThis, function(C){
  'use strict';
  const { u32, u16, u64, fcc, w32, w64, setType, COLS, buildDensity, snapTo, snapEndTo } = C;

  const CONTAINERS = new Set(['moov','trak','mdia','minf','stbl','edts','dinf','udta']);
  const CODEC_NAME = {
    mp4a:'AAC', alac:'ALAC（Apple 无损）', opus:'Opus', 'ac-3':'AC-3（杜比）', 'ec-3':'E-AC-3（杜比）',
    samr:'AMR-NB', sawb:'AMR-WB', sowt:'PCM', twos:'PCM', lpcm:'LPCM', in24:'PCM 24-bit', 'mp4s':'MPEG-4 结构化音频'
  };

  function w64f(o, off, v){ w32(o, off, Math.floor(v / 4294967296)); w32(o, off + 4, v >>> 0); }

  function parseBoxes(b, start, end){
    const out = []; let p = start;
    while (p + 8 <= end){
      let size = u32(b, p), hs = 8;
      if (size === 1){ size = u64(b, p + 8); hs = 16; }
      else if (size === 0) size = end - p;
      if (size < 8 || p + size > end) break;
      out.push({ type: fcc(b, p + 4), start: p, size, hs, ds: p + hs, de: p + size });
      p += size;
    }
    return out;
  }
  function kids(b, box){
    if (!CONTAINERS.has(box.type)) return [];
    return parseBoxes(b, box.ds, box.de);
  }
  function findBox(boxes, t){ return boxes.find(x => x.type === t); }
  function boxView(b, box){ return b.subarray(box.start, box.start + box.size); }
  function leafBox(b, box){ return b.subarray(box.start, box.start + box.size).slice(); }

  /* ---- 采样表 ---- */
  function parseStts(b, box){
    const n = u32(b, box.ds + 4), a = [];
    for (let i = 0; i < n; i++){ const o = box.ds + 8 + i * 8; a.push([u32(b, o), u32(b, o + 4)]); }
    return a;
  }
  function parseStsc(b, box){
    const n = u32(b, box.ds + 4), a = [];
    for (let i = 0; i < n; i++){ const o = box.ds + 8 + i * 12; a.push({ first: u32(b, o), spc: u32(b, o + 4), desc: u32(b, o + 8) }); }
    return a;
  }
  function parseStsz(b, box){
    const ds = box.ds;
    const count = box.type === 'stz2' ? u32(b, ds + 4) : u32(b, ds + 8);
    const sizes = new Uint32Array(count);
    if (box.type === 'stz2'){
      const fs = b[ds + 3];
      for (let i = 0; i < count; i++){
        if (fs === 4) sizes[i] = (i & 1) ? (b[ds + 8 + ((i + 1) >> 1) - 1] & 0x0F) : (b[ds + 8 + (i >> 1)] >> 4);
        else if (fs === 8) sizes[i] = b[ds + 8 + i];
        else sizes[i] = u16(b, ds + 8 + i * 2);
      }
    } else {
      const ss = u32(b, ds + 4);
      if (ss !== 0) sizes.fill(ss);
      else for (let i = 0; i < count; i++) sizes[i] = u32(b, ds + 12 + i * 4);
    }
    const sampleSize = box.type === 'stz2' ? 0 : u32(b, ds + 4);
    return { sampleSize, count, sizes };
  }
  function parseStco(b, box, is64){
    const n = u32(b, box.ds + 4), a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = is64 ? u64(b, box.ds + 8 + i * 8) : u32(b, box.ds + 8 + i * 4);
    return a;
  }

  /* esds 里解析 AudioSpecificConfig（拿 AAC 采样率索引/声道，仅用于显示） */
  function parseEsdsInfo(b, esds){
    try{
      const ds = esds.ds;
      const flags = ((b[ds+1] << 16) | (b[ds+2] << 8) | b[ds+3]) >>> 0;
      let p = ds + 4;
      if (flags & 0x0001) p += 3;                     // ES_Descriptor
      const tag1 = b[p];
      if (tag1 === 0x03){ p += 1; while (b[p] & 0x80) p++; p += 1; p += 2; p += 1; p += 1; p += 1; p += 1; }
      if (b[p] === 0x04){ p += 1; while (b[p] & 0x80) p++; p += 1; p += 13; }  // DecoderConfig
      if (b[p] === 0x05){ p += 1; while (b[p] & 0x80) p++; p += 1; }           // DecSpecificInfo
      const asc0 = b[p], asc1 = b[p + 1];
      const srIdx = (asc0 >> 3) & 0xF;
      const ch = ((asc0 & 7) << 3) | ((asc1 >> 5) & 7);
      const SRI = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
      return { sampleRate: SRI[srIdx] || 0, channels: ch || 2 };
    }catch(e){ return null; }
  }

  /* alac box：magic cookie（仅用于显示） */
  function parseAlacInfo(b, alacBox){
    try{
      const d = alacBox.ds;
      return {
        bitDepth: b[d + 9],
        channels: b[d + 13],
        sampleRate: u32(b, d + 24),
        avgBitRate: u32(b, d + 20)
      };
    }catch(e){ return null; }
  }

  function parse(b){
    // 裸 AAC（ADTS）以 0xFFF 同步字开头，不是 MP4 容器，给出可执行的提示
    if (b.length > 2 && b[0] === 0xFF && (b[1] & 0xF6) === 0xF0)
      throw new Error('这是裸 AAC 流（ADTS），请先封装为 M4A：ffmpeg -i 输入.aac -c copy 输出.m4a');
    const top = parseBoxes(b, 0, b.length);
    if (top.some(x => x.type === 'moof')) throw new Error('暂不支持分片式（fMP4）音频，请先用 ffmpeg -i 输入 -c copy -movflags +faststart 输出.m4a 转换');
    const moov = findBox(top, 'moov');
    if (!moov) throw new Error('未找到 moov 索引（不是有效的 MP4/M4A 文件？）');
    const moovKids = kids(b, moov);
    const mvhd = findBox(moovKids, 'mvhd');
    if (!mvhd) throw new Error('moov 缺少 mvhd');
    const mvhdVer = b[mvhd.ds];
    const movieTs = u32(b, mvhd.ds + (mvhdVer === 1 ? 20 : 12));

    let trakBox = null;
    for (const t of moovKids.filter(x => x.type === 'trak')){
      const mdia = findBox(kids(b, t), 'mdia');
      const hdlr = mdia ? findBox(kids(b, mdia), 'hdlr') : null;
      if (hdlr && fcc(b, hdlr.ds + 8) === 'soun'){ trakBox = t; break; }
    }
    if (!trakBox) throw new Error('该文件没有音频轨道（纯视频请用视频版剪切器）');
    const tk = kids(b, trakBox);
    const tkhd = findBox(tk, 'tkhd');
    const tkhdVer = b[tkhd.ds];
    const trackId = u32(b, tkhd.ds + (tkhdVer === 1 ? 20 : 12));
    const mdia = findBox(tk, 'mdia');
    const mdhd = findBox(kids(b, mdia), 'mdhd');
    const mdhdVer = b[mdhd.ds];
    const ts = u32(b, mdhd.ds + (mdhdVer === 1 ? 20 : 12));   // 音频通常 = 采样率
    const hdlr = findBox(kids(b, mdia), 'hdlr');
    const minf = findBox(kids(b, mdia), 'minf');
    const stbl = findBox(kids(b, minf), 'stbl');
    const sb = kids(b, stbl);
    const stsd = findBox(sb, 'stsd');
    const stsdEntries = stsd ? parseBoxes(b, stsd.ds + 8, stsd.de) : [];
    const codec = stsdEntries.length ? fcc(b, stsdEntries[0].start + 4) : '????';

    let channels = 0, bitDepth = 0, esdsInfo = null, alacInfo = null;
    if (stsdEntries.length){
      const e = stsdEntries[0].ds;
      channels = u16(b, e + 16);
      bitDepth = u16(b, e + 18);
      const inner = parseBoxes(b, stsdEntries[0].ds + 8 + 20, stsdEntries[0].de);  // 跳过 SoundSampleEntry 头
      const esds = findBox(inner, 'esds');
      if (esds) esdsInfo = parseEsdsInfo(b, esds);
      const alacBox = findBox(inner, 'alac');
      if (alacBox) alacInfo = parseAlacInfo(b, alacBox);
    }
    if (alacInfo){ channels = alacInfo.channels || channels; bitDepth = alacInfo.bitDepth || bitDepth; }

    const sttsBox = findBox(sb, 'stts');
    const stscBox = findBox(sb, 'stsc');
    const stszBox = findBox(sb, 'stsz') || findBox(sb, 'stz2');
    const stcoBox = findBox(sb, 'stco'), co64Box = findBox(sb, 'co64');
    if (!sttsBox || !stscBox || !stszBox || (!stcoBox && !co64Box)) throw new Error('stbl 采样表不完整（可能是 DASH 分片）');

    const stts = parseStts(b, sttsBox);
    const stsc = parseStsc(b, stscBox);
    const { sampleSize, sizes } = parseStsz(b, stszBox);
    const offsets = parseStco(b, co64Box || stcoBox, !!co64Box);
    const N = sizes.length;

    /* 展开为逐样本索引（与视频剪切器相同的游标算法） */
    const dts = new Float64Array(N), dur = new Uint32Array(N), off = new Float64Array(N);
    let ti = 0, trem = stts.length ? stts[0][0] : 0, tdelta = stts.length ? stts[0][1] : 0;
    const nextDur = () => { if (trem === 0){ ti++; if (ti < stts.length){ trem = stts[ti][0]; tdelta = stts[ti][1]; } else { trem = 1; tdelta = 0; } } trem--; return tdelta; };
    let scIdx = 0, dtsT = 0, no = 0;
    for (let chunk = 1; chunk <= offsets.length && no < N; chunk++){
      while (scIdx + 1 < stsc.length && stsc[scIdx + 1].first <= chunk) scIdx++;
      const spc = stsc[scIdx].spc;
      let o = offsets[chunk - 1];
      for (let j = 0; j < spc && no < N; j++, no++){
        const sz = sizes[no];
        off[no] = o; o += sz;
        dur[no] = nextDur();
        dts[no] = dtsT; dtsT += dur[no];
      }
    }
    const duration = N ? (dts[N-1] + dur[N-1]) / ts : 0;

    /* 密度：样本大小映射到时间 bin */
    const points = [];
    for (let i = 0; i < N; i++) points.push([dts[i] / ts, sizes[i]]);
    const boundaries = [];
    for (let i = 0; i < N; i++) boundaries.push(dts[i] / ts);

    const avgBr = duration > 0 ? Math.round(sizes.reduce((s, v) => s + v, 0) * 8 / duration) : 0;
    const extra = [];
    extra.push(['容器', 'MP4 / M4A（ISO-BMFF）']);
    extra.push(['样本数', String(N)]);
    if (esdsInfo) extra.push(['AAC 参数', `${esdsInfo.sampleRate} Hz · ${esdsInfo.channels} 声道`]);
    const spfDur = N >= 2 ? (dts[1] - dts[0]) / ts : 1024 / ts;

    return {
      format: 'M4A', codec: CODEC_NAME[codec] || codec, ext: codec === 'alac' ? 'm4a' : 'm4a',
      mime: 'audio/mp4', duration,
      sampleRate: ts, channels: channels || esdsInfo?.channels || 2, bitDepth: bitDepth || null,
      bitrate: avgBr, vbr: false,
      density: buildDensity(points, duration),
      boundaries, boundaryLabel: `样本级（约 ${(spfDur * 1000).toFixed(1)}ms）`,
      _trak: trakBox, _tkhd: tkhd, _mdhd: mdhd, _mvhd: mvhd, _movieTs: movieTs, _mdhdTs: ts,
      _stsd: stsd, _stbl: stbl, _n: N, _dts: dts, _dur: dur, _off: off, _sizes: sizes,
      _sampleSize: sampleSize, _codec: codec, _top: top, _moov: moov, _moovKids: moovKids,
      extra, buf: b
    };
  }

  /* ---- 输出构建 ---- */
  function makeBox(type, children){
    let len = 8; for (const c of children) len += c.length;
    const out = new Uint8Array(len);
    w32(out, 0, len); setType(out, 4, type);
    let p = 8; for (const c of children){ out.set(c, p); p += c.length; }
    return out;
  }
  function makeStts(t, s, e){
    const ent = []; let i = s;
    while (i <= e){ let j = i; while (j + 1 <= e && t._dur[j+1] === t._dur[i]) j++; ent.push([j - i + 1, t._dur[i]]); i = j + 1; }
    const out = new Uint8Array(16 + ent.length * 8);
    w32(out, 0, out.length); setType(out, 4, 'stts'); w32(out, 12, ent.length);
    ent.forEach(([c, d], k) => { w32(out, 16 + k * 8, c); w32(out, 20 + k * 8, d); });
    return out;
  }
  function makeStsc(t, s, e){
    // 输出布局：每个样本独立成 chunk（与 stco 的逐样本偏移一致）
    const out = new Uint8Array(16 + 12);
    w32(out, 0, out.length); setType(out, 4, 'stsc'); w32(out, 12, 1);
    w32(out, 16, 1); w32(out, 20, 1); w32(out, 24, 1);   // first_chunk=1, spc=1, desc=1
    return out;
  }
  function makeStsz(t, s, e){
    const count = e - s + 1;
    let uniform = t._sampleSize | 0;
    if (uniform){ for (let i = s; i <= e; i++) if (t._sizes[i] !== uniform){ uniform = 0; break; } }
    const out = new Uint8Array(uniform ? 20 : 20 + count * 4);
    w32(out, 0, out.length); setType(out, 4, 'stsz');
    w32(out, 12, uniform); w32(out, 16, count);
    if (!uniform) for (let i = s; i <= e; i++) w32(out, 20 + (i - s) * 4, t._sizes[i]);
    return out;
  }
  function makeStco(offsets, use64){
    const n = offsets.length, out = new Uint8Array(use64 ? 16 + n * 8 : 16 + n * 4);
    w32(out, 0, out.length); setType(out, 4, use64 ? 'co64' : 'stco'); w32(out, 12, n);
    for (let i = 0; i < n; i++){ if (use64) w64f(out, 16 + i * 8, offsets[i]); else w32(out, 16 + i * 4, offsets[i]); }
    return out;
  }

  function emitBox(b, box, ctx){
    if (ctx.skip.has(box.start)) return null;
    // 仅保留选中的音频轨：视频轨/其它音轨的 chunk 偏移在重排后必然失效，必须丢弃
    if (box.type === 'trak' && ctx.keepTrak !== undefined && box.start !== ctx.keepTrak) return null;
    const rep = ctx.replaceStbl.get(box.start);
    if (rep) return makeBox('stbl', rep);
    const pd = ctx.patchDur.get(box.start);
    if (pd){
      const c = boxView(b, box).slice();
      if (pd.len === 4) w32(c, pd.off, pd.val >>> 0); else w64f(c, pd.off, pd.val);
      return c;
    }
    if (CONTAINERS.has(box.type)){
      const parts = [];
      for (const c of kids(b, box)){ const e = emitBox(b, c, ctx); if (e) parts.push(e); }
      if (!parts.length) return null;
      return makeBox(box.type, parts);
    }
    return leafBox(b, box);
  }

  function cut(b, info, start, end){
    const N = info._n;
    // 样本区间：起点 = 第一个 dts/ts >= start；终点 = 最后一个 (dts+dur)/ts <= end
    let s = 0;
    while (s < N && info._dts[s] / info._mdhdTs < start - 1e-9) s++;
    let e = N - 1;
    while (e >= s && (info._dts[e] + info._dur[e]) / info._mdhdTs > end + 1e-9) e--;
    if (e < s) e = Math.min(N - 1, s);
    const t0 = info._dts[s] / info._mdhdTs;
    const t1 = (info._dts[e] + info._dur[e]) / info._mdhdTs;

    // 每 chunk 一个样本（简化 stsc：spc=1）
    const nSamp = e - s + 1;
    let totalBytes = 0;
    for (let i = s; i <= e; i++) totalBytes += info._sizes[i];

    const ftyp = info._top.find(x => x.type === 'ftyp');
    const ftypPart = ftyp ? boxView(b, ftyp) : new Uint8Array(0);

    let use64 = false, moovOut = null;
    for (let iter = 0; iter < 4; iter++){
      const ctx = { skip: new Set(), replaceStbl: new Map(), patchDur: new Map(), keepTrak: info._trak.start };
      // 输出时间轴上的结束点（相对首个保留样本 DTS）
      const base = info._dts[s];
      let decEnd = 0;
      for (let i = s; i <= e; i++){ const d = info._dts[i] + info._dur[i] - base; if (d > decEnd) decEnd = d; }
      // 删除 edts
      for (const c of kids(b, info._trak)) if (c.type === 'edts') ctx.skip.add(c.start);
      // 时长修补
      const maxDurSec = decEnd / info._mdhdTs;
      const mvhdVer = b[info._mvhd.ds];
      ctx.patchDur.set(info._mvhd.start, { off: mvhdVer === 1 ? 32 : 24, len: mvhdVer === 1 ? 8 : 4, val: Math.round(maxDurSec * info._movieTs) });
      const tkhdVer = b[info._tkhd.ds];
      ctx.patchDur.set(info._tkhd.start, { off: tkhdVer === 1 ? 36 : 28, len: tkhdVer === 1 ? 8 : 4, val: Math.round(maxDurSec * info._movieTs) });
      const mdhdVer = b[info._mdhd.ds];
      ctx.patchDur.set(info._mdhd.start, { off: mdhdVer === 1 ? 32 : 24, len: mdhdVer === 1 ? 8 : 4, val: decEnd });
      // stbl 内容
      const parts = [leafBox(b, info._stsd), makeStts(info, s, e), makeStsc(info, s, e), makeStsz(info, s, e), null];
      ctx.replaceStbl.set(info._stbl.start, parts);

      // 先以占位 stco 构建，确定 moov 尺寸
      const dummy = new Array(nSamp).fill(0);
      parts[4] = makeStco(dummy, false);
      moovOut = emitBox(b, info._moov, ctx);
      const mdatHdr = (ftypPart.length + moovOut.length + totalBytes + 8 > 0xFFFFFFFF) ? 16 : 8;
      const base2 = ftypPart.length + moovOut.length + mdatHdr;
      const offsets = [];
      let run = base2;
      for (let i = s; i <= e; i++){ offsets.push(run); run += info._sizes[i]; }
      if (!use64 && run > 0xFFFFFFFF){ use64 = true; continue; }
      // 第二遍：真实偏移
      const ctx2 = { skip: new Set(), replaceStbl: new Map(), patchDur: new Map(), keepTrak: info._trak.start };
      const parts2 = [leafBox(b, info._stsd), makeStts(info, s, e), makeStsc(info, s, e), makeStsz(info, s, e), makeStco(offsets, use64)];
      ctx2.replaceStbl.set(info._stbl.start, parts2);
      ctx2.skip = ctx.skip; ctx2.patchDur = ctx.patchDur;
      moovOut = emitBox(b, info._moov, ctx2);
      break;
    }

    const mdatSize = totalBytes + (use64 ? 16 : 8);
    const mdatHdr = new Uint8Array(use64 ? 16 : 8);
    if (use64){ w32(mdatHdr, 0, 1); setType(mdatHdr, 4, 'mdat'); w64f(mdatHdr, 8, mdatSize); }
    else { w32(mdatHdr, 0, mdatSize); setType(mdatHdr, 4, 'mdat'); }

    const parts = [ftypPart, moovOut, mdatHdr];
    for (let i = s; i <= e; i++) parts.push(b.subarray(info._off[i], info._off[i] + info._sizes[i]));
    const size = ftypPart.length + moovOut.length + mdatHdr.length + totalBytes;
    return { parts, size, t0, t1 };
  }

  return { parse, cut, parseBoxes, kids, findBox };
});
