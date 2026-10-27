// @ts-check
/**
 * 音频剪切器（音视频剪切器/audio-stream-cutter.html）测试。
 *
 * 由原工程 audio-cutter 目录下的 Python 测试移植而来（e2e.py / test_cut.py /
 * verify_content.py / supplement_test.py / test_wav_roundtrip.py / e2e_timeinput.py），
 * 差异：不再依赖 ffmpeg / Python，容器结构用 tests/utils 里的独立解析器校验，
 * 内容正确性用浏览器 WebAudio 解码后做皮尔逊相关（等价于原 verify_content.py）。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { expectNoHorizontalScroll, expectResponsiveViewport } = require('./utils');
const { parseWav, parseMp3, parseFlac, parseOgg } = require('./utils/audio-container');
const { parseMp4, extractSamples } = require('./utils/mp4');
const C = require('./utils/cutter');

const CUT_START = 2;
const CUT_END = 6;

/** 容器时长与“实际切割区间”的允许偏差（有损格式按帧/页对齐） */
const DURATION_TOLERANCE = { WAV: 0.02, MP3: 0.12, M4A: 0.12, FLAC: 0.2, OGG: 0.35 };

/**
 * 按格式独立校验输出容器的结构，返回便于断言的摘要。
 * @param {string} fmt
 * @param {Buffer} bytes
 * @param {{ t0: number, t1: number }} cut
 */
function validateAudioContainer(fmt, bytes, cut) {
  const expected = cut.t1 - cut.t0;
  const tolerance = DURATION_TOLERANCE[/** @type {keyof typeof DURATION_TOLERANCE} */ (fmt)];
  if (fmt === 'WAV') {
    const wav = parseWav(bytes);
    expect(Math.abs(wav.duration - expected), `WAV 时长 ${wav.duration} 应≈${expected}`).toBeLessThan(tolerance);
    return { duration: wav.duration, detail: `${wav.chunks.join(' ')} ${wav.sampleRate}Hz/${wav.channels}ch/${wav.bitsPerSample}bit` };
  }
  if (fmt === 'MP3') {
    const mp3 = parseMp3(bytes);
    expect(mp3.frames, 'MP3 至少要有帧').toBeGreaterThan(0);
    expect(Math.abs(mp3.duration - expected), `MP3 时长 ${mp3.duration} 应≈${expected}`).toBeLessThan(tolerance);
    return { duration: mp3.duration, detail: `${mp3.frames} 帧 ${mp3.sampleRate}Hz/${mp3.channels}ch` };
  }
  if (fmt === 'FLAC') {
    const flac = parseFlac(bytes);
    expect(Math.abs(flac.duration - expected), `FLAC 时长 ${flac.duration} 应≈${expected}`).toBeLessThan(tolerance);
    return { duration: flac.duration, detail: `${flac.blocks.join(' ')} ${flac.sampleRate}Hz/${flac.channels}ch` };
  }
  if (fmt === 'OGG') {
    const ogg = parseOgg(bytes, (cut.info && cut.info.sampleRate) || cut.sampleRate || 44100);
    expect(ogg.badCrc, 'OGG 每页 CRC 必须正确').toBe(0);
    expect(ogg.seqContiguous, 'OGG 页序号必须连续').toBe(true);
    expect(ogg.eos, 'OGG 末页应带 EOS 标志').toBe(true);
    // 页粒度切割，时长按页对齐
    expect(Math.abs(ogg.duration - expected), `OGG 时长 ${ogg.duration} 应≈${expected}`).toBeLessThan(tolerance);
    return { duration: ogg.duration, detail: `${ogg.pages} 页 seq=${ogg.seqStart}.. granule=${ogg.lastGranule}` };
  }
  if (fmt === 'M4A') {
    const mp4 = parseMp4(bytes);
    expect(mp4.movie, 'M4A 应有 mvhd').not.toBeNull();
    expect(mp4.tracks.length, 'M4A 应只有一条音轨').toBe(1);
    expect(mp4.tracks[0].type).toBe('soun');
    expect(Math.abs((mp4.movie && mp4.movie.duration) - expected), `M4A 时长 ${mp4.movie && mp4.movie.duration} 应≈${expected}`).toBeLessThan(tolerance);
    return { duration: mp4.movie && mp4.movie.duration, detail: `${mp4.tracks[0].codec} ${mp4.tracks[0].samples} samples` };
  }
  throw new Error(`未知格式 ${fmt}`);
}

