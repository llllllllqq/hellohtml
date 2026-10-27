// @ts-check
/**
 * 视频剪切器（音视频剪切器/video-stream-cutter.html）测试。
 *
 * 由原工程 video-cutter/tests 下的 Python 测试移植而来
 * （blackbox_test.py / e2e_timeinput.py / make_fixtures.sh），
 * 差异：不再依赖 ffmpeg，输出容器用 tests/utils/mp4.js 独立解析校验，
 * 再叠加浏览器自身的可播放性自检（页面里的“✓ 已验证可在浏览器播放”）。
 */
const { test, expect } = require('@playwright/test');
const { expectNoHorizontalScroll, expectResponsiveViewport } = require('./utils');
const { parseMp4 } = require('./utils/mp4');
const C = require('./utils/cutter');

const CUT_START = '00:02.000';
const CUT_END = '00:06.000';

/**
 * @param {string} text “00:02.000 → 00:06.000”
 */
function parseRange(text) {
  const match = String(text).match(/(\d{2}):(\d{2})\.(\d{3})\s*→\s*(\d{2}):(\d{2})\.(\d{3})/);
  if (!match) throw new Error(`无法解析实际区间：${text}`);
  const toSeconds = (m, s, ms) => Number(m) * 60 + Number(s) + Number(ms) / 1000;
  return {
    start: toSeconds(match[1], match[2], match[3]),
    end: toSeconds(match[4], match[5], match[6]),
  };
}

/**
 * 上传 + 选区间 + 剪切 + 下载，并返回容器摘要。
 * @param {import('@playwright/test').Page} page
 * @param {string} file
 */
async function cutVideo(page, file) {
  await C.openCutter(page, 'video');
  await C.uploadFile(page, C.videoPath(file));
  await expect(page.locator('#editor')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#infoList')).toContainText(file);

  await C.setRange(page, CUT_START, CUT_END);
  const { bytes, filename } = await C.cutAndDownload(page);
  await expect(page.locator('#result')).toBeVisible();

  const result = await C.readDefinitionList(page.locator('#resList'));
  const range = parseRange(result['实际区间']);
  return { bytes, filename, range, result };
}

test.describe('视频剪切器 · 7 种容器样本', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑，移动端另有专项用例');

  for (const testCase of C.VIDEO_MATRIX) {
    test(`${testCase.label}`, async ({ page }) => {
      const errors = C.watchPageErrors(page);
      const { bytes, filename, range } = await cutVideo(page, testCase.file);

      expect(filename).toMatch(/\.mp4$/);
      expect(bytes.length, '输出不应为空').toBeGreaterThan(5_000);

      const mp4 = parseMp4(bytes);
      const videoTrack = mp4.tracks.find((t) => t.type === 'vide');
      expect(videoTrack, '输出必须含视频轨').toBeTruthy();
      expect(mp4.tracks.length, '轨道数应与源一致').toBe(testCase.tracks);
      expect(mp4.fragmented, testCase.fragmented ? '应保持分片式 fMP4' : '应保持渐进式 MP4').toBe(testCase.fragmented);

      // 实际切割区间按关键帧对齐，容器时长应与面板回显一致
      const cutLength = range.end - range.start;
      expect(cutLength, `实际区间 ${JSON.stringify(range)}`).toBeGreaterThan(1);
      expect(cutLength).toBeLessThan(6);

      if (mp4.movie && mp4.movie.duration > 0) {
        expect(Math.abs(mp4.movie.duration - cutLength), `mvhd 时长 ${mp4.movie.duration}`).toBeLessThan(0.35);
      }
      if (!mp4.fragmented) {
        // 渐进式 MP4：索引必须完整（时长/采样数/关键帧表都在 stbl 里）
        expect(videoTrack.duration, `视频轨时长 ${videoTrack.duration}`).toBeGreaterThan(0);
        expect(Math.abs(videoTrack.duration - cutLength)).toBeLessThan(0.35);
        expect(videoTrack.samples, '视频轨应有采样').toBeGreaterThan(0);
        expect(videoTrack.syncSamples, '应有 sync sample（关键帧表）').toBeGreaterThan(0);
      } else {
        // 分片式 fMP4：采样在 moof/trun 中，索引表为空是正常的
        expect(mp4.fragments.length, 'fMP4 应有 moof').toBeGreaterThan(0);
      }

      // 浏览器自检：H.264 必须能播；HEVC 在 Chromium 上无解码器，只要求不是“加载异常”
      const playCheck = await page.locator('#playCheck').innerText();
      if (videoTrack.codec === 'hvc1' || videoTrack.codec === 'hev1') {
        expect(playCheck).not.toContain('加载异常');
      } else {
        await expect(page.locator('#playCheck')).toContainText('已验证可在浏览器播放', { timeout: 20_000 });
      }

      test.info().annotations.push({
        type: 'result',
        description: `${videoTrack.codec} ${mp4.tracks.length} 轨，时长 ${cutLength.toFixed(3)}s，${bytes.length}B，${playCheck.slice(0, 40)}`,
      });
      expect(errors, '页面不应有 JS 报错').toEqual([]);
    });
  }
});

