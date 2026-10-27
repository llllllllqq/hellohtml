// @ts-check
/**
 * 音视频剪切器测试的公共工具：
 *   - 夹具路径；
 *   - 在页面内直接调用剪切器的格式模块（window.ACxxx）做单元级切割；
 *   - 用浏览器 WebAudio 解码 PCM，做内容级校验（替代原 Python 测试里的 ffmpeg）；
 *   - 通过真实 UI（上传 → 填时间 → 剪切 → 下载）走用户路径。
 *
 * 夹具由 tests/fixtures/cutter/generate.sh 生成并随仓库提交，CI 不需要 ffmpeg。
 */
const fs = require('node:fs');
const path = require('node:path');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'cutter');
const AUDIO_DIR = path.join(FIXTURES, 'audio');
const VIDEO_DIR = path.join(FIXTURES, 'video');

const CUTTER_DIR = '音视频剪切器';
const AUDIO_PAGE = `/${encodeURIComponent(CUTTER_DIR)}/audio-stream-cutter.html`;
const VIDEO_PAGE = `/${encodeURIComponent(CUTTER_DIR)}/video-stream-cutter.html`;

/** 服务器根目录下的夹具 URL（页面内 fetch 用，避免大文件通过 RPC 传输） */
const AUDIO_URL = `/${encodeURIComponent('tests')}/fixtures/cutter/audio`;
const VIDEO_URL = `/${encodeURIComponent('tests')}/fixtures/cutter/video`;

/** 9 种“容器 × 编码”组合，全部为 8 秒夹具，默认切 2s → 6s */
const AUDIO_MATRIX = [
  { file: 'test.wav', label: 'WAV / PCM 16bit 44.1k 立体声' },
  { file: 'test.mp3', label: 'MP3 / CBR 128k' },
  { file: 'test_vbr.mp3', label: 'MP3 / VBR' },
  { file: 'test.m4a', label: 'M4A / AAC' },
  { file: 'test_alac.m4a', label: 'M4A / ALAC' },
  { file: 'test_opus.m4a', label: 'M4A / Opus' },
  { file: 'test.flac', label: 'FLAC / 16bit' },
  { file: 'test.ogg', label: 'OGG / Vorbis' },
  { file: 'test_opus.ogg', label: 'OGG / Opus 48k' },
];

/** 多样化的“真实世界”文件 */
const AUDIO_DIVERSE = [
  { file: 'mono.mp3', label: '单声道 48k 无 Xing 头' },
  { file: 'bigmeta.mp3', label: '5KB ID3v2 大标签' },
  { file: 'ogg_bigcomment.ogg', label: '跨页大 Vorbis 注释' },
  { file: 'wav_float32.wav', label: 'WAV float32' },
  { file: 'wav_8bit.wav', label: 'WAV 8bit 22.05k' },
  { file: 'wav_24bit.wav', label: 'WAV 24bit（EXTENSIBLE）' },
];

const VIDEO_MATRIX = [
  { file: 'v1_default.mp4', label: '默认布局（moov 在尾部）', tracks: 2, fragmented: false },
  { file: 'v2_faststart.mp4', label: 'faststart（moov 前置）', tracks: 2, fragmented: false },
  { file: 'v3_hevc.mp4', label: 'HEVC + B 帧', tracks: 2, fragmented: false },
  { file: 'v4_shortgop.mp4', label: '短 GOP（1s）', tracks: 2, fragmented: false },
  { file: 'v5_noaudio.mp4', label: '无音轨', tracks: 1, fragmented: false },
  { file: 'v6_twoaudio.mp4', label: '双音轨', tracks: 3, fragmented: false },
  { file: 'v7_frag.mp4', label: '分片式 fMP4', tracks: 2, fragmented: true },
];

/**
 * @param {string} name
 */
function audioPath(name) {
  return path.join(AUDIO_DIR, name);
}

/**
 * @param {string} name
 */
function videoPath(name) {
  return path.join(VIDEO_DIR, name);
}

/**
 * @param {string} file
 */
function readAudioFile(file) {
  return fs.readFileSync(audioPath(file));
}

/**
 * 打开剪切器页面并等待就绪。
 * @param {import('@playwright/test').Page} page
 * @param {'audio'|'video'} which
 */
async function openCutter(page, which) {
  await page.goto(which === 'audio' ? AUDIO_PAGE : VIDEO_PAGE);
  await page.locator('#dropZone').waitFor({ state: 'visible' });
}

/**
 * 在页面内跑一遍「探测 → 解析 → 切割」，与 test_cut.py 的 node 流程等价。
 * 返回的 out 是切割结果的原始字节（base64）。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} pageUrl 夹具在测试服务器上的 URL
 * @param {number} start
 * @param {number} end
 */
