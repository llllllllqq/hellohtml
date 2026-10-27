/* =====================================================================
 *  ogg.js — OGG 容器（Vorbis / Opus）解析与剪切
 *  要点：
 *   - OggS page 解析：granule(64 LE) / serial / seq / CRC32(MPEG-2)
 *   - 逻辑包重组（seg=255 延续、页 continued 标志）
 *   - Vorbis：保留 id/comment/setup 三头包；Opus：保留 OpusHead/OpusTags
 *   - 切割：页边界吸附；continued 页向前扩展到包起始页；
 *           重写 page_seq、granule 重基（Opus 保留 pre-skip）、EOS 标志、CRC32
 * ===================================================================== */
(function(root, factory){
  const C = (typeof module !== 'undefined' && module.exports) ? require('./common.js') : root.ACCommon;
  const api = factory(C);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACOgg = api;
})(typeof self !== 'undefined' ? self : globalThis, function(C){
  'use strict';
  const { u32, u16, u32le, u16le, w32le, w64le, COLS, buildDensity } = C;

  /* ---- CRC-32/MPEG-2（OGG 专用：poly 0x04C11DB7，init 0，无反射，xorout 0） ---- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++){
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
      t[i] = r >>> 0;
    }
    return t;
  })();
  function crc32(b, from, to){
    let c = 0;
    for (let i = from; i < to; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ b[i]) & 0xFF]) >>> 0;
    return c;
  }

  function parsePageHeader(b, o){
    if (o + 27 > b.length) return null;
    if (b[o] !== 0x4F || b[o+1] !== 0x67 || b[o+2] !== 0x67 || b[o+3] !== 0x53) return null; // 'OggS'
    if (b[o+4] !== 0) return null;                       // version
    const htype = b[o+5];
    const granule = u32le(b, o+6) + u32le(b, o+10) * 4294967296;   // 64bit LE（JS number 安全范围）
    const granuleSigned = (granule === 0xFFFFFFFFFFFFFFFF) ? -1 : granule;
    const serial = u32le(b, o+14);
    const seq = u32le(b, o+18);
    const crc = u32le(b, o+22);                              // OGG CRC 字段为小端
    const nsegs = b[o+26];
    if (o + 27 + nsegs > b.length) return null;
    let dataLen = 0;
    for (let i = 0; i < nsegs; i++) dataLen += b[o+27+i];
    const start = o + 27 + nsegs;
    const end = start + dataLen;
    if (end > b.length) return null;
    return { off: o, htype, granule: granuleSigned, serial, seq, crc, nsegs, segTableOff: o+27, start, end, size: end - o };
  }

  function parse(b){
    if (b.length < 64 || b[0] !== 0x4F || b[1] !== 0x67 || b[2] !== 0x67 || b[3] !== 0x53)
      throw new Error('不是有效的 OGG 文件（缺少 OggS 头）');

    /* ---- 遍历页 ---- */
    const pages = [];
    let o = 0;
    while (o < b.length){
      const p = parsePageHeader(b, o);
      if (!p) break;
      pages.push(p);
      o = p.end;
    }
    if (pages.length < 3) throw new Error('OGG 页数量过少（文件损坏？）');

    /* ---- 主流 serial（第一个 BOS 页） ---- */
    const bosPage = pages.find(p => p.htype & 0x02);
    if (!bosPage) throw new Error('未找到 BOS 页');
    const serial = bosPage.serial;
    const stream = pages.filter(p => p.serial === serial);

    /* ---- 重组逻辑包，识别编码头 ---- */
    let codec = null, preSkip = 0, sampleRate = 0, channels = 0, bitrateNom = 0;
    let firstAudioIdx = -1, lastAudioGranule = -1;
    let pkt = [], pktStartPage = -1;
    for (let i = 0; i < stream.length; i++){
      const pg = stream[i];
      if (pktStartPage === -1) pktStartPage = i;
      pkt.push(b.subarray(pg.start, pg.end));
      // 判断包是否完整：该页最后一个 seg 值 < 255
      const lastSeg = b[pg.segTableOff + pg.nsegs - 1];
      if (lastSeg === 255) continue;                      // 包延续到下一页
      // 完整包：拼接
      const total = pkt.reduce((s, x) => s + x.length, 0);
      const full = new Uint8Array(total);
      let fp = 0;
      for (const x of pkt){ full.set(x, fp); fp += x.length; }
      // 头包 magic 识别
      const isVorbisId  = full.length >= 30 && full[0] === 1 && C.fcc(full, 1) === 'vorb';
      const isVorbisCmt = full.length >= 7  && full[0] === 3 && C.fcc(full, 1) === 'vorb';
      const isVorbisSet = full.length >= 7  && full[0] === 5 && C.fcc(full, 1) === 'vorb';
      const isOpusHead  = full.length >= 19 && C.fcc(full, 0) === 'Opus' && C.fcc(full, 4) === 'Head';
      const isOpusTags  = full.length >= 8  && C.fcc(full, 0) === 'Opus' && C.fcc(full, 4) === 'Tags';
      if (isVorbisId){
        codec = 'Vorbis';
        channels = full[11];
        sampleRate = u32le(full, 12);
        bitrateNom = u32le(full, 20);
        if (bitrateNom < 0) bitrateNom = 0;
      } else if (isOpusHead){
        codec = 'Opus';
        channels = full[9];
        preSkip = u16le(full, 10);
        sampleRate = u32le(full, 12);
      } else if (!isVorbisCmt && !isVorbisSet && !isOpusTags){
        // 第一个非头包 = 第一个音频包
        if (firstAudioIdx === -1) firstAudioIdx = pktStartPage;
      }
      if (firstAudioIdx !== -1 && i >= firstAudioIdx && pg.granule >= 0) lastAudioGranule = pg.granule;
      pkt = []; pktStartPage = -1;
    }
    if (!codec) throw new Error('未识别到 Vorbis/Opus 音频流（其它 OGG 封装格式暂不支持）');
    if (firstAudioIdx === -1) throw new Error('未找到音频页');

    const rate = codec === 'Opus' ? 48000 : sampleRate;
    const duration = codec === 'Opus'
      ? (lastAudioGranule >= 0 ? (lastAudioGranule - preSkip) / 48000 : 0)
      : (lastAudioGranule >= 0 ? lastAudioGranule / sampleRate : 0);

    /* 页时间轴：音频页时间 = granule 换算（页尾时间） */
    const boundaries = [];
    const points = [];
    for (let i = firstAudioIdx; i < stream.length; i++){
      const pg = stream[i];
      const t = pg.granule < 0 ? null
        : (codec === 'Opus' ? (pg.granule - preSkip) / 48000 : pg.granule / sampleRate);
      if (t === null || t < 0) continue;
      boundaries.push(t);
      points.push([t, pg.end - pg.start]);
    }
    if (!boundaries.length) throw new Error('音频页无有效 granule');

    const extra = [];
    extra.push(['容器', 'OGG（OggS 页）']);
    extra.push(['页统计', `${stream.length} 页 · serial ${serial}`]);
    extra.push(['声道', String(channels)]);
    if (codec === 'Opus') extra.push(['预跳样本', `${preSkip}（48kHz 域）`]);
    if (bitrateNom) extra.push(['标称码率', (bitrateNom / 1000).toFixed(0) + ' kbps']);
    const pageDur = boundaries.length > 1 ? boundaries[1] - boundaries[0] : 0.02;
    extra.push(['切割精度', `页边界（约 ${(pageDur * 1000).toFixed(0)}ms）`]);

    return {
      format: 'OGG', codec: codec === 'Opus' ? 'Opus' : 'Vorbis', ext: codec === 'Opus' ? 'opus' : 'ogg',
      mime: 'audio/ogg', duration, sampleRate: rate, channels, bitDepth: null,
      bitrate: duration > 0 ? Math.round(b.length * 8 / duration) : 0, vbr: true,
      density: buildDensity(points, duration),
      boundaries, boundaryLabel: `页边界（约 ${(pageDur * 1000).toFixed(0)}ms）`,
      _pages: pages, _stream: stream, _serial: serial, _codec: codec, _preSkip: preSkip,
      _rate: rate, _vorbisRate: sampleRate, _firstAudioIdx: firstAudioIdx,
      extra, buf: b
    };
  }

  /* 起点页：第一个页尾时间 >= start 的音频页；continued 页向前扩展到包起始页 */
  function pickStartPage(info, start){
    const S = info._stream;
    const pb = info._boundariesPb || (info._boundariesPb = S.map(pg => pg.granule < 0 ? null
      : (info._codec === 'Opus' ? (pg.granule - info._preSkip) / 48000 : pg.granule / info._vorbisRate)));
    let idx = info._firstAudioIdx;
    for (let i = info._firstAudioIdx; i < S.length; i++){
      const t = pb[i];
      if (t !== null && t >= start - 1e-9){ idx = i; break; }
      if (t !== null) idx = i;
    }
    // continued 链向前扩展
    while (idx > info._firstAudioIdx && (S[idx].htype & 0x01)){
      // 前一页必须存在且同 serial
      idx--;
      // 若前一页不是 continued 结尾（seg 全 <255），它自身就是完整包起点
      const pg = S[idx];
      const lastSeg = info.buf[pg.segTableOff + pg.nsegs - 1];
      if (lastSeg !== 255) break;                        // 该页结束一个完整包
    }
    return idx;
  }

  function cut(b, info, start, end){
    const S = info._stream;
    const sIdx = pickStartPage(info, start);          // 内部初始化 _boundariesPb
    const pb = info._boundariesPb;
    // 终点页：最后一个页尾时间 <= end 的页
    let eIdx = sIdx;
    for (let i = sIdx; i < S.length; i++){
      const t = pb[i];
      if (t !== null && t <= end + 1e-9) eIdx = i;
    }
    if (eIdx < sIdx) eIdx = Math.min(S.length - 1, sIdx);

    /* 重基基准：起点页的“页头位置”= 前一页 granule（页粒度切割会保留整页数据，
       声明区间须如实反映实际输出，而非页尾差） */
    const isOpus = info._codec === 'Opus';
    const baseGranule = (sIdx > 0 && S[sIdx-1].granule >= 0) ? S[sIdx-1].granule
                      : (isOpus ? info._preSkip : 0);
    const t0 = Math.max(0, (baseGranule - (isOpus ? info._preSkip : 0)) / info._rate);
    const t1 = pb[eIdx] !== null ? Math.max(t0, pb[eIdx]) : info.duration;

    /* 头页（id/comment/setup）：主流中 firstAudioIdx 之前的页原样保留 */
    const headPages = [];
    for (let i = 0; i < info._firstAudioIdx; i++) headPages.push(S[i]);

    const parts = [];
    let seq = 0;
    const pushPage = (pg, patch) => {
      const src = b.subarray(pg.off, pg.end);
      const out = src.slice();
      // patch granule（小端 64 位）
      if (patch.granule !== undefined){
        w64le(out, 6, Math.max(0, Math.round(patch.granule)));
      }
      // patch htype
      out[5] = patch.htype !== undefined ? patch.htype : out[5];
      // patch seq（小端 32 位）
      w32le(out, 18, seq++);
      // 重算 CRC（字段先清零；OGG CRC 为小端存储）
      w32le(out, 22, 0);
      w32le(out, 22, crc32(out, 0, out.length));
      parts.push(out);
      return out.length;
    };

    let size = 0;
    for (const pg of headPages){
      size += pushPage(pg, { htype: (pg.htype & ~0x04) });   // 头页清 EOS
    }
    for (let i = sIdx; i <= eIdx; i++){
      const pg = S[i];
      const isLast = (i === eIdx);
      let htype = pg.htype & ~0x04;                        // 先清 EOS
      if (isLast) htype |= 0x04;                           // 最后一页置 EOS
      // granule 重基：以起点页页头为 0（Opus 保留 pre-skip 语义）
      let granule;
      if (pg.granule < 0) granule = undefined;             // 无效 granule 的页保持原样
      else {
        const g = pg.granule - baseGranule;
        granule = isOpus ? g + info._preSkip : g;
      }
      size += pushPage(pg, { htype, granule });
    }
    return { parts, size, t0, t1 };
  }

  return { parse, cut, parsePageHeader, crc32 };
});
