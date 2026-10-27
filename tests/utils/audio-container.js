// @ts-check
/**
 * 音频容器结构的独立校验器（不依赖被测页面、也不依赖 ffmpeg）。
 *
 * 目的：确认剪切器输出的是“结构自洽、可被解析”的容器，而不是碰巧能播的字节流。
 *   - WAV：RIFF size 与 chunk 首尾必须闭合（含奇数长度 chunk 的 pad）；
 *   - MP3：逐帧走完，帧长/采样率一致，时长与声明的切割区间吻合；
 *   - FLAC：STREAMINFO 可读，样本总数与切割区间吻合；
 *   - OGG：逐页校验 CRC32/MPEG-2、页序号连续，末页 granule 给出时长；
 *   - M4A/MP4：见 utils/mp4.js。
 */

/**
 * @param {Buffer} buf
 */
function parseWav(buf) {
  if (buf.length < 12) throw new Error('WAV 太短');
  const riff = buf.toString('latin1', 0, 4);
  const wave = buf.toString('latin1', 8, 12);
  if (riff !== 'RIFF' && riff !== 'RF64') throw new Error(`缺少 RIFF 头（实际 ${JSON.stringify(riff)}）`);
  if (wave !== 'WAVE') throw new Error(`缺少 WAVE 标识（实际 ${JSON.stringify(wave)}）`);

  const riffSize = buf.readUInt32LE(4);
  /** @type {Array<{ id: string, size: number, start: number }>} */
  const chunks = [];
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    chunks.push({ id, size, start: p + 8 });
    p += 8 + size + (size & 1);
  }
  if (p !== buf.length) {
    throw new Error(`chunk 遍历未闭合：走到 ${p}，文件长度 ${buf.length}（丢 pad 或长度错位）`);
  }
  if (riffSize !== buf.length - 8) {
    throw new Error(`RIFF size=${riffSize} 与文件长度-8=${buf.length - 8} 不一致`);
  }

  const fmt = chunks.find((c) => c.id === 'fmt ');
  const data = chunks.find((c) => c.id === 'data');
  if (!fmt) throw new Error('缺少 fmt chunk');
  if (!data) throw new Error(`缺少 data chunk（实际 chunks: ${chunks.map((c) => c.id).join(',')}）`);

  const audioFormat = buf.readUInt16LE(fmt.start);
  const channels = buf.readUInt16LE(fmt.start + 2);
  const sampleRate = buf.readUInt32LE(fmt.start + 4);
  const blockAlign = buf.readUInt16LE(fmt.start + 12);
  const bitsPerSample = buf.readUInt16LE(fmt.start + 14);
  // blockAlign 为 0 的异常文件按格式参数推导
  const align = blockAlign || Math.max(1, Math.ceil((bitsPerSample * channels) / 8));
  return {
    chunks: chunks.map((c) => `${c.id}:${c.size}`),
    audioFormat,
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    dataStart: data.start,
    dataSize: data.size,
    duration: sampleRate && align ? data.size / align / sampleRate : 0,
  };
}

const MP3_BITRATES = {
  // [mpeg1, mpeg2/2.5][layer III]
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

/**
 * @param {Buffer} buf
 */
function parseMp3(buf) {
  let p = 0;
  let id3Size = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    id3Size = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
    p = id3Size;
  }

  /** @type {number[]} */
  const frameOffsets = [];
  let sampleRate = 0;
  let channels = 0;
  let samplesPerFrame = 0;
  let firstFrameHasXing = false;
  let mpegVersion = 0;

  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) {
      // 尾部可能有 ID3v1 等，只要已经解析到帧就停
      if (frameOffsets.length === 0) throw new Error(`@${p} 找不到 MP3 帧同步字`);
      break;
    }
    const b1 = buf[p + 1];
    const b2 = buf[p + 2];
    const b3 = buf[p + 3];
    const verBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    if (verBits === 1 || layerBits !== 1) {
      if (frameOffsets.length === 0) throw new Error(`@${p} 帧头非法（version=${verBits} layer=${layerBits}）`);
      break;
    }
    mpegVersion = verBits === 3 ? 1 : 2;
    const srIdx = (b2 >> 2) & 0x03;
    const brIdx = (b2 >> 4) & 0x0f;
    const padding = (b2 >> 1) & 0x01;
    if (srIdx === 3 || brIdx === 0 || brIdx === 15) {
      if (frameOffsets.length === 0) throw new Error(`@${p} 采样率/码率索引非法`);
      break;
    }
    const sr = MP3_RATES[verBits][srIdx];
    const bitrate = MP3_BITRATES[mpegVersion][brIdx] * 1000;
    const frameLen = Math.floor(((mpegVersion === 1 ? 144 : 72) * bitrate) / sr) + padding;
    if (frameLen < 4 || p + frameLen > buf.length) {
      if (frameOffsets.length === 0) throw new Error(`@${p} 帧长度越界`);
      break;
    }
    if (frameOffsets.length === 0) {
      sampleRate = sr;
      channels = (b3 >> 6) === 3 ? 1 : 2;
      samplesPerFrame = mpegVersion === 1 ? 1152 : 576;
      const sideInfo = mpegVersion === 1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;
      const tag = buf.toString('latin1', p + 4 + sideInfo, p + 4 + sideInfo + 4);
      firstFrameHasXing = tag === 'Xing' || tag === 'Info';
    }
    frameOffsets.push(p);
    p += frameLen;
  }
  if (!frameOffsets.length) throw new Error('没有解析到任何 MP3 帧');

  const audioFrames = frameOffsets.length - (firstFrameHasXing ? 1 : 0);
  return {
    frames: frameOffsets.length,
    audioFrames,
    firstFrameHasXing,
    id3Size,
    sampleRate,
    channels,
    trailingBytes: buf.length - (frameOffsets[frameOffsets.length - 1] + 0),
    duration: (audioFrames * samplesPerFrame) / sampleRate,
  };
}

