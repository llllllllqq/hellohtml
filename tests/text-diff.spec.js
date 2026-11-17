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
    await expect(page.locator('#stats')).toHaveText('');
    await expect(page.locator('#submitA')).toBeDisabled();
    await expect(page.locator('#submitB')).toBeDisabled();
    await expect(page.locator('#nameA')).toHaveText('未选择文件');
    await expect(page.locator('#metaA')).toHaveText('可直接输入纯文本');
    await expect(page.locator('#textA')).toBeVisible();
    await expect(page.locator('#textB')).toBeVisible();
    await expect(page.locator('#clearA')).toBeHidden();
    await expect(page.locator('#encA')).toBeHidden();
    await expect(page.locator('#encB')).toBeHidden();

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
    await expect(page.locator('#stats')).toHaveText('');

    await submit(page, 'B', '<b>a</b>\nB\nc');
    await expect(page.locator('#stats')).toContainText('+1');
    await expect(page.locator('#stats')).toContainText('−1');

    await expect(page.locator('#rowsA .row.eq')).toHaveCount(2);
    // 文本按纯文本渲染，<b> 不会被当成 HTML
    await expect(page.locator('#rowsA .row.eq .code').first()).toHaveText('<b>a</b>');
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('b');
    await expect(page.locator('#rowsB .row.add .code')).toHaveText('B');
    await expect(page.locator('#clearA')).toBeVisible();

    await page.locator('#clearA').click();
    await expect(page.locator('#nameA')).toHaveText('未选择文件');
    await expect(page.locator('#stats')).toHaveText('');
    await expect(page.locator('#submitA')).toBeDisabled();
    await expect(page.locator('#clearA')).toBeHidden();
    await expect(page.locator('#encA')).toBeHidden();
    await expect(page.locator('#encB')).toBeHidden();
  });

  test('新增行：右侧显示 +1，左侧留空占位', async ({ page }) => {
    await page.goto(PAGE);

    await submit(page, 'A', 'a\nb');
    await submit(page, 'B', 'a\nb\nc');

    await expect(page.locator('#stats')).toContainText('+1');
    await expect(page.locator('#stats')).toContainText('−0');
    await expect(page.locator('#rowsB .row.add .code')).toHaveText('c');
    await expect(page.locator('#rowsA .row.filler')).toHaveCount(1);
  });

  test('内容一致与「仅差异」视图', async ({ page }) => {
    await page.goto(PAGE);

    await submit(page, 'A', 'one\ntwo');
    await submit(page, 'B', 'one\ntwo');
    await expect(page.locator('#stats')).toContainText('内容一致');
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
    await expect(page.locator('#stats')).toContainText('+2');
    await expect(page.locator('#stats')).toContainText('−2');

    await page.locator('[data-view="diff"]').click();
    // 首尾的未修改行会被去掉，只剩两处修改之间的那一行
    await expect(page.locator('#rowsA .row.gap')).toHaveCount(1);
    await expect(page.locator('#rowsA .row.gap').first()).toContainText('1 行未修改');
    await expect(page.locator('#rowsA .row.del')).toHaveCount(2);
    await expect(page.locator('#rowsB .row.add')).toHaveCount(2);
  });

  test('顶栏在手机窄屏保持一行', async ({ page, isMobile }) => {
    test.skip(!isMobile, '只在移动端 project 运行');

    await page.goto(PAGE);

    // 图标按钮在手机上只显示图标，文字标签隐藏
    await expect(page.locator('.lbl').first()).toBeHidden();
    await expect(page.locator('[data-layout="side"]')).toHaveAttribute('aria-label', '左右并排');
    await expect(page.locator('#inlineToggle')).toBeVisible();

    await submit(page, 'A', 'a\nb\nc');
    await submit(page, 'B', 'a\nB\nc');
    await expect(page.locator('#stats')).toContainText('+1');

    const bar = await page.locator('.topbar').evaluate((el) => {
      const brand = el.querySelector('.brand').getBoundingClientRect();
      const stats = el.querySelector('#stats').getBoundingClientRect();
      return {
        height: el.getBoundingClientRect().height,
        brandTop: brand.top,
        statsTop: stats.top,
      };
    });

    // 一行顶栏约为 38px；折成两行会超过 60px
    expect(bar.height).toBeLessThan(44);
    expect(Math.abs(bar.brandTop - bar.statsTop)).toBeLessThan(3);
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

    await page.locator('#syncToggle').click();
    await expect(page.locator('#syncToggle')).toHaveClass(/\bon\b/);
    await expect(page.locator('#syncToggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#syncToggle').click();
    await expect(page.locator('#syncToggle')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#syncToggle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('行内对比：默认关闭，打开后只高亮变化的字符', async ({ page }) => {
    await page.goto(PAGE);

    await expect(page.locator('#inlineToggle')).toHaveAttribute('aria-pressed', 'false');
    await submit(page, 'A', 'const value = 1;');
    await submit(page, 'B', 'const value = 2;');
    // 默认只有整行底色，没有行内标记
    await expect(page.locator('#rowsA .chg')).toHaveCount(0);

    await page.locator('#inlineToggle').click();
    await expect(page.locator('#inlineToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#inlineToggle')).toHaveClass(/\bon\b/);
    await expect(page.locator('#rowsA .row.del .chg')).toHaveText('1');
    await expect(page.locator('#rowsB .row.add .chg')).toHaveText('2');
    // 未变化的字符一个不少
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('const value = 1;');
    await expect(page.locator('#rowsB .row.add .code')).toHaveText('const value = 2;');

    await page.locator('#inlineToggle').click();
    await expect(page.locator('#inlineToggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#rowsA .chg')).toHaveCount(0);
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('const value = 1;');
  });

  test('行内对比：中文、emoji 与 HTML 特殊字符按纯文本高亮', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(PAGE);

    await submit(page, 'A', 'a<b>c');
    await submit(page, 'B', 'a<i>c');
    await page.locator('#inlineToggle').click();
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('a<b>c');
    await expect(page.locator('#rowsA .row.del .chg')).toHaveText('b');
    await expect(page.locator('#rowsB .row.add .chg')).toHaveText('i');
    // 尖括号被转义，没有真的插入 <b> 元素
    await expect(page.locator('#rowsA .row.del .code b')).toHaveCount(0);

    // emoji 是一个字符，不能被拆成半个代理对；重新打开页面换一组文本
    await page.goto(PAGE);
    await page.locator('#inlineToggle').click();
    await submit(page, 'A', '中文😀结束');
    await submit(page, 'B', '中文😃结束');
    await expect(page.locator('#rowsA .row.del .chg')).toHaveText('😀');
    await expect(page.locator('#rowsB .row.add .chg')).toHaveText('😃');
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('中文😀结束');

    expect(errors).toEqual([]);
  });

  test('行内对比：「仅差异」视图里同样生效', async ({ page }) => {
    await page.goto(PAGE);

    await submit(page, 'A', 'a\nb\nc\nd');
    await submit(page, 'B', 'a\nB\nc\nD');
    await page.locator('[data-view="diff"]').click();
    await page.locator('#inlineToggle').click();

    await expect(page.locator('#rowsA .row.gap')).toHaveCount(1);
    await expect(page.locator('#rowsA .row.del .chg')).toHaveCount(2);
    await expect(page.locator('#rowsA .row.del .chg').first()).toHaveText('b');
    await expect(page.locator('#rowsB .row.add .chg').first()).toHaveText('B');
  });

  test('行内对比：长行只改末尾几字仍有行内高亮，整行重写则退回整行高亮', async ({ page }) => {
    await page.goto(PAGE);

    // 前后缀裁剪后只比较末尾一个字符
    await submit(page, 'A', 'x'.repeat(2000) + 'A');
    await submit(page, 'B', 'x'.repeat(2000) + 'B');
    await page.locator('#inlineToggle').click();
    await expect(page.locator('#rowsA .row.del .chg')).toHaveText('A');
    await expect(page.locator('#rowsB .row.add .chg')).toHaveText('B');

    // 整行几乎全改：跳过字符级比较，保留整行高亮，页面不卡死也不报错
    await page.goto(PAGE);
    await page.locator('#inlineToggle').click();
    const bigA = 'p'.repeat(2500);
    const bigB = 'q'.repeat(2500);
    await submit(page, 'A', bigA);
    await submit(page, 'B', bigB);
    await expect(page.locator('#rowsA .row.del .chg')).toHaveCount(0);
    await expect(page.locator('#rowsA .row.del .code')).toHaveText(bigA);
    await expect(page.locator('#rowsB .row.add .code')).toHaveText(bigB);
  });

  test('打开 GBK 文件：自动识别编码，手动切换后重新读取', async ({ page }) => {
    await page.goto(PAGE);

    // “中文”的 GBK 字节 + CRLF + “ABC”
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a, 0x41, 0x42, 0x43]);
    await page.locator('#fileA').setInputFiles({
      name: 'gbk.txt',
      mimeType: 'text/plain',
      buffer: gbk,
    });
    await page.locator('#fileB').setInputFiles({
      name: 'utf8.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('中文\nABC', 'utf8'),
    });

    await expect(page.locator('#encA')).toBeVisible();
    await expect(page.locator('#encA')).toHaveValue('auto');
    await expect(page.locator('#metaA')).toContainText('GBK');
    await expect(page.locator('#rowsA .row.eq .code').first()).toHaveText('中文');
    await expect(page.locator('#stats')).toContainText('内容一致');

    // 手动指定 UTF-8：用原始字节重新解读，内容变成替换字符
    await page.locator('#encA').selectOption('utf-8');
    await expect(page.locator('#metaA')).toContainText('UTF-8');
    await expect(page.locator('#stats')).not.toContainText('内容一致');
    await expect(page.locator('#rowsA .row').first()).toContainText('\uFFFD');

    // 切回自动：重新推断回 GBK
    await page.locator('#encA').selectOption('auto');
    await expect(page.locator('#metaA')).toContainText('GBK');
    await expect(page.locator('#rowsA .row.eq .code').first()).toHaveText('中文');
  });

  test('混合换行符与 UTF-16 LE 文件都能正常分行', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#fileA').setInputFiles({
      name: 'mixed.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('a\r\nb\nc\rd', 'utf8'),
    });
    await expect(page.locator('#metaA')).toContainText('4 行');
    await expect(page.locator('#rowsA .row.plain .code')).toHaveCount(4);
    await expect(page.locator('#rowsA .row.plain .code').nth(1)).toHaveText('b');

    await page.locator('#fileB').setInputFiles({
      name: 'utf16le.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x0d, 0x00, 0x0a, 0x00, 0x62, 0x00]),
    });
    await expect(page.locator('#metaB')).toContainText('UTF-16 LE');
    await expect(page.locator('#metaB')).toContainText('2 行');
    await expect(page.locator('#nameB')).toHaveText('utf16le.txt');
    await expect(page.locator('#rowsB .row.eq .code')).toHaveCount(2);
    await expect(page.locator('#rowsB .row.eq .code').nth(1)).toHaveText('b');
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
    await expect(page.locator('#stats')).toContainText('+1');
    await expect(page.locator('#stats')).toContainText('−1');
    await expect(page.locator('#rowsA .row.del .code')).toHaveText('old');
    await expect(page.locator('#rowsB .row.add .code')).toHaveText('new');
  });
});
