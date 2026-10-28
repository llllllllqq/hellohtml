// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');

/** 非子项目目录：`.gitignore` 里列出的构建/报告目录，外加仓库自己的 .github 与 tests。 */
const IGNORED = new Set(['.github', 'tests']);
for (const line of fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/)) {
  const name = line.trim().replace(/\/$/, '');
  if (name && !name.startsWith('#')) IGNORED.add(name);
}

/** 仓库里每个子项目文件夹：根目录下一层、不以点开头、排除 .github / tests。 */
function subprojects() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && !IGNORED.has(name));
}

test.describe('仓库结构自检', () => {
  test('每个子项目都有 README，且里面提到了该目录下的页面文件', () => {
    const folders = subprojects();
    expect(folders.length, '根目录下应至少有 7 个子项目').toBeGreaterThanOrEqual(7);

    for (const folder of folders) {
      const dir = path.join(ROOT, folder);
      const readmePath = path.join(dir, 'README.md');
      expect(fs.existsSync(readmePath), `${folder} 缺少 README.md`).toBe(true);

      const readme = fs.readFileSync(readmePath, 'utf8');
      expect(readme.length, `${folder}/README.md 内容太短`).toBeGreaterThan(200);
      // 每个 README 都应该以标题开头
      expect(readme.trimStart().startsWith('# '), `${folder}/README.md 应以一级标题开头`).toBe(true);

      const pages = fs.readdirSync(dir).filter((name) => name.endsWith('.html'));
      expect(pages.length, `${folder} 里应该至少有一个 .html 页面`).toBeGreaterThan(0);
      for (const page of pages) {
        expect(readme, `${folder}/README.md 没有提到 ${page}`).toContain(page);
      }
    }
  });

  test('每个页面都在正文标注版本号，且 <title> 里不带版本号', () => {
    for (const folder of subprojects()) {
      const dir = path.join(ROOT, folder);
      for (const page of fs.readdirSync(dir).filter((name) => name.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(dir, page), 'utf8');

        const markers = html.match(/class="ver"[^>]*>v\d+\.\d+\.\d+</g) || [];
        expect(markers, `${folder}/${page} 应该有且只有一个正文版本号`).toHaveLength(1);

        const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        expect(title, `${folder}/${page} 的 <title> 里不应带版本号`).not.toMatch(/v\d+\.\d+\.\d+/);
      }
    }
  });

  test('根 README 的结构表列出了每个子项目', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

    for (const folder of subprojects()) {
      expect(readme, `根 README 的结构表缺少 ${folder}`).toContain(`[${folder}](${folder}/)`);
    }
  });
});
