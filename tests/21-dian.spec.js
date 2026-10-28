// @ts-check
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE_21 = encodeURI('/21点游戏/21.html');
const PAGE_21PLUS = encodeURI('/21点游戏/21plus.html');

/**
 * 固定种子的牌局（两个版本牌序一致）：
 * - seed 1：玩家 10 点，要牌后 19 点，庄家 18 点（赢）
 * - seed 2：玩家 16 点，庄家补到 25 点（庄家爆牌）
 * - seed 3：玩家 13 点，要牌后 23 点（爆牌）
 * - seed 15：玩家 20 点，庄家 20 点（平局）
 * - seed 20：玩家 10 点，要牌后 19 点，庄家 18 点；第二局起手 12 点（连局）
 * - seed 62：玩家起手 21 点，庄家 19 点（黑杰克）
 */
const SEEDS = {
  win: 1,
  dealerBust: 2,
  bust: 3,
  push: 15,
  replay: 20,
  blackjack: 62,
};

const VARIANTS = [
  {
    name: '普通版 21.html',
    url: PAGE_21,
    selectors: {
      bet: '#bet-amount',
      start: '#btn-start-test',
      hit: '#btn-hit',
      stand: '#btn-stand',
      balance: '#balance',
      playerCards: '#player-cards span',
      playerScore: '#player-score',
      dealerScore: '#dealer-score',
      message: '#msg',
    },
    messages: {
      bust: '超分',
      push: '平局',
      dealerBust: '老师超分',
      win: '你通过了测试',
      lose: '测试未通过',
      insufficient: '学分不足',
    },
  },
  {
    name: 'Plus 版 21plus.html',
    url: PAGE_21PLUS,
    selectors: {
      bet: '#bet-amount',
      start: '#btn-start-game',
      hit: '#btn-hit',
      stand: '#btn-stand',
      balance: '#balance',
      playerCards: '#player-cards .card',
      playerScore: '#player-score',
      dealerScore: '#dealer-score',
      message: '#message-area',
    },
    messages: {
      bust: '爆牌',
      push: '平局',
      dealerBust: '庄家爆牌',
      win: '你赢了',
      lose: '庄家赢了',
      insufficient: '余额不足',
    },
  },
];

/**
 * 用固定种子替换 Math.random，让洗牌和发牌结果可复现。
 */
