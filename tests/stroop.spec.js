// @ts-check
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/文字颜色游戏/stroop-white.html');

const COLOR_NAMES = ['红色', '黄色', '绿色', '蓝色', '粉色', '黑色', '白色'];
const COLOR_RGB = [
  'rgb(222, 41, 16)',
  'rgb(240, 220, 0)',
  'rgb(22, 163, 74)',
  'rgb(37, 99, 235)',
  'rgb(255, 158, 199)',
  'rgb(17, 17, 17)',
  'rgb(255, 255, 255)',
];

test.describe('文字颜色游戏（读色挑战）', () => {
  test('初始界面展示 7 种颜色，移动端不横向溢出', async ({ page }) => {
    await page.goto(PAGE);

    await expect(page).toHaveTitle('读色挑战 · 白底版');
    await expect(page.locator('#intro')).toBeVisible();
    await expect(page.locator('#swatches .swatch')).toHaveCount(7);
    await expect(page.locator('#word')).toHaveText('');

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
  });

  test('点击开始后连续出题，文字与颜色都不与上一题重复', async ({ page }) => {
    await page.goto(PAGE);
    await page.mouse.click(195, 400);
    await expect(page.locator('#intro')).toBeHidden();
    await page.waitForTimeout(200);

    let previous = null;
    for (let i = 0; i < 4; i += 1) {
      if (i > 0) {
        await page.waitForTimeout(180);
        await page.mouse.click(195, 400);
        await page.waitForTimeout(300);
      }

      const current = await page.evaluate(() => {
        const el = document.getElementById('word');
        return {
          text: el.textContent,
          color: getComputedStyle(el).color,
          pop: el.classList.contains('pop'),
        };
      });

      expect(COLOR_NAMES).toContain(current.text);
      expect(COLOR_RGB).toContain(current.color);
      expect(current.pop).toBe(true);

      if (previous) {
        expect(current.text).not.toBe(previous.text);
        expect(current.color).not.toBe(previous.color);
      }
      previous = current;
    }

    await expectNoHorizontalScroll(page);
  });
});
