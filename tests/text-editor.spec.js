// @ts-check
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/文本编辑器/text-editor.html');

async function selection(page) {
  return page.locator('#editor').evaluate((el) => [el.selectionStart, el.selectionEnd]);
}

test.describe('文本编辑器', () => {
  test('初始状态：空白文档、默认编码与换行，移动端不横向溢出', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(PAGE);

    await expect(page).toHaveTitle('未命名.txt · 文本编辑器');
    await expect(page.locator('.ver')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.locator('#fileName')).toHaveValue('未命名.txt');
    await expect(page.locator('#editor')).toHaveValue('');
    await expect(page.locator('#fsLabel')).toHaveText('16');
    await expect(page.locator('#bWrap')).toHaveClass(/\bon\b/);
    await expect(page.locator('#findbar')).toHaveClass(/hide/);
    await expect(page.locator('#bUndo')).toBeDisabled();
    await expect(page.locator('#bRedo')).toBeDisabled();
    await expect(page.locator('#placeholder')).toBeVisible();
    await expect(page.locator('#placeholder')).toContainText('本地文本编辑器');
    await expect(page.locator('#filebar .brand')).toHaveCount(0);

    await expect(page.locator('#status')).toContainText('行 1，列 1');
    await expect(page.locator('#status')).toContainText('共 1 行 / 0 字符');
    await expect(page.locator('#status')).toContainText('编码 UTF-8');
    await expect(page.locator('#status')).toContainText('换行 LF');
    await expect(page.locator('#status')).toContainText('✓ 已保存');

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test('输入、撤销、重做，占位符随内容隐藏', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#editor').fill('abc');
    await expect(page.locator('#status')).toContainText('● 已修改');
    await expect(page).toHaveTitle('● 未命名.txt · 文本编辑器');
    await expect(page.locator('#bUndo')).toBeEnabled();
    await expect(page.locator('#placeholder')).toBeHidden();

    await page.locator('#bUndo').click();
    await expect(page.locator('#editor')).toHaveValue('');
    await expect(page.locator('#status')).toContainText('✓ 已保存');
    await expect(page.locator('#bRedo')).toBeEnabled();

    await page.locator('#bRedo').click();
    await expect(page.locator('#editor')).toHaveValue('abc');

    // 清空后标题占位符重新出现
    await page.locator('#editor').fill('');
    await expect(page.locator('#placeholder')).toBeVisible();
  });

  test('新建：Ctrl+N 触发未保存确认', async ({ page, isMobile }) => {
    test.skip(isMobile, '新建改为刷新页面或 Ctrl+N，只在桌面端测确认框');

    await page.goto(PAGE);
    await page.locator('#editor').fill('abc');

    let dialogMessage = '';
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });
    await page.keyboard.press('Control+n');
    await expect(page.locator('#editor')).toHaveValue('');
    await expect(page.locator('#fileName')).toHaveValue('未命名.txt');
    await expect(page).toHaveTitle('未命名.txt · 文本编辑器');
    await expect(page.locator('#bUndo')).toBeDisabled();
    expect(dialogMessage).toContain('未保存');
  });

  test('打开 UTF-8 BOM 文件：识别编码、换行并规范化为 LF', async ({ page }) => {
    await page.goto(PAGE);

    const buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('第一行\r\n第二行', 'utf8'),
    ]);
    await page.locator('#fileInput').setInputFiles({
      name: 'bom.txt',
      mimeType: 'text/plain',
      buffer,
    });

    await expect(page.locator('#fileName')).toHaveValue('bom.txt');
    await expect(page.locator('#editor')).toHaveValue('第一行\n第二行');
    await expect(page.locator('#status')).toContainText('编码 UTF-8 BOM');
    await expect(page.locator('#status')).toContainText('换行 CRLF');
    await expect(page.locator('#status')).toContainText('末尾无换行');
    await expect(page.locator('#status')).toContainText('✓ 已保存');
    await expect(page.locator('#hint')).toContainText('已打开 bom.txt');
    await expect(page.locator('#hint')).toContainText('含 BOM');
    await expect(page.locator('#encSel option').first()).toHaveText(isMobile ? '自' : '自动识别 · UTF-8 BOM');
    await expect(page.locator('#eolSel option').first()).toHaveText(isMobile ? '自' : '自动识别 · CRLF');
    await expect(page).toHaveTitle('bom.txt · 文本编辑器');
  });

  test('保存为 UTF-8：文件名与内容正确', async ({ page, isMobile }) => {
    test.skip(isMobile, '下载用例只在桌面端跑');

    await page.goto(PAGE);
    await page.locator('#fileName').fill('note.txt');
    await page.locator('#editor').fill('第一行\n第二行');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#bSave').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('note.txt');
    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    const bytes = fs.readFileSync(filePath);
    expect(bytes.equals(Buffer.from('第一行\n第二行', 'utf8'))).toBe(true);

    await expect(page.locator('#status')).toContainText('✓ 已保存');
    await expect(page).toHaveTitle('note.txt · 文本编辑器');
    await expect(page.locator('#hint')).toContainText('已下载：note.txt');
  });

  test('保存为 GBK + CRLF：字节与换行正确', async ({ page, isMobile }) => {
    test.skip(isMobile, '下载用例只在桌面端跑');

    await page.goto(PAGE);
    await page.locator('#fileName').fill('gbk.txt');
    await page.locator('#editor').fill('中文\n中文');
    await page.locator('#encSel').selectOption('gbk');
    await page.locator('#eolSel').selectOption('crlf');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#bSave').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('gbk.txt');
    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    const bytes = fs.readFileSync(filePath);
    // GBK: 中文 = D6 D0 CE C4；CRLF = 0D 0A
    expect([...bytes]).toEqual([
      0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a, 0xd6, 0xd0, 0xce, 0xc4,
    ]);

    await expect(page.locator('#status')).toContainText('编码 GBK');
    await expect(page.locator('#status')).toContainText('换行 CRLF');
    await expect(page.locator('#hint')).toContainText('GBK · CRLF');
  });

  test('查找、上一个/下一个与全部替换', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#editor').fill('foo bar foo');
    await page.locator('#bFind').click();
    await expect(page.locator('#findbar')).not.toHaveClass(/hide/);
    await page.locator('#findQ').fill('foo');
    await expect(page.locator('#findInfo')).toHaveText('2 处匹配');

    await page.locator('#bNext').click();
    expect(await selection(page)).toEqual([0, 3]);
    await expect(page.locator('#findInfo')).toHaveText('1 / 2');

    await page.locator('#bNext').click();
    expect(await selection(page)).toEqual([8, 11]);
    await expect(page.locator('#findInfo')).toHaveText('2 / 2');

    await page.locator('#bPrev').click();
    expect(await selection(page)).toEqual([0, 3]);
    await expect(page.locator('#findInfo')).toHaveText('1 / 2');

    await page.locator('#repQ').fill('baz');
    await page.locator('#bReplaceAll').click();
    await expect(page.locator('#editor')).toHaveValue('baz bar baz');
    await expect(page.locator('#findInfo')).toHaveText('0 处匹配');
    await expect(page.locator('#hint')).toContainText('已替换 2 处');

    await page.keyboard.press('Escape');
    await expect(page.locator('#findbar')).toHaveClass(/hide/);
  });

  test('查找支持区分大小写，并提示正则错误', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#editor').fill('Foo foo');
    await page.locator('#bFind').click();
    await page.locator('#findQ').fill('foo');
    await expect(page.locator('#findInfo')).toHaveText('2 处匹配');

    await page.locator('#caseChk').check();
    await expect(page.locator('#findInfo')).toHaveText('1 处匹配');

    await page.locator('#caseChk').uncheck();
    await page.locator('#regexChk').check();
    await page.locator('#findQ').fill('[');
    await expect(page.locator('#findInfo')).toHaveText('正则错误');
  });

  test('手机端顶栏用图标和短标签，高度受控', async ({ page, isMobile }) => {
    test.skip(!isMobile, '只在移动端 project 运行');

    await page.goto(PAGE);

    await expect(page.locator('#bar .lbl').first()).toBeHidden();
    await expect(page.locator('#bOpen')).toHaveAttribute('aria-label', '打开文件');
    await expect(page.locator('#bWrap')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#bRedecode')).toContainText('重解');
    await expect(page.locator('#encSel option').first()).toHaveText('自');

    const barHeight = await page.locator('#bar').evaluate((el) => el.getBoundingClientRect().height);
    const fileBarHeight = await page.locator('#filebar').evaluate((el) => el.getBoundingClientRect().height);
    expect(barHeight).toBeLessThan(110);
    expect(fileBarHeight).toBeLessThan(46);

    await expect(page.locator('#placeholder')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('字号与自动换行偏好会保存', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#bFontUp').click();
    await page.locator('#bFontUp').click();
    await page.locator('#bFontDown').click();
    await expect(page.locator('#fsLabel')).toHaveText('17');

    await page.locator('#bWrap').click();
    await expect(page.locator('#bWrap')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#editor')).toHaveClass(/nowrap/);

    await page.reload();
    await expect(page.locator('#fsLabel')).toHaveText('17');
    await expect(page.locator('#bWrap')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#editor')).toHaveClass(/nowrap/);
    await expect(page.locator('#status')).toContainText('编码 UTF-8');
  });

  test('快捷键 Ctrl+F 打开查找，Esc 关闭', async ({ page, isMobile }) => {
    test.skip(isMobile, '快捷键只在桌面端跑');

    await page.goto(PAGE);
    await page.locator('#editor').focus();

    await page.keyboard.press('Control+f');
    await expect(page.locator('#findbar')).not.toHaveClass(/hide/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#findbar')).toHaveClass(/hide/);
  });

  test('内置编码自检通过', async ({ page, isMobile }) => {
    test.skip(isMobile, '编码自检只在桌面端跑');
    test.setTimeout(90_000);
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(PAGE + '?selftest');

    await expect(page.locator('#selftest')).toBeVisible({ timeout: 60_000 });
    const result = await page.locator('#selftest').innerText();
    expect(result).not.toContain('FAIL');
    expect(result).toContain('PASS | 往返 gbk');
    expect(result).toContain('PASS | BOM UTF-8');
  });
});