/**
 * 内容级校验：用原生采样率解码源区间与输出，做皮尔逊相关。
 *
 * 为什么用原生采样率：有损格式的解码器有固有延迟（AAC 1024、MP3 529…样本），
 * 输出与源会整体错开；一旦重采样到 8kHz，非整数样本的位移会让各个频率分量
 * 产生不同的相移，多音测试信号的相关性会被错误地拉低。原生采样率下位移是
 * 整数样本，可以精确对齐，稳态段相关可达 0.999。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fmt
 * @param {{ outB64: string, t0: number, t1: number, file: string, sampleRate: number }} cut
 */
async function checkContent(page, fmt, cut) {
  const rate = cut.sampleRate || 44100;
  const src = await C.decodePcm(page, { pageUrl: `${C.AUDIO_URL}/${cut.file}` }, rate);
  const out = await C.decodePcm(page, { b64: cut.outB64 }, rate);
  const srcPcm = C.pcmFromBase64(src.pcmB64);
  const outPcm = C.pcmFromBase64(out.pcmB64);

  // 跳过起点的 100ms：有损格式从帧/页中间开始解码时，第一帧的 MDCT/状态不完整
  const skip = Math.round(0.1 * rate);
  const expected = cut.t1 - cut.t0;
  const length = Math.min(outPcm.length - skip, Math.round(expected * rate) - 2 * skip);
  expect(length, '解出的输出应有足够内容').toBeGreaterThan(rate / 2);

  const slice = srcPcm.subarray(Math.round(cut.t0 * rate) + skip, Math.round(cut.t0 * rate) + skip + length);
  const segment = outPcm.subarray(skip, skip + length);

  expect(Math.abs(outPcm.length / rate - expected), '解码时长应与切割区间一致').toBeLessThan(0.25);

  const { correlation, shiftMs } = C.bestCorrelation(slice, segment, rate);
  const energy = C.rms(segment) / Math.max(1, C.rms(slice));
  const max = C.peak(segment);

  expect(correlation, `皮尔逊相关 ${correlation.toFixed(4)}（偏移 ${shiftMs.toFixed(1)}ms）`).toBeGreaterThan(0.95);
  expect(energy, `能量比 ${energy.toFixed(3)}`).toBeGreaterThan(0.85);
  expect(energy, `能量比 ${energy.toFixed(3)}`).toBeLessThan(1.18);
  expect(max, '峰值不应为静音').toBeGreaterThan(400);
  return { correlation, shiftMs, energy };
}

test.describe('音频剪切器 · 9 种格式（解析 → 切割 → 结构 → 内容）', () => {
  test.skip(({ isMobile }) => isMobile, '格式矩阵只在桌面端跑，移动端另有专项用例');

  for (const testCase of C.AUDIO_MATRIX) {
    test(`${testCase.label}`, async ({ page }) => {
      const errors = C.watchPageErrors(page);
      const cut = await C.cutInPage(page, `${C.AUDIO_URL}/${testCase.file}`, CUT_START, CUT_END);

      expect(cut.fmt).toBeTruthy();
      expect(Math.abs(cut.info.duration - 8), `${testCase.file} 时长 ${cut.info.duration}`).toBeLessThan(0.15);
      // 吸附后仍应落在 4s 附近（OGG 按页对齐，允许 ±1s 以上）
      expect(Math.abs(cut.t1 - cut.t0 - 4), `实际区间 ${cut.t0}→${cut.t1}`).toBeLessThan(1.3);

      const bytes = Buffer.from(cut.outB64, 'base64');
      expect(bytes.length, '输出不应为空').toBeGreaterThan(1000);
      const summary = validateAudioContainer(cut.fmt, bytes, cut);

      if (testCase.file === 'test_alac.m4a') {
        // Chromium 不解码 ALAC，但 ALAC 是无损且不重编码：输出采样字节必须是源字节的连续子串
        const srcBytes = C.readAudioFile(testCase.file);
        const srcMp4 = parseMp4(srcBytes);
        const outMp4 = parseMp4(bytes);
        const srcSamples = extractSamples(srcBytes, srcMp4.tracks[0]);
        const outSamples = extractSamples(bytes, outMp4.tracks[0]);
        expect(srcSamples.includes(outSamples), 'ALAC 输出必须是源采样字节的连续片段').toBe(true);
        test.info().annotations.push({
          type: 'result',
          description: `${summary.detail}；ALAC 采样字节 ${outSamples.length}B 与源逐字节一致`,
        });
      } else {
        const content = await checkContent(page, cut.fmt, { ...cut, file: testCase.file, sampleRate: cut.info.sampleRate });
        test.info().annotations.push({
          type: 'result',
          description: `${summary.detail}；时长 ${summary.duration.toFixed(3)}s；相关 ${content.correlation.toFixed(3)}`,
        });
      }

      expect(errors, '页面不应有 JS 报错').toEqual([]);
    });
  }
});

