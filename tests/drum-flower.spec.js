// @ts-check
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/击鼓传花游戏/drum-flower.html');

test.describe('击鼓传花游戏', () => {
  test('初始界面与移动端适配', async ({ page }) => {
    await page.goto(PAGE);

    await expect(page).toHaveTitle('击鼓传花');
    await expect(page.locator('#word')).toHaveText('击鼓传花');
    await expect(page.locator('#hint')).toHaveText('点击任意处开始');
    await expect(page.locator('#intro')).toBeVisible();
    await expect(page.locator('#sound')).toHaveText('鼓声 开');

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
  });

  test('鼓声开关不会误触发开始', async ({ page }) => {
    await page.goto(PAGE);
    const sound = page.locator('#sound');

    await sound.click();
    await expect(sound).toHaveText('鼓声 关');
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#intro')).toBeVisible();

    await sound.click();
    await expect(sound).toHaveText('鼓声 开');
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#intro')).toBeVisible();
  });

  test('点击开始击鼓，随机停止后进入结束态，再点可重开', async ({ page }) => {
    await page.clock.install();
    await page.goto(PAGE);

    await page.mouse.click(195, 400);
    await expect(page.locator('body')).toHaveClass(/playing/);
    await expect(page.locator('#word')).toHaveText('咚');
    await expect(page.locator('#hint')).toContainText('传花中');

    await page.clock.runFor(10_500);

    await expect(page.locator('body')).toHaveClass(/ended/);
    await expect(page.locator('#word')).toHaveText('停！');
    await expect(page.locator('#hint')).toContainText('再来一局');
    await expect
      .poll(
        () => page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        { message: '结束态背景应变为国旗红' },
      )
      .toBe('rgb(222, 41, 16)');

    await page.mouse.click(195, 400);
    await expect(page.locator('body')).toHaveClass(/playing/);
    await expect(page.locator('#word')).toHaveText('咚');
  });
});