test.describe('视频剪切器 · 非视频输入应被拒绝', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  test('拖入伪造 MP4（纯文本）：提示无法处理，不进入编辑器', async ({ page }) => {
    await C.openCutter(page, 'video');
    await C.uploadFile(page, C.videoPath('fake.mp4'));
    await expect(page.locator('#unsupportedBox')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#unsupportedBox')).toContainText('无法处理该文件');
    await expect(page.locator('#editor')).toBeHidden();
  });
});

test.describe('视频剪切器 · 时间输入解析回归', () => {
  test.skip(({ isMobile }) => isMobile, '只在桌面端跑');

  test('分:秒 / 时:分:秒 / 纯秒 / 溢出归一化 / 全角冒号 / 双向 clamp（24fps）', async ({ page }) => {
    const errors = C.watchPageErrors(page);
    await C.openCutter(page, 'video');
    await C.uploadFile(page, C.videoPath('long_150s.mp4'));
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
      ['#inTime', '01:09', '01:09.000'], // 核心 bug 回归
      ['#inTime', '00:01:09', '01:09.000'],
      ['#inTime', '69', '01:09.000'],
      ['#inTime', '01:09.5', '01:09.500'],
      ['#inTime', '01:75', '02:15.000'],
      ['#inTime', '01：09', '01:09.000'],
      ['#inTime', 'junk', '01:09.000'],
      ['#outTime', '01:09', '01:09.042'], // 终点早于起点 → 抬高 1 帧（1/24s）
      ['#outTime', '02:00', '02:00.000'],
      ['#outTime', '01:30.250', '01:30.250'],
    ];

    for (const [selector, input, expected] of CASES) {
      expect(await tryInput(selector, input), `${selector} 输入 ${JSON.stringify(input)}`).toBe(expected);
    }

    // 双向 clamp：end=01:30.250 时 start 填 02:00 → 压到 end-1帧；end 填 01:00 → 抬回 start+1帧
    expect(await tryInput('#inTime', '02:00')).toBe('01:30.208');
    expect(await tryInput('#outTime', '01:00')).toBe('01:30.250');

    await expect(page.locator('.fmt-hint')).toContainText('分:秒');
    expect(errors).toEqual([]);
  });
});

test.describe('视频剪切器 · 移动端兼容性', () => {
  test('无横向溢出、可触控上传与切割', async ({ page, isMobile }) => {
    test.skip(!isMobile, '仅在移动端 project 运行');
    const errors = C.watchPageErrors(page);
    await C.openCutter(page, 'video');
    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);

    await C.uploadFile(page, C.videoPath('v5_noaudio.mp4'));
    await expect(page.locator('#editor')).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalScroll(page);

    await page.locator('#inTime').fill('00:02.000');
    await page.locator('#inTime').press('Enter');
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.locator('#cutBtn').tap();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/_cut_.*\.mp4$/);

    const controls = await page.evaluate(() => {
      const ids = ['inTime', 'outTime', 'cutBtn', 'tl'];
      return ids.map((id) => {
        const el = /** @type {HTMLElement} */ (document.getElementById(id));
        const rect = el.getBoundingClientRect();
        return { id, right: Math.round(rect.right), width: Math.round(rect.width) };
      });
    });
    const width = page.viewportSize()?.width || 0;
    for (const item of controls) {
      expect(item.width, `${item.id} 应有可交互宽度`).toBeGreaterThan(20);
      expect(item.right, `${item.id} 不应超出视口`).toBeLessThanOrEqual(width + 1);
    }
    expect(errors).toEqual([]);
  });
});