async function cutInPage(page, pageUrl, start, end) {
  await openCutter(page, 'audio');
  return page.evaluate(
    async ({ pageUrl, start, end }) => {
      const toB64 = (u8) => {
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < u8.length; i += CH) {
          s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
        }
        return btoa(s);
      };
      const res = await fetch(pageUrl);
      if (!res.ok) throw new Error(`夹具加载失败 ${res.status}: ${pageUrl}`);
      const buf = await res.arrayBuffer();
      const u8 = new Uint8Array(buf);
      const w = /** @type {any} */ (window);
      const fmt = w.ACDetect.detect(buf, pageUrl.split('/').pop());
      const PARSERS = { WAV: w.ACWav, MP3: w.ACMp3, M4A: w.ACM4a, FLAC: w.ACFlac, OGG: w.ACOgg };
      const parser = PARSERS[fmt];
      if (!parser) throw new Error(`格式探测失败：${fmt}`);
      const info = parser.parse(u8);
      const cut = parser.cut(u8, info, start, end);
      const total = cut.parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const part of cut.parts) {
        out.set(new Uint8Array(part.buffer, part.byteOffset, part.length), offset);
        offset += part.length;
      }
      return {
        fmt,
        info: {
          format: info.format,
          codec: info.codec,
          duration: info.duration,
          sampleRate: info.sampleRate,
          channels: info.channels,
          bitDepth: info.bitDepth || 0,
          boundaries: info.boundaries.length,
        },
        t0: cut.t0,
        t1: cut.t1,
        outSize: total,
        outB64: toB64(out),
      };
    },
    { pageUrl, start, end },
  );
}

/**
 * 只用“探测 + 解析”，用于损坏文件测试。
 * @param {import('@playwright/test').Page} page
 * @param {string} pageUrl
 */
async function parseInPage(page, pageUrl) {
  await openCutter(page, 'audio');
  return page.evaluate(async ({ pageUrl }) => {
    const res = await fetch(pageUrl);
    if (!res.ok) throw new Error(`夹具加载失败 ${res.status}`);
    const buf = await res.arrayBuffer();
    const w = /** @type {any} */ (window);
    const fmt = w.ACDetect.detect(buf, pageUrl.split('/').pop());
    const PARSERS = { WAV: w.ACWav, MP3: w.ACMp3, M4A: w.ACM4a, FLAC: w.ACFlac, OGG: w.ACOgg };
    if (!fmt) return { fmt: null, error: '无法识别格式' };
    try {
      const info = PARSERS[fmt].parse(new Uint8Array(buf));
      return { fmt, duration: info.duration, sampleRate: info.sampleRate, codec: info.codec };
    } catch (error) {
      return { fmt, error: String(error && error.message ? error.message : error) };
    }
  }, { pageUrl });
}

/**
 * 用 WebAudio 解码成 8kHz 单声道 PCM（Int16 base64），与 verify_content.py 的
 * `ffmpeg -f s16le -ac 1 -ar 8000` 等价。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ pageUrl?: string, b64?: string }} source
 * @param {number} [sampleRate]
 */
async function decodePcm(page, source, sampleRate = 8000) {
  return page.evaluate(
    async ({ pageUrl, b64, sampleRate }) => {
      let buf;
      if (b64) {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        buf = u8.buffer;
      } else {
        const res = await fetch(pageUrl);
        if (!res.ok) throw new Error(`夹具加载失败 ${res.status}`);
        buf = await res.arrayBuffer();
      }
      const ctx = new OfflineAudioContext(1, 1, sampleRate);
      const audio = await ctx.decodeAudioData(buf);
      const n = audio.length;
      const channels = audio.numberOfChannels;
      const chans = [];
      for (let c = 0; c < channels; c++) chans.push(audio.getChannelData(c));
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let c = 0; c < channels; c++) v += chans[c][i];
        v = (v / channels) * 32768;
        pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
      const bytes = new Uint8Array(pcm.buffer);
      let s = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      return { duration: audio.duration, sampleRate: audio.sampleRate, pcmB64: btoa(s) };
    },
    { pageUrl: source.pageUrl, b64: source.b64, sampleRate },
  );
}

/**
 * @param {string} b64
 * @returns {Int16Array}
 */
