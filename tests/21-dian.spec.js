// @ts-check
const { test, expect } = require('@playwright/test');

const SEED = 1;
const PAGE_21 = encodeURI('/21点游戏/21.html');
const PAGE_21PLUS = encodeURI('/21点游戏/21plus.html');

/**
 * 用固定种子替换 Math.random，让洗牌和发牌结果可复现。
 * seed = 1 时：玩家起手 10 点、要一张后 19 点，庄家最终 18 点。
 */
async function freezeRandom(page) {
  await page.addInitScript((seed) => {
    let a = seed;
    Math.random = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, SEED);
}

/** 打开页面，并收集未捕获的 JS 异常。 */
async function open(page, url) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  return errors;
}

test.describe('21点游戏 · 普通版 21.html', () => {
  test('初始界面伪装成学术能力测试，并加载自定义背景', async ({ page }) => {
    const errors = await open(page, PAGE_21);

    await expect(page).toHaveTitle('学习版测试系统');
    await expect(page.locator('h1')).toHaveText('学术能力测试 (Academic Test)');
    await expect(page.locator('#balance')).toHaveText('1000');
    await expect(page.locator('#bet-amount')).toHaveValue('10');
    await expect(page.locator('#btn-start-test')).toBeEnabled();
    await expect(page.locator('#btn-hit')).toBeDisabled();
    await expect(page.locator('#btn-stand')).toBeDisabled();

    const backgroundImage = await page.evaluate(
      () => getComputedStyle(document.body).backgroundImage,
    );
    expect(backgroundImage).toContain('bg.jpg');

    expect(errors).toEqual([]);
  });

  test('计分函数正确处理 A 的 1/11 取值', async ({ page }) => {
    await open(page, PAGE_21);
    const scores = await page.evaluate(() => [
      getTestScore([{ v: 'A', s: '甲', w: 11 }, { v: '10', s: '乙', w: 10 }]),
      getTestScore([{ v: 'A', s: '甲', w: 11 }, { v: 'A', s: '乙', w: 11 }]),
      getTestScore([{ v: 'A', s: '甲', w: 11 }, { v: '9', s: '乙', w: 9 }, { v: 'A', s: '丙', w: 11 }]),
      getTestScore([{ v: 'K', s: '甲', w: 10 }, { v: 'Q', s: '乙', w: 10 }, { v: 'J', s: '丙', w: 10 }]),
    ]);
    expect(scores).toEqual([21, 12, 21, 30]);
  });

  test('投入学分、要牌、停牌可以完整走完一局', async ({ page }) => {
    await freezeRandom(page);
    const errors = await open(page, PAGE_21);

    await page.locator('#bet-amount').fill('10');
    await page.locator('#btn-start-test').click();

    await expect(page.locator('#balance')).toHaveText('990');
    await expect(page.locator('#player-cards span')).toHaveCount(2);
    await expect(page.locator('#dealer-cards')).toContainText('??');
    await expect(page.locator('#player-score')).toHaveText('10');
    await expect(page.locator('#btn-hit')).toBeEnabled();
    await expect(page.locator('#btn-start-test')).toBeDisabled();

    await page.locator('#btn-hit').click();
    await expect(page.locator('#player-cards span')).toHaveCount(3);
    await expect(page.locator('#player-score')).toHaveText('19');

    await page.locator('#btn-stand').click();
    await expect(page.locator('#msg')).toContainText('你通过了测试');
    await expect(page.locator('#dealer-score')).toHaveText('18');
    await expect(page.locator('#balance')).toHaveText('1010');
    await expect(page.locator('#btn-start-test')).toBeEnabled();
    await expect(page.locator('#btn-hit')).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('下注为 0 时给出提示且不发牌', async ({ page }) => {
    await open(page, PAGE_21);

    await page.locator('#bet-amount').fill('0');
    await page.locator('#btn-start-test').click();

    await expect(page.locator('#msg')).toHaveText('请输入有效的学分数量');
    await expect(page.locator('#player-cards span')).toHaveCount(0);
    await expect(page.locator('#balance')).toHaveText('1000');
  });
});

test.describe('21点游戏 · Plus 版 21plus.html', () => {
  test('初始状态与按钮状态正确', async ({ page }) => {
    const errors = await open(page, PAGE_21PLUS);

    await expect(page).toHaveTitle('强化自适应 21 点 (Blackjack)');
    await expect(page.locator('h1')).toContainText('21 点 Blackjack');
    await expect(page.locator('#balance')).toHaveText('1000');
    await expect(page.locator('#bet-amount')).toHaveValue('10');
    await expect(page.locator('#btn-start-game')).toBeEnabled();
    await expect(page.locator('#btn-hit')).toBeDisabled();
    await expect(page.locator('#btn-stand')).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('计分函数正确处理 A 的 1/11 取值', async ({ page }) => {
    await open(page, PAGE_21PLUS);
    const scores = await page.evaluate(() => [
      calculateScore([{ value: 'A', weight: 11 }, { value: '10', weight: 10 }]),
      calculateScore([{ value: 'A', weight: 11 }, { value: 'A', weight: 11 }]),
      calculateScore([{ value: 'A', weight: 11 }, { value: '9', weight: 9 }, { value: 'A', weight: 11 }]),
      calculateScore([{ value: 'K', weight: 10 }, { value: 'Q', weight: 10 }, { value: 'J', weight: 10 }]),
    ]);
    expect(scores).toEqual([21, 12, 21, 30]);
  });

  test('开始游戏、要牌、停牌并正确结算', async ({ page }) => {
    await freezeRandom(page);
    const errors = await open(page, PAGE_21PLUS);

    await page.locator('#bet-amount').fill('100');
    await page.locator('#btn-start-game').click();

    await expect(page.locator('#balance')).toHaveText('900');
    await expect(page.locator('#current-bet')).toHaveText('100');
    await expect(page.locator('#player-cards .card')).toHaveCount(2);
    await expect(page.locator('#dealer-cards .card')).toHaveCount(2);
    await expect(page.locator('#dealer-cards .card.back')).toHaveCount(1);
    await expect(page.locator('#player-score')).toHaveText('10');
    await expect(page.locator('#dealer-score')).toHaveText('?');
    await expect(page.locator('#btn-hit')).toBeEnabled();

    await page.locator('#btn-hit').click();
    await expect(page.locator('#player-cards .card')).toHaveCount(3);
    await expect(page.locator('#player-score')).toHaveText('19');

    await page.locator('#btn-stand').click();
    await expect(page.locator('#message-area')).toContainText('你赢了 200 元');
    await expect(page.locator('#dealer-score')).toHaveText('18');
    await expect(page.locator('#dealer-cards .card.back')).toHaveCount(0);
    await expect(page.locator('#balance')).toHaveText('1100');
    await expect(page.locator('#current-bet')).toHaveText('0');
    await expect(page.locator('#btn-start-game')).toBeEnabled();
    await expect(page.locator('#btn-hit')).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('下注为 0 时给出提示且不发牌', async ({ page }) => {
    await open(page, PAGE_21PLUS);

    await page.locator('#bet-amount').fill('0');
    await page.locator('#btn-start-game').click();

    await expect(page.locator('#message-area')).toHaveText('请输入有效下注金额');
    await expect(page.locator('#player-cards .card')).toHaveCount(0);
    await expect(page.locator('#balance')).toHaveText('1000');
  });
});