test.describe('音频剪切器 · 多样化真实文件', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  for (const testCase of C.AUDIO_DIVERSE) {
    test(`${testCase.label}`, async ({ page }) => {
      const errors = C.watchPageErrors(page);
      const cut = await C.cutInPage(page, `${C.AUDIO_URL}/${testCase.file}`, CUT_START, CUT_END);
      const bytes = Buffer.from(cut.outB64, 'base64');
      const summary = validateAudioContainer(cut.fmt, bytes, cut);
      const content = await checkContent(page, cut.fmt, { ...cut, file: testCase.file, sampleRate: cut.info.sampleRate });
      expect(content.shiftMs, '帧/页对齐偏移应在 ±300ms 内').toBeLessThan(320);
      test.info().annotations.push({ type: 'result', description: `${summary.detail}，相关 ${content.correlation.toFixed(3)}` });
      expect(errors).toEqual([]);
    });
  }
});

test.describe('音频剪切器 · 边界参数', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  const EDGE_CASES = [
    { file: 'test.wav', start: 0, end: 8, label: 'WAV 全选' },
    { file: 'test.wav', start: 0, end: 0.05, label: 'WAV 极短 50ms' },
    { file: 'test.wav', start: 7.9, end: 8, label: 'WAV 贴终点' },
    { file: 'test.mp3', start: 0, end: 8, label: 'MP3 全选（含 Xing 头帧）' },
    { file: 'test.mp3', start: 0, end: 0.05, label: 'MP3 极短' },
    { file: 'test.m4a', start: 0, end: 8, label: 'M4A 全选' },
    { file: 'test.flac', start: 0, end: 8, label: 'FLAC 全选' },
    { file: 'test.flac', start: 7.95, end: 8, label: 'FLAC 贴终点' },
    { file: 'test.ogg', start: 0, end: 8, label: 'OGG 全选' },
    { file: 'test_opus.ogg', start: 0, end: 8, label: 'Opus OGG 全选' },
    { file: 'test.wav', start: 2, end: 100, label: 'WAV 终点超时长（应 clamp）' },
    { file: 'test.mp3', start: 2, end: 100, label: 'MP3 终点超时长' },
  ];

  for (const testCase of EDGE_CASES) {
    test(testCase.label, async ({ page }) => {
      const cut = await C.cutInPage(page, `${C.AUDIO_URL}/${testCase.file}`, testCase.start, testCase.end);
      expect(cut.t0).toBeGreaterThanOrEqual(0);
      expect(cut.t1).toBeLessThanOrEqual(cut.info.duration + 0.001);
      expect(cut.t1 - cut.t0, '切割区间必须为正').toBeGreaterThan(0);
      const bytes = Buffer.from(cut.outB64, 'base64');
      expect(bytes.length).toBeGreaterThan(20);
      const summary = validateAudioContainer(cut.fmt, bytes, cut);
      test.info().annotations.push({
        type: 'result',
        description: `切出 [${cut.t0.toFixed(3)}, ${cut.t1.toFixed(3)}] → ${summary.detail}`,
      });
    });
  }
});

test.describe('音频剪切器 · 损坏/伪造文件应优雅报错', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  const BAD_FILES = [
    { file: 'fake.mp3', mustFail: true, label: '伪造 MP3（纯文本）' },
    { file: 'fake.wav', mustFail: true, label: '伪造 WAV（纯文本）' },
    { file: 'trunc.m4a', mustFail: true, label: '截断 M4A（moov 不完整）' },
    { file: 'trunc.mp3', mustFail: false, label: '截断 MP3' },
    { file: 'trunc.flac', mustFail: false, label: '截断 FLAC' },
    { file: 'trunc.ogg', mustFail: false, label: '截断 OGG' },
  ];

  for (const testCase of BAD_FILES) {
    test(testCase.label, async ({ page }) => {
      const result = await C.parseInPage(page, `${C.AUDIO_URL}/${testCase.file}`);
      if (testCase.mustFail) {
        expect(result.error, '应给出可读的错误信息').toBeTruthy();
        expect(String(result.error)).not.toContain('undefined');
      } else {
        // 截断文件可能仍能解析出部分结构；至少不能把异常抛到页面上
        expect(result.error || result.duration > 0).toBeTruthy();
      }
    });
  }
});