/**
 * 从任意 bit 偏移处读取大端无符号整数。
 * @param {Buffer} buf
 * @param {number} bitOffset
 * @param {number} bits
 */
function readBits(buf, bitOffset, bits) {
  let value = 0;
  for (let i = 0; i < bits; i++) {
    const bit = (buf[(bitOffset + i) >> 3] >> (7 - ((bitOffset + i) & 7))) & 1;
    value = value * 2 + bit;
  }
  return value;
}

/**
 * @param {Buffer} buf
 */
function parseFlac(buf) {
  if (buf.toString('latin1', 0, 4) !== 'fLaC') throw new Error('缺少 fLaC 标识');
  let p = 4;
  /** @type {Array<{ type: number, size: number }>} */
  const blocks = [];
  /** @type {{ sampleRate: number, channels: number, bitsPerSample: number, totalSamples: number } | null} */
  let streamInfo = null;
  for (;;) {
    if (p + 4 > buf.length) throw new Error('元数据块被截断');
    const header = buf[p];
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const size = (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    const dataStart = p + 4;
    if (dataStart + size > buf.length) throw new Error(`元数据块 type=${type} 越界`);
    blocks.push({ type, size });
    if (type === 0) {
      if (size < 34) throw new Error('STREAMINFO 长度异常');
      const base = dataStart * 8;
      const sampleRate = readBits(buf, base + 80, 20);
      const channels = readBits(buf, base + 100, 3) + 1;
      const bitsPerSample = readBits(buf, base + 103, 5) + 1;
      const totalSamples = readBits(buf, base + 108, 36);
      streamInfo = { sampleRate, channels, bitsPerSample, totalSamples };
    }
    p = dataStart + size;
    if (last) break;
  }
  if (!streamInfo) throw new Error('缺少 STREAMINFO');
  return {
    blocks: blocks.map((b) => `${b.type}:${b.size}`),
    ...streamInfo,
    metadataEnd: p,
    duration: streamInfo.sampleRate ? streamInfo.totalSamples / streamInfo.sampleRate : 0,
  };
}

/** CRC-32/MPEG-2（多项式 0x04C11DB7，非反射，初值 0，无终值异或） */
const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 24;
    for (let j = 0; j < 8; j++) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
    table[i] = crc >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} end
 */
function oggCrc(buf, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) crc = ((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) & 0xff) ^ buf[i]];
  return crc >>> 0;
}

/**
 * @param {Buffer} buf
 * @param {number} sampleRate 用于换算 granule（Opus 固定 48k）
 */
function parseOgg(buf, sampleRate) {
  /** @type {Array<{ seq: number, granule: number, crcOk: boolean, headerType: number, offset: number, end: number }>} */
  const pages = [];
  let p = 0;
  while (p + 27 <= buf.length) {
    if (buf.toString('latin1', p, p + 4) !== 'OggS') {
      if (pages.length === 0) throw new Error(`@${p} 不是 OggS 页头`);
      break;
    }
    if (buf[p + 4] !== 0) throw new Error(`@${p} Ogg 版本号非 0`);
    const headerType = buf[p + 5];
    const granule = buf.readBigUInt64LE(p + 6);
    const seq = buf.readUInt32LE(p + 18);
    const storedCrc = buf.readUInt32LE(p + 22);
    const segments = buf[p + 26];
    let bodyLen = 0;
    for (let i = 0; i < segments; i++) bodyLen += buf[p + 27 + i];
    const pageEnd = p + 27 + segments + bodyLen;
    if (pageEnd > buf.length) throw new Error(`@${p} 页长度越界（${pageEnd} > ${buf.length}）`);

    // CRC 计算时把 CRC 字段当作 0
    const copy = Buffer.from(buf.subarray(p, pageEnd));
    copy.writeUInt32LE(0, 22);
    const crcOk = oggCrc(copy, 0, copy.length) === storedCrc;
    pages.push({ seq, granule: Number(granule), crcOk, headerType, offset: p, end: pageEnd });
    p = pageEnd;
  }
  if (!pages.length) throw new Error('没有解析到 Ogg 页');
  const badCrc = pages.filter((x) => !x.crcOk);
  const last = pages[pages.length - 1];
  const granuleRate = sampleRate || 48000;
  return {
    pages: pages.length,
    badCrc: badCrc.length,
    lastGranule: last.granule,
    eos: (last.headerType & 0x04) !== 0,
    seqStart: pages[0].seq,
    seqContiguous: pages.every((page, i) => page.seq === pages[0].seq + i),
    trailingBytes: buf.length - p,
    duration: last.granule / granuleRate,
  };
}

module.exports = { parseWav, parseMp3, parseFlac, parseOgg, oggCrc };
