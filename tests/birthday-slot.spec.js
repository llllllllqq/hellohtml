// @ts-check
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/生日老虎机游戏/birthday-slot-machine.html');
const NOUNS = ['蛋糕', '仓鼠', '猫猫', '云朵', '小熊', '流星'];

test.describe('生日老虎机', () => {
  test('初始弹窗要求先设置昵称，移动端不横向溢出', async ({ page }) => {
    await page.goto(PAGE);

    await expect(page).toHaveTitle(/生日老虎机/);
    await expect(page.locator('#overlay')).toBeVisible();
    await expect(page.locator('#nameText')).toHaveText('小明');
    await expect(page.locator('#sentence')).toContainText('先设置昵称');

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
  });

  test('设置昵称后开始，昵称写入页面', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#nameInput').fill('小测');
    await page.locator('#startBtn').click();

    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#nameText')).toHaveText('小测');
    await expect(page.locator('#tip')).toContainText('拉一下');
  });

  test('拉一次后生成句子并累计次数', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      // 固定为非彩蛋组合，避免随机触发彩蛋影响断言
      Math.random = () => 0.5;
    });
    await page.goto(PAGE);

    await page.locator('#nameInput').fill('小测');
    await page.locator('#startBtn').click();
    await page.locator('#soundBtn').click();
    await page.locator('#spinBtn').click();

    await page.clock.runFor(7_000);

    await expect(page.locator('#pullCount')).toHaveText('1');
    await expect(page.locator('#spinBtn')).toBeEnabled();
    const sentence = await page.locator('#sentence').innerText();
    expect(sentence).toContain('小测');
    expect(sentence).toMatch(new RegExp(NOUNS.join('|')));
    await expect(page.locator('#luckyLabel')).toContainText('幸运值 1 / 10');
  });

  test('彩蛋：蛋糕 + 吃触发「被」变「把」，并自动收起贺卡', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      Math.random = () => 0;
    });
    await page.goto(PAGE);

    await page.locator('#nameInput').fill('小测');
    await page.locator('#startBtn').click();
    await page.locator('#soundBtn').click();
    await page.locator('#spinBtn').click();

    await page.clock.runFor(6_500);

    await expect(page.locator('#pullCount')).toHaveText('1');
    await expect(page.locator('#eggCount')).toHaveText('1');
    await expect(page.locator('#bei')).toHaveText('把');
    await expect(page.locator('#eggCard')).toHaveClass(/show/);
    await expect(page.locator('#sentence')).toContainText('把');

    await page.clock.runFor(5_000);
    await expect(page.locator('#eggCard')).not.toHaveClass(/show/);
  });

  test('重置记录会清零拉动次数与彩蛋数', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#nameInput').fill('小测');
    await page.locator('#startBtn').click();
    await page.locator('#resetBtn').click();

    await expect(page.locator('#pullCount')).toHaveText('0');
    await expect(page.locator('#eggCount')).toHaveText('0');
    await expect(page.locator('#tip')).toContainText('记录已清空');
  });
});
