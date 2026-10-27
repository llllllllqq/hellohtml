/* =====================================================================
 *  wav.js — WAV / RIFF WAVE 解析与剪切
 *  结构：'RIFF' <u32 size> 'WAVE'，随后若干 chunk：
 *    'fmt ' 格式（audioFormat/channels/sampleRate/byteRate/blockAlign/bits）
 *    'data' PCM/float 数据
 *    'fact'（非 PCM 的样本数）/ 'LIST' / 'cue ' 等其它 chunk 原样保留
 *  切割：data 区间按 blockAlign 对齐截取，头部 chunk 原样保留，
 *        重写 RIFF size / data size / fact sample count。
 * ===================================================================== */
(function(root, factory){
  const C = (typeof module !== 'undefined' && module.exports) ? require('./common.js') : root.ACCommon;
  const api = factory(C);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACWav = api;
})(typeof self !== 'undefined' ? self : globalThis, function(C){
  'use strict';
  const { u32, u16, i16, w32, u32le, u16le, i16le, w32le, COLS, buildDensity } = C;

  const FMT_NAME = {
    1: 'PCM', 3: 'PCM (IEEE float)', 6: 'A-law', 7: 'µ-law', 0xFFFE: 'PCM (extensible)'
  };

  function parse(b){
    const isRf64 = b.length >= 12 && C.fcc(b, 0) === 'RF64';
    if (b.length < 12 || C.fcc(b, 8) !== 'WAVE' || (!isRf64 && C.fcc(b, 0) !== 'RIFF'))
      throw new Error('不是有效的 WAV 文件（缺少 RIFF/WAVE 头）');
    // RF64（>4GB 或 -rf64 always 产物）：真实数据长度在紧跟 WAVE 的 ds64 chunk 里
    let rf64DataSize = -1;
    if (isRf64 && C.fcc(b, 12) === 'ds64' && u32le(b, 16) >= 16){
      const base = 20;   // 12(RIFF头) + 8(ds64 chunk 头)
      rf64DataSize = u32le(b, base + 8) + u32le(b, base + 12) * 4294967296;
    }
    const chunks = [];
    let p = 12;
    while (p + 8 <= b.length){
      const type = C.fcc(b, p);                 // RIFF chunk: ID 在前（区别于 MP4 box 的 size 在前）
      let size = u32le(b, p + 4);               // RIFF 为小端
      if (type === 'data' && size === 0xFFFFFFFF && rf64DataSize >= 0) size = rf64DataSize;
      if (p + 8 + size > b.length) size = b.length - p - 8;   // 容忍截断文件
      chunks.push({ type, off: p, size, ds: p + 8 });
      p += 8 + size + (size & 1);                              // chunk 按 2 字节对齐
    }
    const fmt = chunks.find(c => c.type === 'fmt ');
    if (!fmt) throw new Error('WAV 文件缺少 fmt chunk');
    const data = chunks.find(c => c.type === 'data');
    if (!data) throw new Error('WAV 文件缺少 data chunk');
    const fact = chunks.find(c => c.type === 'fact');

    const audioFormat = u16le(b, fmt.ds);
    const channels = u16le(b, fmt.ds + 2);
    const sampleRate = u32le(b, fmt.ds + 4);
    let byteRate = u32le(b, fmt.ds + 8);
    let blockAlign = u16le(b, fmt.ds + 12);
    const bits = u16le(b, fmt.ds + 14);
    // 部分录音设备把 blockAlign/byteRate 写成 0，按格式参数推导，避免时长与切割全错
    if (!blockAlign) blockAlign = Math.max(1, channels * Math.ceil(Math.max(bits, 8) / 8));
    if (!byteRate) byteRate = sampleRate * blockAlign;
    const dataSize = data.size;
    if (!sampleRate || !channels) throw new Error('fmt chunk 参数无效');
    if (!dataSize) throw new Error('data chunk 为空（0 字节），文件不含音频数据');
    const duration = dataSize / byteRate;

    /* 波形包络：在 data 区 stride 采样求绝对幅度（PCM16/float32 精确，其它用字节幅度） */
    const points = [];
    const stride = Math.max(1, Math.floor(dataSize / 2000));
    const N = Math.floor(dataSize / stride);
    for (let i = 0; i < N; i++){
      const o = data.ds + i * stride;
      let amp;
      if (audioFormat === 3 && bits === 32){
        const dv = new DataView(b.buffer, b.byteOffset + o, 4);
        amp = Math.abs(dv.getFloat32(0, true));
      } else if (audioFormat === 3 && bits === 64){
        const dv = new DataView(b.buffer, b.byteOffset + o, 8);
        amp = Math.min(1, Math.abs(dv.getFloat64(0, true)));
      } else if ((audioFormat === 1 || audioFormat === 0xFFFE) && bits === 16){
        amp = Math.abs(i16le(b, o));
      } else if ((audioFormat === 1 || audioFormat === 0xFFFE) && bits === 8){
        amp = Math.abs(b[o] - 128) / 128;
      } else if (bits === 24){
        const v = (b[o] | (b[o+1] << 8) | (b[o+2] << 16)) << 8 >> 8;
        amp = Math.abs(v / 8388608);
      } else if (bits === 32){
        amp = Math.abs(i16le(b, o + 2));
      } else {
        amp = Math.abs(b[o] - 128) / 128;
      }
      points.push([i * stride / byteRate, amp]);
    }

    const extra = [];
    extra.push(['容器', isRf64 ? 'RF64（输出转为标准 RIFF）' : 'RIFF / WAVE']);
    extra.push(['采样格式', `${FMT_NAME[audioFormat] || ('0x' + audioFormat.toString(16))} ${bits}-bit`]);
    extra.push(['块对齐', blockAlign + ' 字节']);
    extra.push(['切割精度', '样本级（块对齐）']);
    if (fact) extra.push(['样本总数', String(u32le(b, fact.ds))]);

    return {
      format: 'WAV', codec: FMT_NAME[audioFormat] || 'WAV', ext: 'wav', mime: 'audio/wav',
      duration, sampleRate, channels, bitDepth: bits, bitrate: byteRate * 8, vbr: false,
      density: buildDensity(points, duration),
      boundaries: [], boundaryLabel: '样本级精确（按块对齐）',
      _chunks: chunks, _fmt: fmt, _data: data, _fact: fact,
      _audioFormat: audioFormat, _blockAlign: blockAlign,
      extra, buf: b
    };
  }

  /* start/end：秒。返回 {parts,size,t0,t1} */
  function cut(b, info, start, end){
    const ba = info._blockAlign;
    const byteRate = info.sampleRate * ba;
    let s0 = Math.round(start * byteRate);
    let e0 = Math.round(end * byteRate);
    s0 = Math.max(0, Math.min(s0, info._data.size));
    e0 = Math.max(s0 + ba, Math.min(e0, info._data.size));
    s0 -= s0 % ba; e0 -= e0 % ba;                     // 块对齐
    if (e0 <= s0) e0 = Math.min(info._data.size, s0 + ba);
    // 起点贴尾导致空区间时，回退一个块保证输出至少含 1 个样本（空 data 多数播放器不认）
    if (e0 <= s0 && info._data.size >= ba){ s0 = info._data.size - ba; e0 = info._data.size; }
    const keep = e0 - s0;
    const t0 = s0 / byteRate, t1 = e0 / byteRate;

    const parts = [];
    let total = 0;
    let dataSeen = 0;
    // RIFF 头（chunk 遍历不含它，需单独构造并重写 size）；RF64 输入输出一律降级为 RIFF
    const riffHdr = b.slice(0, 12);
    C.setType(riffHdr, 0, 'RIFF');
    parts.push(riffHdr); total += 12;
    for (const c of info._chunks){
      if (c.type === 'ds64') continue;                  // RF64 专用块，RIFF 下无意义
      if (c.type === 'data'){
        // 仅首个 data chunk 承载切片；多 data chunk 时其余写成空块，避免重复音频
        const seg = (dataSeen === 0) ? { s: s0, e: e0 } : { s: 0, e: 0 };
        const n = seg.e - seg.s;
        dataSeen++;
        // data chunk：重写 size（小端），只保留截取区间；奇数长度补 pad 字节
        const hdr = b.slice(c.off, c.off + 8);
        const pad = n & 1;
        const out = new Uint8Array(8 + n + pad);
        out.set(hdr, 0);
        w32le(out, 4, n);
        if (n) out.set(b.subarray(info._data.ds + seg.s, info._data.ds + seg.e), 8);
        parts.push(out); total += out.length;
      } else if (c.type === 'fact'){
        // fact 原样整块保留（含 pad），仅在其 size >= 4 时改写样本数
        const len = 8 + c.size + (c.size & 1);
        const out = new Uint8Array(len);
        out.set(b.subarray(c.off, Math.min(c.off + len, b.length)), 0);
        if (c.size >= 4) w32le(out, 8, Math.round(keep / ba));
        parts.push(out); total += out.length;
      } else {
        // 其它 chunk 整块保留并补齐 pad 字节（RIFF 规定 chunk 按 2 字节对齐，
        // 丢掉 pad 会让后续 chunk 头整体错位，输出即损坏）
        const len = 8 + c.size + (c.size & 1);
        const out = new Uint8Array(len);
        out.set(b.subarray(c.off, Math.min(c.off + len, b.length)), 0);
        parts.push(out); total += out.length;
      }
    }
    // 重写 RIFF 总长（第一个 chunk 即 RIFF 头，size 在 off+4，小端）
    w32le(parts[0], 4, total - 8);
    return { parts, size: total, t0, t1 };
  }

  return { parse, cut };
});
