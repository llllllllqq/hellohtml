// @ts-check
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/身份证拼接器/idcard.html');

// 1x1 的 PNG，足够用来走通上传 / 裁剪 / 拼版 / 下载全流程
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadBoth(page) {
  await page.locator('#input-front').setInputFiles({
    name: 'front.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await page.locator('#input-back').setInputFiles({
    name: 'back.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.locator('#btn-jpg')).toBeEnabled();
  await expect(page.locator('#btn-pdf')).toBeEnabled();
}

test.describe('身份证扫描拼接工具', () => {
  test('初始状态与移动端布局', async ({ page, isMobile }) => {
    await page.goto(PAGE);

    await expect(page).toHaveTitle('身份证扫描拼接工具 (离线版)');
    await expect(page.locator('#btn-jpg')).toBeDisabled();
    await expect(page.locator('#btn-pdf')).toBeDisabled();
    await expect(page.locator('#status-msg')).toHaveText('');

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);

    const columns = await page.evaluate(
      () => getComputedStyle(document.querySelector('.upload-grid')).gridTemplateColumns,
    );
    // 窄屏单列，宽屏双列
    expect(columns.trim().split(/\s+/)).toHaveLength(isMobile ? 1 : 2);
  });

  test('上传正反面后预览出现，下载按钮才可用', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#input-front').setInputFiles({
      name: 'front.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.locator('#name-front')).toHaveText('front.png');
    await expect(page.locator('#card-front')).toHaveClass(/has-file/);
    await expect(page.locator('#preview-front')).toBeVisible();
    await expect(page.locator('#btn-jpg')).toBeDisabled();

    await page.locator('#input-back').setInputFiles({
      name: 'back.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.locator('#name-back')).toHaveText('back.png');
    await expect(page.locator('#card-back')).toHaveClass(/has-file/);
    await expect(page.locator('#preview-back')).toBeVisible();
    await expect(page.locator('#btn-jpg')).toBeEnabled();
    await expect(page.locator('#btn-pdf')).toBeEnabled();
  });

  test('下载 JPG：文件名正确且文件非空', async ({ page }) => {
    await page.goto(PAGE);
    await uploadBoth(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-jpg').click(),
    ]);

    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.jpg$/);
    const filePath = await download.path();
    expect(fs.statSync(filePath).size).toBeGreaterThan(1_000);
    await expect(page.locator('#status-msg')).toContainText('JPG');
  });

  test('下载 PDF：文件以 %PDF- 开头', async ({ page }) => {
    await page.goto(PAGE);
    await uploadBoth(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-pdf').click(),
    ]);

    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const filePath = await download.path();
    const buffer = fs.readFileSync(filePath);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1_000);
    await expect(page.locator('#status-msg')).toContainText('PDF');
  });

  test('上传非图片文件时给出失败提示', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('#input-front').setInputFiles({
      name: 'bad.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await page.locator('#input-back').setInputFiles({
      name: 'back.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.locator('#btn-jpg')).toBeEnabled();

    await page.locator('#btn-jpg').click();

    await expect(page.locator('#status-msg')).toContainText('处理失败');
    await expect(page.locator('#btn-jpg')).toBeEnabled();
  });
});