function pcmFromBase64(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

/** 迭代式 radix-2 FFT（原地），用于快速互相关。 */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * 在 ±maxShiftMs 内寻找最佳对齐后的皮尔逊相关系数。
 *
 * 用 FFT 互相关做 1 样本精度的对齐（有损格式的解码器延迟往往是任意样本数），
 * 再在整段上计算皮尔逊相关。直接按 2ms 步进扫会因多音信号的周期性锁到
 * 100ms 的伪峰上，导致“内容其实一致但相关很低”。
 *
 * @param {Int16Array} a 源片段
 * @param {Int16Array} b 输出
 * @param {number} [sampleRate]
 * @param {number} [maxShiftMs]
 */
function bestCorrelation(a, b, sampleRate = 44100, maxShiftMs = 300) {
  const n = Math.min(a.length, b.length);
  if (n < sampleRate / 4) return { correlation: 0, shiftMs: 0 };
  const limit = Math.round((sampleRate * maxShiftMs) / 1000);
  const win = Math.min(n, Math.round(sampleRate)); // 用 1s 窗口对齐
  let size = 1;
  while (size < win * 2) size *= 2;

  const reA = new Float64Array(size);
  const imA = new Float64Array(size);
  const reB = new Float64Array(size);
  const imB = new Float64Array(size);
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < win; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= win;
  meanB /= win;
  for (let i = 0; i < win; i++) {
    reA[i] = a[i] - meanA;
    reB[i] = b[i] - meanB;
  }
  fft(reA, imA, false);
  fft(reB, imB, false);
  // 互相关 = IFFT(A * conj(B))：峰值位置即 b 相对 a 的位移
  for (let i = 0; i < size; i++) {
    const ar = reA[i];
    const ai = imA[i];
    const br = reB[i];
    const bi = imB[i];
    reA[i] = ar * br + ai * bi;
    imA[i] = ai * br - ar * bi;
  }
  fft(reA, imA, true);

  // 把循环下标映射到 [-size/2, size/2)
  const lagAt = (k) => (k > size / 2 ? k - size : k);
  let bestK = 0;
  let bestScore = -Infinity;
  for (let k = 0; k < size; k++) {
    const lag = lagAt(k);
    if (Math.abs(lag) > limit) continue;
    const score = Math.abs(reA[k]);
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
    }
  }
  const lag = lagAt(bestK);

  const measure = (shift) => {
    const len = n - Math.abs(shift);
    let sumA = 0;
    let sumB = 0;
    let sumAA = 0;
    let sumBB = 0;
    let sumAB = 0;
    for (let i = 0; i < len; i++) {
      const x = shift >= 0 ? a[i + shift] : a[i];
      const y = shift >= 0 ? b[i] : b[i - shift];
      sumA += x;
      sumB += y;
      sumAA += x * x;
      sumBB += y * y;
      sumAB += x * y;
    }
    const va = sumAA - (sumA * sumA) / len;
    const vb = sumBB - (sumB * sumB) / len;
    if (va <= 0 || vb <= 0) return -2;
    return (sumAB - (sumA * sumB) / len) / Math.sqrt(va * vb);
  };
  let best = { correlation: -2, shift: lag };
  // FFT 只能给出位移的绝对值方向不确定，正负各试一遍，再 ±3 样本细化
  for (const direction of [1, -1]) {
    for (let delta = -3; delta <= 3; delta++) {
      const shift = direction * lag + delta;
      if (Math.abs(shift) > limit) continue;
      const c = measure(shift);
      if (c > best.correlation) best = { correlation: c, shift };
    }
  }
  return { correlation: best.correlation, shiftMs: (best.shift / sampleRate) * 1000 };
}

/**
 * 峰值 / 均方根，用于能量比。
 * @param {Int16Array} pcm
 */
function rms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, pcm.length));
}

/**
 * @param {Int16Array} pcm
 */
function peak(pcm) {
  let max = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > max) max = v;
  }
  return max;
}

/** 通过真实 UI 上传文件 */
async function uploadFile(page, filePath) {
  await page.locator('#fileInput').setInputFiles(filePath);
}

/**
 * 填写起止时间并触发 change。
 * @param {import('@playwright/test').Page} page
 * @param {string} start
 * @param {string} end
 */
async function setRange(page, start, end) {
  const inTime = page.locator('#inTime');
  await inTime.fill(start);
  await inTime.press('Enter');
  const outTime = page.locator('#outTime');
  await outTime.fill(end);
  await outTime.press('Enter');
  await outTime.blur();
}

/**
 * 点击剪切并捕获下载内容。
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ bytes: Buffer, filename: string }>}
 */
async function cutAndDownload(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.locator('#cutBtn').click();
  const download = await downloadPromise;
  const filePath = await download.path();
  if (!filePath) throw new Error('下载失败：没有本地路径');
  return {
    bytes: fs.readFileSync(filePath),
    filename: download.suggestedFilename(),
  };
}

/**
 * 收集页面未捕获的 JS 报错。
 * @param {import('@playwright/test').Page} page
 * @returns {string[]}
 */
function watchPageErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/**
 * 把页面里的 #infoList / #resList 解析成对象，方便断言。
 * @param {import('@playwright/test').Locator} list
 */
async function readDefinitionList(list) {
  return list.evaluate((el) => {
    /** @type {Record<string, string>} */
    const out = {};
    const dts = Array.from(el.querySelectorAll('dt'));
    const dds = Array.from(el.querySelectorAll('dd'));
    dts.forEach((dt, i) => {
      out[(dt.textContent || '').trim()] = (dds[i] && dds[i].textContent ? dds[i].textContent : '').trim();
    });
    return out;
  });
}

module.exports = {
  AUDIO_DIR,
  VIDEO_DIR,
  AUDIO_PAGE,
  VIDEO_PAGE,
  AUDIO_URL,
  VIDEO_URL,
  AUDIO_MATRIX,
  AUDIO_DIVERSE,
  VIDEO_MATRIX,
  audioPath,
  videoPath,
  readAudioFile,
  openCutter,
  cutInPage,
  parseInPage,
  decodePcm,
  pcmFromBase64,
  bestCorrelation,
  rms,
  peak,
  uploadFile,
  setRange,
  cutAndDownload,
  readDefinitionList,
  watchPageErrors,
};
