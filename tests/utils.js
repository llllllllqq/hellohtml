const { expect } = require('@playwright/test');

/** 断言页面没有横向滚动条（移动端适配的基本要求）。 */
async function expectNoHorizontalScroll(page) {
  const info = await page.evaluate(() => {
    const wide = Array.from(document.querySelectorAll('body *'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.right > window.innerWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5);

    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      wide,
    };
  });

  expect(
    info.scrollWidth,
    `页面不应产生横向滚动；溢出元素: ${JSON.stringify(info.wide)}`,
  ).toBeLessThanOrEqual(info.innerWidth + 1);
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
