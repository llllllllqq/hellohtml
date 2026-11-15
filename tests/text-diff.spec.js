// @ts-check
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/文本对比器/text-diff.html');

/** 在指定一侧填入文本并提交。 */
async function submit(page, side, text) {
  await page.locator(`#text${side}`).fill(text);
  await page.locator(`#submit${side}`).click();
}

test.describe('文本对比器', () => {
  test('初始状态：两侧待输入，移动端不横向溢出', async ({ page, isMobile }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(PAGE);

    await expect(page).toHaveTitle('文本对比 · Diff');
    await expect(page.locator('.ver')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.locator('#workspace')).toHaveClass(isMobile ? /stack/ : /side/);
    await expect(page.locator('#stats')).toContainText('在两侧输入文本并提交');
    await expect(page.locator('#submitA')).toBeDisabled();
    await expect(page.locator('#submitB')).toBeDisabled();
    await expect(page.locator('#nameA')).toHaveText('未选择文件');
    await expect(page.locator('#metaA')).toHaveText('可直接输入纯文本');
    await expect(page.locator('#textA')).toBeVisible();
    await expect(page.locator('#textB')).toBeVisible();
    await expect(page.locator('#clearA')).toBeHidden();

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test('输入两段文本：统计增删行并对齐显示', async ({ page }) => {
    await page.goto(PAGE);

    await submit(page, 'A', '<b>a</b>\nb\nc');
    await expect(page.locator('#nameA')).toHaveText('手动输入文本');
    await expect(page.locator('#metaA')).toContainText('3 行');
    await expect(page.locator('#submitA')).toBeDisabled();
    await expect(page.locator('#stats')).toContainText('在另一侧输入文本并提交');

    await submit(page, 'B', '<b>a</b>\nB\nc');
    await expect(page.locator('#stats')).toContainText('+1 行');
    await expect(page.locator('#stats')).toContainText('−1 行');
    await expect(page.locator('#stats')).toContainText('3 行 × 3 行');

    await expect(page.locator('#rowsA .row.eq')).toHaveCount(2);
    // 文本按纯文本渲染，<b> 不会被当成 HTML
    await expect(page.locator('#rowsA .row.eq .code').first()).toHaveText('<b>a</b>');
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('b');
    await expect(page.locator('#rowsB .row.add .code')).toHaveText('B');
    await expect(page.locator('#clearA')).toBeVisible();

    await page.locator('#clearA').click();
    await expect(page.locator('#nameA')).toHaveText('未选择文件');
    await expect(page.locator('#stats')).toContainText('在另一侧输入文本并提交');
    await expect(page.locator('#submitA')).toBeDisabled();
    await expect(page.locator('#clearA')).toBeHidden();
  });

  test('新增行：右侧显示 +1，左侧留空占位', async ({ page }) => {
    await page.goto(PAGE);

    await submit(page, 'A', 'a\nb');
    await submit(page, 'B', 'a\nb\nc');

    await expect(page.locator('#stats')).toContainText('+1 行');
    await expect(page.locator('#stats')).toContainText('−0 行');
    await expect(page.locator('#stats')).toContainText('2 行 × 3 行');
    await expect(page.locator('#rowsB .row.add .code')).toHaveText('c');
    await expect(page.locator('#rowsA .row.filler')).toHaveCount(1);
  });

  test('内容一致与「仅差异」视图', async ({ page }) => {
    await page.goto(PAGE);

    await submit(page, 'A', 'one\ntwo');
    await submit(page, 'B', 'one\ntwo');
    await expect(page.locator('#stats')).toContainText('两个文件内容一致');
    await expect(page.locator('#rowsA .row.eq')).toHaveCount(2);

    await page.locator('[data-view="diff"]').click();
    await expect(page.locator('#emptyA')).toBeVisible();
    await expect(page.locator('#emptyA')).toContainText('内容一致');
    await expect(page.locator('#emptyB')).toContainText('内容一致');
    await expect(page.locator('#rowsA .row')).toHaveCount(0);

    await page.locator('[data-view="all"]').click();
    await expect(page.locator('#emptyA')).toBeHidden();
    await expect(page.locator('#rowsA .row.eq')).toHaveCount(2);
  });

  test('「仅差异」视图用间隙折叠未修改行', async ({ page }) => {
    await page.goto(PAGE);

    await submit(page, 'A', 'a\nb\nc\nd\ne');
    await submit(page, 'B', 'a\nB\nc\nD\ne');
    await expect(page.locator('#stats')).toContainText('+2 行');
    await expect(page.locator('#stats')).toContainText('−2 行');

    await page.locator('[data-view="diff"]').click();
    // 首尾的未修改行会被去掉，只剩两处修改之间的那一行
    await expect(page.locator('#rowsA .row.gap')).toHaveCount(1);
    await expect(page.locator('#rowsA .row.gap').first()).toContainText('1 行未修改');
    await expect(page.locator('#rowsA .row.del')).toHaveCount(2);
    await expect(page.locator('#rowsB .row.add')).toHaveCount(2);
  });

  test('布局切换与横向联动开关', async ({ page, isMobile }) => {
    test.skip(isMobile, '布局切换只在桌面端跑');

    await page.goto(PAGE);

    await page.locator('[data-layout="stack"]').click();
    await expect(page.locator('#workspace')).toHaveClass(/stack/);
    await expect(page.locator('[data-layout="stack"]')).toHaveClass(/active/);

    await page.locator('[data-layout="side"]').click();
    await expect(page.locator('#workspace')).toHaveClass(/side/);
    await expect(page.locator('[data-layout="side"]')).toHaveClass(/active/);

    await page.locator('#syncX').check();
    await expect(page.locator('#syncToggle')).toHaveClass(/\bon\b/);
    await page.locator('#syncX').uncheck();
    await expect(page.locator('#syncToggle')).not.toHaveClass(/\bon\b/);
  });

  test('打开两个文件后进行对比', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#fileA').setInputFiles({
      name: 'left.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('same\nold\n'),
    });
    await page.locator('#fileB').setInputFiles({
      name: 'right.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('same\nnew\n'),
    });

    await expect(page.locator('#nameA')).toHaveText('left.txt');
    await expect(page.locator('#nameB')).toHaveText('right.txt');
    await expect(page.locator('#metaA')).toContainText('2 行');
    await expect(page.locator('#clearA')).toBeVisible();
    await expect(page.locator('#clearB')).toBeVisible();
    await expect(page.locator('#stats')).toContainText('+1 行');
    await expect(page.locator('#stats')).toContainText('−1 行');
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('old');
    await expect(page.locator('#rowsB .row.add .code')).toHaveText('new');
  });
});
