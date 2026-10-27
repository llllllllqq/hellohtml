// @ts-check
/**
 * 极简 ISO-BMFF（MP4/MOV/M4A）结构解析器，用于独立校验剪切器的输出。
 *
 * 只实现测试需要的部分：box 遍历、mvhd/mdhd 时长、轨道类型与编码、
 * stbl 索引（stts/stsc/stsz/stco/co64/stss），以及分片 MP4 的 moof/traf/trun。
 * 目标是“独立于被测代码”地检查容器是否自洽：
 *   - box 长度必须首尾闭合，不能越界；
 *   - 每个 chunk 的采样区间必须落在 mdat 之内；
 *   - 时长必须与切割区间吻合。
 */

/**
 * @typedef {{ type: string, start: number, size: number, header: number, end: number }} Box
 */

const CONTAINERS = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex',
  'moof', 'traf', 'mfra', 'udta', 'meta', 'ilst', 'stsd', 'wave',
]);

/**
 * 遍历一段缓冲区里的连续 box。
 * @param {Buffer} buf
 * @param {number} [start]
 * @param {number} [end]
 * @returns {Box[]}
 */
function walkBoxes(buf, start = 0, end = buf.length) {
  /** @type {Box[]} */
  const boxes = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) {
      throw new Error(`box "${type}" @${p} 长度非法（size=${size}，父级剩余 ${end - p} 字节）`);
    }
    boxes.push({ type, start: p, size, header, end: p + size });
    p += size;
  }
  if (p !== end) {
    throw new Error(`box 之间残留 ${end - p} 字节（@${p}），结构未闭合`);
  }
  return boxes;
}

/**
 * @param {Box[]} boxes
 * @param {string} type
 * @returns {Box | undefined}
 */
function findBox(boxes, type) {
  return boxes.find((b) => b.type === type);
}

/**
 * @param {Box[]} boxes
 * @param {string} type
 * @returns {Box[]}
 */
function findBoxes(boxes, type) {
  return boxes.filter((b) => b.type === type);
}

/**
 * @param {Buffer} buf
 * @param {Box} box
 * @returns {Box[]}
 */
function children(buf, box) {
  return walkBoxes(buf, box.start + box.header, box.end);
}

/**
 * moov/mvhd 或 trak/mdia/mdhd 的时长。
 * @param {Buffer} buf
 * @param {Box} box
 */
function readMdhd(buf, box) {
  const version = buf.readUInt8(box.start + box.header);
  const base = box.start + box.header + 4;
  let timescale;
  let duration;
  if (version === 1) {
    timescale = buf.readUInt32BE(base + 16);
    duration = Number(buf.readBigUInt64BE(base + 20));
  } else {
    timescale = buf.readUInt32BE(base + 8);
    duration = buf.readUInt32BE(base + 12);
  }
  return { version, timescale, duration, seconds: timescale ? duration / timescale : 0 };
}

/**
 * @param {Buffer} buf
 * @param {Box} stbl
 * @param {number} sampleCount
 */
function readStbl(buf, stbl, sampleCount) {
  const kids = children(buf, stbl);

  // stsd：第一条 entry 的 4 字符编码
  /** @type {string | null} */
  let codec = null;
  const stsd = findBox(kids, 'stsd');
  if (stsd) {
    const p = stsd.start + stsd.header + 8;
    if (p + 8 <= stsd.end) codec = buf.toString('latin1', p + 4, p + 8);
  }

  // stsz：采样大小
  /** @type {number[]} */
  const sampleSizes = [];
  const stsz = findBox(kids, 'stsz');
  if (stsz) {
    const p = stsz.start + stsz.header + 4;
    const fixed = buf.readUInt32BE(p);
    const count = buf.readUInt32BE(p + 4);
    for (let i = 0; i < count; i++) {
      sampleSizes.push(fixed || buf.readUInt32BE(p + 8 + i * 4));
    }
  }

  // stco / co64：chunk 偏移
  /** @type {number[]} */
  const chunkOffsets = [];
  const stco = findBox(kids, 'stco') || findBox(kids, 'co64');
  if (stco) {
    const p = stco.start + stco.header + 4;
    const count = buf.readUInt32BE(p);
    for (let i = 0; i < count; i++) {
      chunkOffsets.push(
        stco.type === 'co64' ? Number(buf.readBigUInt64BE(p + 4 + i * 8)) : buf.readUInt32BE(p + 4 + i * 4),
      );
    }
  }

  // stsc：chunk ↔ sample 的映射
  /** @type {Array<{ firstChunk: number, samplesPerChunk: number }>} */
  const stsc = [];
  const stscBox = findBox(kids, 'stsc');
  if (stscBox) {
    const p = stscBox.start + stscBox.header + 4;
    const count = buf.readUInt32BE(p);
    for (let i = 0; i < count; i++) {
      stsc.push({
        firstChunk: buf.readUInt32BE(p + 4 + i * 12),
        samplesPerChunk: buf.readUInt32BE(p + 4 + i * 12 + 4),
      });
    }
  }

  // 每个 chunk 的采样数
  /** @type {number[]} */
  const chunkSamples = [];
  for (let i = 0; i < chunkOffsets.length; i++) {
    const chunkNo = i + 1;
    let per = stsc.length ? stsc[0].samplesPerChunk : 0;
    for (const entry of stsc) if (entry.firstChunk <= chunkNo) per = entry.samplesPerChunk;
    chunkSamples.push(per);
  }

  // 每个 chunk 的字节数 = 其采样大小之和
  /** @type {number[]} */
  const chunkBytes = [];
  let sampleIdx = 0;
  for (const n of chunkSamples) {
    let sum = 0;
    for (let k = 0; k < n && sampleIdx < sampleSizes.length; k++) sum += sampleSizes[sampleIdx++];
    chunkBytes.push(sum);
  }

  const stss = findBox(kids, 'stss');
  let syncSamples = 0;
  if (stss) syncSamples = buf.readUInt32BE(stss.start + stss.header + 4);

  return {
    codec,
    sampleCount: sampleSizes.length,
    sampleBytes: sampleSizes.reduce((a, b) => a + b, 0),
    chunkOffsets,
    chunkBytes,
    syncSamples,
  };
}

