const { expect } = require('@playwright/test');

/** 断言页面没有横向滚动条（移动端适配的基本要求）。 */
async function expectNoHorizontalScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, '页面不应产生横向滚动').toBeLessThanOrEqual(innerWidth + 1);
}

/** 断言页面声明了 width=device-width 的 viewport。 */
async function expectResponsiveViewport(page) {
  const content = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    return meta ? meta.getAttribute('content') : '';
  });
  expect(content, '应声明 width=device-width 的 viewport').toContain('width=device-width');
}

module.exports = { expectNoHorizontalScroll, expectResponsiveViewport };