async function freezeRandom(page, seed) {
  await page.addInitScript((value) => {
    let a = value;
    Math.random = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
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
    await expect(page.locator('h1')).toContainText('学术能力测试 (Academic Test)');
    await expect(page.locator('h1 .ver')).toHaveText(/^v\d+\.\d+\.\d+$/);
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
    await freezeRandom(page, SEEDS.win);
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
    await freezeRandom(page, SEEDS.win);
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

for (const variant of VARIANTS) {
  const s = variant.selectors;

  test.describe(`21点游戏 · ${variant.name} · 边界`, () => {
    test('起手 21 点自动结算并获胜', async ({ page }) => {
      await freezeRandom(page, SEEDS.blackjack);
      const errors = await open(page, variant.url);

      await page.locator(s.bet).fill('10');
      await page.locator(s.start).click();

      await expect(page.locator(s.playerScore)).toHaveText('21');
      await expect(page.locator(s.message)).toContainText(variant.messages.win, {
        timeout: 10_000,
      });
      await expect(page.locator(s.dealerScore)).toHaveText('19');
      await expect(page.locator(s.balance)).toHaveText('1010');
      await expect(page.locator(s.start)).toBeEnabled();
      await expect(page.locator(s.hit)).toBeDisabled();

      expect(errors).toEqual([]);
    });

    test('要牌超过 21 点即爆牌，本局结束并扣掉下注', async ({ page }) => {
      await freezeRandom(page, SEEDS.bust);
      await open(page, variant.url);

      await page.locator(s.bet).fill('10');
      await page.locator(s.start).click();
      await expect(page.locator(s.playerScore)).toHaveText('13');

      await page.locator(s.hit).click();
      await expect(page.locator(s.playerScore)).toHaveText('23');
      await expect(page.locator(s.message)).toContainText(variant.messages.bust);
      await expect(page.locator(s.balance)).toHaveText('990');
      await expect(page.locator(s.start)).toBeEnabled();
      await expect(page.locator(s.hit)).toBeDisabled();
    });

    test('与庄家点数相同则平局，退回本金', async ({ page }) => {
      await freezeRandom(page, SEEDS.push);
      await open(page, variant.url);

      await page.locator(s.bet).fill('10');
      await page.locator(s.start).click();
      await expect(page.locator(s.playerScore)).toHaveText('20');

      await page.locator(s.stand).click();
      await expect(page.locator(s.message)).toContainText(variant.messages.push);
      await expect(page.locator(s.dealerScore)).toHaveText('20');
      await expect(page.locator(s.balance)).toHaveText('1000');
      await expect(page.locator(s.start)).toBeEnabled();
    });

    test('庄家爆牌，玩家即使点数不高也能获胜', async ({ page }) => {
      await freezeRandom(page, SEEDS.dealerBust);
      await open(page, variant.url);

      await page.locator(s.bet).fill('10');
      await page.locator(s.start).click();
      await expect(page.locator(s.playerScore)).toHaveText('16');

      await page.locator(s.stand).click();
      await expect(page.locator(s.message)).toContainText(variant.messages.dealerBust);
      await expect(page.locator(s.dealerScore)).toHaveText('25');
      await expect(page.locator(s.balance)).toHaveText('1010');
    });

    test('庄家点数更高则输掉下注', async ({ page }) => {
      await freezeRandom(page, SEEDS.win);
      await open(page, variant.url);

      await page.locator(s.bet).fill('10');
      await page.locator(s.start).click();
      await expect(page.locator(s.playerScore)).toHaveText('10');

      await page.locator(s.stand).click();
      await expect(page.locator(s.message)).toContainText(variant.messages.lose);
      await expect(page.locator(s.dealerScore)).toHaveText('21');
      await expect(page.locator(s.balance)).toHaveText('990');
      await expect(page.locator(s.start)).toBeEnabled();
    });

    test('下注超过余额时拒绝开局', async ({ page }) => {
      await open(page, variant.url);

      await page.locator(s.bet).fill('2000');
      await page.locator(s.start).click();

      await expect(page.locator(s.message)).toContainText(variant.messages.insufficient);
      await expect(page.locator(s.playerCards)).toHaveCount(0);
      await expect(page.locator(s.balance)).toHaveText('1000');
      await expect(page.locator(s.start)).toBeEnabled();
    });

    test('一局结束后可以再来一局，余额继续累计', async ({ page }) => {
      await freezeRandom(page, SEEDS.replay);
      await open(page, variant.url);

      await page.locator(s.bet).fill('10');
      await page.locator(s.start).click();
      await page.locator(s.hit).click();
      await page.locator(s.stand).click();
      await expect(page.locator(s.balance)).toHaveText('1010');
      await expect(page.locator(s.start)).toBeEnabled();

      await page.locator(s.start).click();
      await expect(page.locator(s.balance)).toHaveText('1000');
      await expect(page.locator(s.playerCards)).toHaveCount(2);
      await expect(page.locator(s.start)).toBeDisabled();
      await expect(page.locator(s.hit)).toBeEnabled();
    });
  });
}

// 上面所有用例都会在 desktop-chromium / mobile-chrome / mobile-safari
// 三个 project 里各跑一遍；下面再补一组只在移动端执行的触控与布局检查。
test.describe('21点游戏 · 移动端兼容性', () => {
  for (const variant of VARIANTS) {
    const s = variant.selectors;

    test(`${variant.name}：窄屏无横向溢出，可触控开始`, async ({ page, isMobile }) => {
      test.skip(!isMobile, '仅在移动端 project 运行');
      await freezeRandom(page, SEEDS.win);
      await open(page, variant.url);

      await expectResponsiveViewport(page);
      await expectNoHorizontalScroll(page);

      const viewport = page.viewportSize();
      const startBox = await page.locator(s.start).boundingBox();
      expect(viewport).not.toBeNull();
      expect(startBox).not.toBeNull();
      expect(startBox.x).toBeGreaterThanOrEqual(-1);
      expect(startBox.x + startBox.width).toBeLessThanOrEqual(viewport.width + 1);

      await page.locator(s.bet).fill('10');
      await page.locator(s.start).tap();

      await expect(page.locator(s.playerCards)).toHaveCount(2);
      await expect(page.locator(s.hit)).toBeEnabled();
      await expect(page.locator(s.balance)).toHaveText('990');
    });
  }
});
