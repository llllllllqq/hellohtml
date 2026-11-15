// @ts-check
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/音频发生器/tone-generator.html');

/** 直接改 range 的 value 并派发 input（fill 对 range 不适用）。 */
async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.describe('音频发生器', () => {
  test('初始状态：440 Hz 正弦波，移动端不横向溢出', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(PAGE);

    await expect(page).toHaveTitle('音频信号发生器 · 离线双声道测试工具');
    await expect(page.locator('.ver')).toHaveText(/^v\d+\.\d+\.\d+$/);

    await expect(page.locator('#freqBig')).toHaveText('440.00');
    await expect(page.locator('#freqInput')).toHaveValue('440');
    await expect(page.locator('#freqSlider')).toHaveValue('609');
    await expect(page.locator('#freqMeta')).toContainText('A4');
    await expect(page.locator('#freqMeta')).toContainText('2.27 ms');

    await expect(page.locator('#valL')).toHaveText('30');
    await expect(page.locator('#valR')).toHaveText('30');
    await expect(page.locator('#dbL')).toHaveText('-10.5 dB');
    await expect(page.locator('#dbR')).toHaveText('-10.5 dB');

    await expect(page.locator('.wave')).toHaveCount(13);
    await expect(page.locator('.wave.active')).toHaveCount(1);
    await expect(page.locator('.wave.active .cn')).toHaveText('正弦波');
    await expect(page.locator('#waveHint')).toContainText('当前：正弦波');

    await expect(page.locator('#playBtn')).toContainText('开始播放');
    await expect(page.locator('#statusText')).toHaveText('就绪 · 未输出');
    await expect(page.locator('#dot')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#devInfo')).toContainText('等待音频引擎启动');
    await expect(page.locator('#advisory')).toContainText('建议先把左右声道音量调低');

    await expect(page.locator('#scope')).toBeVisible();
    await expect.poll(() => page.locator('#scope').evaluate((canvas) => canvas.width)).toBeGreaterThan(0);

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test('频率输入、滑杆、预设与减半翻倍', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#freqInput').fill('1000');
    await expect(page.locator('#freqBig')).toHaveText('1,000.00');
    await expect(page.locator('#freqMeta')).toContainText('1.00 kHz');

    await page.locator('#btnHalf').click();
    await expect(page.locator('#freqBig')).toHaveText('500.00');
    await page.locator('#btnDouble').click();
    await expect(page.locator('#freqBig')).toHaveText('1,000.00');

    await page.locator('#presets .chip', { hasText: '440 Hz' }).click();
    await expect(page.locator('#freqBig')).toHaveText('440.00');

    await setRange(page, '#freqSlider', 1000);
    await expect(page.locator('#freqBig')).toHaveText('22,000.00');
    await expect(page.locator('#freqMeta')).toContainText('22.00 kHz');
    await expect(page.locator('#advisory')).toContainText('超过 20 kHz');

    await setRange(page, '#freqSlider', 0);
    await expect(page.locator('#freqBig')).toHaveText('1.00');
    await expect(page.locator('#advisory')).toContainText('次低频');
  });

  test('切换波形与噪声提示', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('.wave[data-wave="square"]').click();
    await expect(page.locator('.wave[data-wave="square"]')).toHaveClass(/active/);
    await expect(page.locator('#waveHint')).toContainText('方波');
    await expect(page.locator('#waveHint')).toContainText('SQUARE');
    await expect(page.locator('.wave.active')).toHaveCount(1);

    await page.locator('.wave[data-wave="white"]').click();
    await expect(page.locator('#waveHint')).toContainText('白噪声');
    await expect(page.locator('#advisory')).toContainText('噪声信号');
    await expect(page.locator('#advisory')).toContainText('全带宽');

    await page.locator('.wave[data-wave="sine"]').click();
    await expect(page.locator('#waveHint')).toContainText('正弦波');
  });

  test('声道：仅左、仅右、双声道、静音、联动与平衡', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#onlyL').click();
    await expect(page.locator('#valL')).toHaveText('30');
    await expect(page.locator('#valR')).toHaveText('0');
    await expect(page.locator('#dbR')).toHaveText('-∞ dB');
    await expect(page.locator('#balText')).toHaveText('偏左 100%');

    await page.locator('#onlyR').click();
    await expect(page.locator('#valL')).toHaveText('0');
    await expect(page.locator('#valR')).toHaveText('30');
    await expect(page.locator('#dbL')).toHaveText('-∞ dB');
    await expect(page.locator('#balText')).toHaveText('偏右 100%');

    await page.locator('#both').click();
    await expect(page.locator('#valL')).toHaveText('30');
    await expect(page.locator('#valR')).toHaveText('30');
    await expect(page.locator('#balText')).toHaveText('居中');

    await page.locator('#mute').click();
    await expect(page.locator('#mute')).toHaveText('取消静音');
    await expect(page.locator('#balText')).toHaveText('无输出');
    await page.locator('#mute').click();
    await expect(page.locator('#mute')).toHaveText('静音');
    await expect(page.locator('#balText')).toHaveText('居中');

    await page.locator('#link').check();
    await setRange(page, '#volL', 80);
    await expect(page.locator('#valL')).toHaveText('80');
    await expect(page.locator('#valR')).toHaveText('80');

    await page.locator('#link').uncheck();
    await setRange(page, '#volL', 20);
    await expect(page.locator('#valL')).toHaveText('20');
    await expect(page.locator('#valR')).toHaveText('80');
  });

  test('播放、切换波形与停止（桌面端音频引擎）', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');

    // 给 AudioContext 打桩，统计真正创建的音源，确认播放链路走通
    await page.addInitScript(() => {
      window.__osc = 0;
      window.__buf = 0;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const wrap = (name, key) => {
        const original = AC.prototype[name];
        if (typeof original !== 'function') return;
        AC.prototype[name] = function () {
          window[key] += 1;
          return original.apply(this, arguments);
        };
      };
      wrap('createOscillator', '__osc');
      wrap('createBufferSource', '__buf');
    });

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(PAGE);
    await page.locator('#playBtn').click();

    await expect(page.locator('#playBtn')).toHaveClass(/playing/);
    await expect(page.locator('#playBtn')).toContainText('停止播放');
    await expect(page.locator('#statusText')).toHaveText('运行中 · 持续输出');
    await expect(page.locator('#dot')).toHaveClass(/\bon\b/);
    await expect(page.locator('#devInfo')).toContainText('采样率');
    await expect.poll(() => page.evaluate(() => window.__osc)).toBeGreaterThan(0);

    const oscBefore = await page.evaluate(() => window.__osc);
    await page.locator('#freqInput').fill('880');
    await expect(page.locator('#freqBig')).toHaveText('880.00');
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__osc)).toBe(oscBefore);

    await page.locator('.wave[data-wave="square"]').click();
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.__osc)).toBeGreaterThan(oscBefore);

    await page.locator('.wave[data-wave="white"]').click();
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.__buf)).toBeGreaterThan(0);

    await page.locator('#playBtn').click();
    await expect(page.locator('#playBtn')).toContainText('开始播放');
    await expect(page.locator('#statusText')).toHaveText('就绪 · 未输出');
    await expect(page.locator('#dot')).not.toHaveClass(/\bon\b/);

    expect(errors).toEqual([]);
  });

  test('快捷键：方向键调频，空格播放/停止', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await page.goto(PAGE);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#freqBig')).toHaveText('880.00');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#freqBig')).toHaveText('440.00');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#freqBig')).toHaveText('448.80');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#freqBig')).toHaveText('440.00');

    // 输入框聚焦时空格不能触发播放
    await page.locator('#freqInput').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#playBtn')).not.toHaveClass(/playing/);

    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Space');
    await expect(page.locator('#playBtn')).toHaveClass(/playing/);
    await page.keyboard.press('Space');
    await expect(page.locator('#playBtn')).not.toHaveClass(/playing/);
  });
});
