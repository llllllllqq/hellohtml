#!/usr/bin/env node
'use strict';

/**
 * 全仓库页面版本号统一管理。
 *
 * 规则：九个页面共用一个版本号。任何子项目有改动，发版时全部页面一起升到同一个版本，
 * 即使某个子项目这次一行代码都没改。
 *
 * 用法：
 *   node scripts/versions.js check            # 检查所有页面版本号是否一致
 *   node scripts/versions.js check v1.2.1     # 再检查是否等于给定版本（CI 用来对标签）
 *   node scripts/versions.js set 1.2.1        # 把所有页面统一改成 1.2.1
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const MARKER_RE = /class="ver"[^>]*>v(\d+\.\d+\.\d+)</g;
// 页面只可能出现在子项目目录里；这些目录不是子项目，扫的时候直接跳过。
const SKIP_DIRS = new Set([
  '.git',
  '.github',
  'node_modules',
  'tests',
  'scripts',
  'test-results',
  'playwright-report',
  'blob-report',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(path.relative(ROOT, full));
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function readPages() {
  return walk(ROOT).map((rel) => {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const found = [...html.matchAll(MARKER_RE)].map((m) => m[1]);
    return { rel, html, found };
  });
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function assertOneMarker(page) {
  if (page.found.length !== 1) {
    fail(`${page.rel} 里应该只有 1 个 class="ver">vX.Y.Z< 版本号，实际找到 ${page.found.length} 个`);
  }
}

function check(expected) {
  const pages = readPages();
  if (pages.length === 0) fail('没有找到任何 .html 页面');

  for (const page of pages) assertOneMarker(page);

  const versions = new Set(pages.map((page) => page.found[0]));
  if (versions.size !== 1) {
    const detail = pages.map((page) => `  ${page.rel}  v${page.found[0]}`).join('\n');
    fail(
      '各页面版本号不一致，应该全部统一成同一个版本：\n' +
        `${detail}\n\n` +
        '用 npm run version:set -- <版本号> 统一修改，例如 npm run version:set -- 1.2.1',
    );
  }

  const current = pages[0].found[0];
  if (expected !== undefined) {
    const want = String(expected).replace(/^v/, '');
    if (!VERSION_RE.test(want)) fail(`版本号格式不对：${expected}，应形如 v1.2.1`);
    if (want !== current) {
      fail(
        `标签 v${want} 与页面版本 v${current} 不一致。\n` +
          `先把全部页面升到 v${want}（npm run version:set -- ${want}）再打标签。`,
      );
    }
  }

  console.log(
    `✓ ${pages.length} 个页面版本号统一为 v${current}` +
      (expected === undefined ? '' : '，且与标签一致'),
  );
  for (const page of pages) console.log(`  ${page.rel}  v${page.found[0]}`);
}

function set(next) {
  if (!VERSION_RE.test(next)) {
    fail(`版本号格式不对：${next}，应形如 1.2.1（不带 v）`);
  }

  const pages = readPages();
  if (pages.length === 0) fail('没有找到任何 .html 页面');
  for (const page of pages) assertOneMarker(page);

  const before = [...new Set(pages.map((page) => page.found[0]))].sort();
  let changed = 0;
  for (const page of pages) {
    if (page.found[0] === next) continue;
    const html = page.html.replace(MARKER_RE, (marker) => marker.replace(/v\d+\.\d+\.\d+</, `v${next}<`));
    if (html === page.html) fail(`${page.rel} 版本号替换失败`);
    fs.writeFileSync(path.join(ROOT, page.rel), html);
    changed += 1;
  }

  const summary = changed === 0 ? `所有页面本来就是 v${next}` : `${changed} 个页面从 ${before.map((v) => `v${v}`).join(' / ')} 升到 v${next}`;
  console.log(`✓ ${pages.length} 个页面版本号已统一：${summary}`);
  console.log(`  下一步：提交改动 → git tag v${next} → 推送标签发版`);
}

const [command, arg] = process.argv.slice(2);
if (command === 'check') check(arg);
else if (command === 'set') {
  if (arg === undefined) fail('用法：node scripts/versions.js set <版本号>，例如 set 1.2.1');
  set(arg);
} else {
  fail('用法：node scripts/versions.js <check|set> [版本号]');
}