test.describe('音频剪切器 · 非法文件在 UI 上要给出可见提示', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  for (const file of ['fake.mp3', 'trunc.m4a']) {
    test(`${file}：显示错误面板且不进入编辑器`, async ({ page }) => {
      await C.openCutter(page, 'audio');
      await C.uploadFile(page, C.audioPath(file));
      await expect(page.locator('#unsupportedBox')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#unsupportedBox')).toContainText('无法处理该文件');
      await expect(page.locator('#editor')).toBeHidden();
      await expect(page.locator('#logPanel')).toContainText('分析失败');
    });
  }
});

test.describe('音频剪切器 · 真实 UI 流程（上传 → 剪切 → 下载 → 浏览器可播）', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  const UI_CASES = ['test.wav', 'test.mp3', 'test.m4a', 'test.flac', 'test.ogg'];

  for (const file of UI_CASES) {
    test(`${file}：下载文件结构正确且页面自检通过`, async ({ page }) => {
      const errors = C.watchPageErrors(page);
      await C.openCutter(page, 'audio');
      await C.uploadFile(page, C.audioPath(file));
      await expect(page.locator('#editor')).toBeVisible();
      await expect(page.locator('#infoList')).toContainText(file);

      await C.setRange(page, '00:02.000', '00:06.000');
      const { bytes, filename } = await C.cutAndDownload(page);

      expect(filename).toMatch(/_cut_/);
      expect(bytes.length).toBeGreaterThan(1000);
      const fmt = file.endsWith('.wav') ? 'WAV' : file.endsWith('.mp3') ? 'MP3' : file.endsWith('.m4a') ? 'M4A' : file.endsWith('.flac') ? 'FLAC' : 'OGG';
      const cut = { t0: 2, t1: 6, sampleRate: 44100 };
      validateAudioContainer(fmt, bytes, cut);

      await expect(page.locator('#result')).toBeVisible();
      await expect(page.locator('#playCheck')).toContainText('已验证可在浏览器播放', { timeout: 15_000 });
      const result = await C.readDefinitionList(page.locator('#resList'));
      // WAV 是样本级精确切割；有损格式会吸附到帧/页边界，实际区间可能前移
      if (fmt === 'WAV') expect(result['实际区间']).toContain('00:02.000');
      expect(result['实际区间']).toMatch(/\d{2}:\d{2}\.\d{3} → \d{2}:\d{2}\.\d{3}/);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('音频剪切器 · WAV 切割往返（含畸形 chunk）', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  /**
   * 构造 WAV：可指定奇数长度 chunk、fact 块、异常的 blockAlign/byteRate。
   * @param {{ bits: number, channels: number, sampleRate: number, frames: number, fact?: number, oddChunk?: boolean, zeroAlign?: boolean }} opts
   */
  function synthWav(opts) {
    const { bits, channels, sampleRate, frames } = opts;
    const align = Math.max(1, (bits * channels) / 8);
    const dataSize = frames * align;
    /** @type {Buffer[]} */
    const chunks = [];

    const fmt = Buffer.alloc(8 + 16);
    fmt.write('fmt ', 0, 'latin1');
    fmt.writeUInt32LE(16, 4);
    fmt.writeUInt16LE(bits === 8 ? 1 : bits === 32 ? 3 : 1, 8);
    fmt.writeUInt16LE(channels, 10);
    fmt.writeUInt32LE(sampleRate, 12);
    fmt.writeUInt32LE(opts.zeroAlign ? 0 : sampleRate * align, 16);
    fmt.writeUInt16LE(opts.zeroAlign ? 0 : align, 20);
    fmt.writeUInt16LE(bits, 22);
    chunks.push(fmt);

    if (opts.fact) {
      const fact = Buffer.alloc(8 + opts.fact);
      fact.write('fact', 0, 'latin1');
      fact.writeUInt32LE(opts.fact, 4);
      fact.writeUInt32LE(frames, 8);
      chunks.push(fact);
    }

    if (opts.oddChunk) {
      // LIST chunk 长度 27（奇数），后面必须补 1 字节 pad
      const list = Buffer.alloc(8 + 27 + 1);
      list.write('LIST', 0, 'latin1');
      list.writeUInt32LE(27, 4);
      list.write('INFOISFT', 8, 'latin1');
      list.write('hellohtml-test-pad', 16, 'latin1');
      chunks.push(list);
    }

    const data = Buffer.alloc(8 + dataSize + (dataSize & 1));
    data.write('data', 0, 'latin1');
    data.writeUInt32LE(dataSize, 4);
    for (let i = 0; i < frames; i++) {
      // 锯齿波，便于肉眼/断言区分
      const v = (i % 64) * 4;
      for (let c = 0; c < channels; c++) {
        const at = 8 + i * align + c * (bits / 8);
        if (bits === 8) data.writeUInt8((v + c * 7) & 0xff, at);
        else if (bits === 16) data.writeInt16LE(v - 128, at);
        else if (bits === 24) {
          const sample = (v - 128) * 65536;
          data.writeUInt8(sample & 0xff, at);
          data.writeUInt8((sample >> 8) & 0xff, at + 1);
          data.writeUInt8((sample >> 16) & 0xff, at + 2);
        } else data.writeInt32LE((v - 128) * 65536, at);
      }
    }
    chunks.push(data);

    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(body.length + 4, 4);
    header.write('WAVE', 8, 'latin1');
    return Buffer.concat([header, body]);
  }

  const SYNTH = [
    { name: 'oddchunk.wav', opts: { bits: 16, channels: 2, sampleRate: 44100, frames: 4410, oddChunk: true }, start: '00:00.000', end: '00:00.050' },
    { name: 'fact8.wav', opts: { bits: 16, channels: 1, sampleRate: 44100, frames: 4410, fact: 8 }, start: '00:00.000', end: '00:00.050' },
    { name: 'zeroalign.wav', opts: { bits: 16, channels: 1, sampleRate: 22050, frames: 2205, zeroAlign: true }, start: '00:00.000', end: '00:00.050' },
    { name: 'u8single.wav', opts: { bits: 8, channels: 1, sampleRate: 8000, frames: 21 }, start: '00:00.000', end: '00:00.001' },
    { name: 'u8odd.wav', opts: { bits: 8, channels: 1, sampleRate: 8000, frames: 9 }, start: '00:00.000', end: '00:00.001' },
    { name: 's24.wav', opts: { bits: 24, channels: 1, sampleRate: 22050, frames: 4410 }, start: '00:00.010', end: '00:00.060' },
  ];

  test('畸形 WAV：输出结构自洽、可被重新导入', async ({ page }, testInfo) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wav-roundtrip-'));
    const errors = C.watchPageErrors(page);
    await C.openCutter(page, 'audio');

    for (const testCase of SYNTH) {
      const srcPath = path.join(dir, testCase.name);
      const src = synthWav(testCase.opts);
      fs.writeFileSync(srcPath, src);

      await page.reload();
      await C.openCutter(page, 'audio');
      await C.uploadFile(page, srcPath);
      await expect(page.locator('#editor')).toBeVisible();
      await expect(page.locator('#infoList')).toContainText(testCase.name);

      await C.setRange(page, testCase.start, testCase.end);
      const { bytes } = await C.cutAndDownload(page);
      const out = parseWav(bytes);

      // 输出必须能被独立解析器读通（RIFF size / chunk 闭合 / data 存在）
      expect(out.dataSize, `${testCase.name} 应有音频数据`).toBeGreaterThan(0);

      // 再导入一次（真实用户路径）：必须进入编辑器、且日志无“分析失败”
      const outPath = path.join(dir, `out-${testCase.name}`);
      fs.writeFileSync(outPath, bytes);
      await page.reload();
      await C.openCutter(page, 'audio');
      await C.uploadFile(page, outPath);
      await expect(page.locator('#editor')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#logPanel')).not.toContainText('分析失败');
      const durLabel = await page.locator('#durLabel').innerText();
      expect(durLabel).toMatch(/^\d{2}:\d{2}\.\d{3}$/);

      testInfo.annotations.push({ type: 'case', description: `${testCase.name}: ${out.chunks.join(' ')}` });
    }

    expect(errors).toEqual([]);
  });
});

test.describe('音频剪切器 · 时间输入解析回归', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  test('分:秒 / 时:分:秒 / 纯秒 / 溢出归一化 / 全角冒号 / 双向 clamp', async ({ page }) => {
    const errors = C.watchPageErrors(page);
    await C.openCutter(page, 'audio');
    await C.uploadFile(page, C.audioPath('long.flac'));
    await expect(page.locator('#editor')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#durLabel')).toHaveText('02:30.000');

    /** @param {string} selector @param {string} text */
    const tryInput = async (selector, text) => {
      const el = page.locator(selector);
      await el.click();
      await el.fill(text);
      await el.press('Enter');
      await el.blur();
      await page.waitForTimeout(120);
      return el.inputValue();
    };

    const CASES = [
      ['#inTime', '01:09', '01:09.000'], // 核心 bug 回归：旧逻辑会变成 02:29.999
      ['#inTime', '00:01:09', '01:09.000'], // 时:分:秒
      ['#inTime', '69', '01:09.000'], // 纯秒
      ['#inTime', '01:09.5', '01:09.500'],
      ['#inTime', '01:75', '02:15.000'], // 溢出归一化
      ['#inTime', '01：09', '01:09.000'], // 全角冒号
      ['#inTime', 'junk', '01:09.000'], // 非法输入：保持上一个有效值
      ['#outTime', '01:09', '01:09.001'], // 终点晚于起点 1ms（采样级）
      ['#outTime', '02:00', '02:00.000'],
      ['#outTime', '01:30.250', '01:30.250'],
    ];

    for (const [selector, input, expected] of CASES) {
      const got = await tryInput(selector, input);
      expect(got, `${selector} 输入 ${JSON.stringify(input)}`).toBe(expected);
    }

    // 双向 clamp：end=01:30.250 时 start 填 02:00 → 压到 end-1ms；end 填 01:00 → 抬回 start+1ms
    expect(await tryInput('#inTime', '02:00')).toBe('01:30.249');
    expect(await tryInput('#outTime', '01:00')).toBe('01:30.250');

    await expect(page.locator('.fmt-hint')).toContainText('分:秒');
    expect(errors).toEqual([]);
  });
});

test.describe('音频剪切器 · 长文件与边界性能', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  test('150s FLAC：解析 + 切割 60s 在 5s 内完成且结构正确', async ({ page }) => {
    const started = Date.now();
    const cut = await C.cutInPage(page, `${C.AUDIO_URL}/long.flac`, 30, 90);
    const elapsed = Date.now() - started;

    expect(cut.info.duration).toBeCloseTo(150, 1);
    expect(cut.t1 - cut.t0).toBeGreaterThan(59);
    expect(cut.t1 - cut.t0).toBeLessThan(61);
    expect(elapsed, `解析+切割耗时 ${elapsed}ms`).toBeLessThan(5000);

    const bytes = Buffer.from(cut.outB64, 'base64');
    const flac = parseFlac(bytes);
    expect(flac.duration).toBeGreaterThan(59);
    expect(flac.duration).toBeLessThan(61);
    expect(bytes.length).toBeLessThan(3 * 1024 * 1024);
  });
});

test.describe('音频剪切器 · 移动端兼容性', () => {
  test('无横向溢出、可触控上传/切割', async ({ page, isMobile }) => {
    test.skip(!isMobile, '仅在移动端 project 运行');
    const errors = C.watchPageErrors(page);
    await C.openCutter(page, 'audio');
    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);

    await C.uploadFile(page, C.audioPath('test.mp3'));
    await expect(page.locator('#editor')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // 触控设置区间并切割
    await page.locator('#inTime').fill('00:02.000');
    await page.locator('#inTime').press('Enter');
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator('#cutBtn').tap();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/_cut_/);

    const controls = await page.evaluate(() => {
      const ids = ['inTime', 'outTime', 'cutBtn'];
      return ids.map((id) => {
        const el = /** @type {HTMLElement} */ (document.getElementById(id));
        const rect = el.getBoundingClientRect();
        return { id, right: Math.round(rect.right), width: Math.round(rect.width) };
      });
    });
    const width = page.viewportSize()?.width || 0;
    for (const item of controls) {
      expect(item.width, `${item.id} 应有可点击宽度`).toBeGreaterThan(40);
      expect(item.right, `${item.id} 不应超出视口`).toBeLessThanOrEqual(width + 1);
    }
    expect(errors).toEqual([]);
  });
});