/**
 * 解析并校验一个 MP4 文件。结构异常会直接抛错。
 * @param {Buffer} buf
 */
function parseMp4(buf) {
  if (buf.length < 16) throw new Error('文件太小，不是 MP4');
  const top = walkBoxes(buf);

  const ftyp = findBox(top, 'ftyp');
  const moov = findBox(top, 'moov');
  const moofs = findBoxes(top, 'moof');
  const mdats = findBoxes(top, 'mdat');
  if (!moov && !moofs.length) throw new Error('缺少 moov（也不是分片 MP4）');
  if (!mdats.length) throw new Error('缺少 mdat');

  const mdatRanges = mdats.map((b) => [b.start + b.header, b.end]);

  /** @type {{ duration: number, timescale: number } | null} */
  let movie = null;
  /** @type {Array<{ type: string, codec: string | null, duration: number, timescale: number, samples: number, sampleBytes: number, syncSamples: number }>} */
  const tracks = [];

  if (moov) {
    const moovKids = children(buf, moov);
    const mvhd = findBox(moovKids, 'mvhd');
    if (mvhd) {
      const v = readMdhd(buf, mvhd);
      movie = { duration: v.seconds, timescale: v.timescale };
    }
    for (const trak of findBoxes(moovKids, 'trak')) {
      const tk = children(buf, trak);
      const mdia = findBox(tk, 'mdia');
      if (!mdia) continue;
      const mdiaKids = children(buf, mdia);
      const mdhd = findBox(mdiaKids, 'mdhd');
      const hdlr = findBox(mdiaKids, 'hdlr');
      const minf = findBox(mdiaKids, 'minf');
      if (!mdhd || !hdlr || !minf) continue;
      const length = readMdhd(buf, mdhd);
      const handler = buf.toString('latin1', hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12);
      const minfKids = children(buf, minf);
      const stbl = findBox(minfKids, 'stbl');
      const stblInfo = stbl
        ? readStbl(buf, stbl, 0)
        : { codec: null, sampleCount: 0, sampleBytes: 0, chunkOffsets: [], chunkBytes: [], syncSamples: 0 };
      tracks.push({
        type: handler,
        codec: stblInfo.codec,
        duration: length.seconds,
        timescale: length.timescale,
        samples: stblInfo.sampleCount,
        sampleBytes: stblInfo.sampleBytes,
        syncSamples: stblInfo.syncSamples,
        // 供越界检查
        chunkOffsets: stblInfo.chunkOffsets,
        chunkBytes: stblInfo.chunkBytes,
      });
    }
  }

  // 采样数据必须落在 mdat 内（索引写错时的典型症状）
  for (const track of tracks) {
    for (let i = 0; i < track.chunkOffsets.length; i++) {
      const off = track.chunkOffsets[i];
      const len = track.chunkBytes[i];
      const inside = mdatRanges.some(([s, e]) => off >= s && off + len <= e);
      if (!inside) {
        throw new Error(
          `轨道 ${track.type} 的第 ${i + 1} 个 chunk 越界：offset=${off} bytes=${len}，mdat 范围 ${JSON.stringify(mdatRanges)}`,
        );
      }
    }
  }

  // 分片 MP4：每个 moof 必须有 traf，且 tfdt/trun 可读
  const fragments = moofs.map((moof) => {
    const kids = children(buf, moof);
    const trafs = findBoxes(kids, 'traf');
    if (!trafs.length) throw new Error('moof 内缺少 traf');
    const tfdt = trafs.map((traf) => {
      const t = findBox(children(buf, traf), 'tfdt');
      if (!t) return null;
      const v = buf.readUInt8(t.start + t.header);
      const base = t.start + t.header + 4;
      return v === 1 ? Number(buf.readBigUInt64BE(base)) : buf.readUInt32BE(base);
    });
    return { trafs: trafs.length, tfdt };
  });

  return {
    ftyp: ftyp ? buf.toString('latin1', ftyp.start + 8, ftyp.start + 12) : null,
    movie,
    tracks,
    mdatBytes: mdats.reduce((a, b) => a + b.size, 0),
    moovBeforeMdat: !!(moov && mdats.length && moov.start < mdats[0].start),
    fragmented: moofs.length > 0,
    fragments,
  };
}

/**
 * 抽取一条轨道在 mdat 里的全部采样字节（按 chunk 顺序拼接）。
 * 用于证明“不重编码”的格式确实是原始字节搬运（例如浏览器无法解码的 ALAC）。
 *
 * @param {Buffer} buf
 * @param {{ chunkOffsets: number[], chunkBytes: number[] }} track
 * @returns {Buffer}
 */
function extractSamples(buf, track) {
  const parts = [];
  for (let i = 0; i < track.chunkOffsets.length; i++) {
    const start = track.chunkOffsets[i];
    parts.push(buf.subarray(start, start + track.chunkBytes[i]));
  }
  return Buffer.concat(parts);
}

module.exports = { walkBoxes, parseMp4, extractSamples };
