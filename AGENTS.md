# AGENTS.md · hellohtml 工作手册

本文件写给在本仓库工作的 AI 代理（也适用于人类贡献者），记录这个项目**怎么做、为什么这样做、哪里容易踩坑**。产品介绍、用法和功能细节在根 [README.md](README.md) 与各子项目的 README 里，这里不重复。

当前基线：**v1.10.0**，10 个子项目、12 个 HTML 页面。数字会随项目变化，下面这些规则不变。

动手前建议按顺序读：

1. 根 [README.md](README.md)：项目定位、版本规则、测试与发布流程
2. 目标子项目的 `README.md`：功能边界、数据行为、已知限制
3. 本文件：约定、范式、坑
4. 改测试前，先看 [tests/structure.spec.js](tests/structure.spec.js) 和 [tests/utils.js](tests/utils.js)

## 1. 不可协商的约定

1. **单文件、零依赖、离线可用**：每个页面就是一个 `.html`，CSS / JS / 图标全部内联，双击 `file://` 能打开，不依赖构建、npm 包、CDN、后端或网络。
2. **不擅自删功能、改需求**：用户要的是“低视觉门槛”就只降视觉门槛；要“加检测”就不要顺手改提醒规则。拿不准先问。
3. **游戏子项目默认不动**：`21点游戏`、`击鼓传花游戏`、`文字颜色游戏`、`生日老虎机游戏` 本身就是卖视觉效果，除用户明确要求或明确的功能性 bug 外，只同步版本号，不重排样式、不改玩法。
4. **工具类项目优先兼容性**：`身份证拼接器`、`音视频剪切器`、`音频发生器`、`提醒器` 在不牺牲功能的前提下，尽量少用抬高浏览器门槛的 CSS。能用 margin 就不依赖 flex `gap`，能用 `padding-top` 比例盒就不依赖 `aspect-ratio`。
5. **全仓库共用一个版本号**：任何页面有改动，所有页面一起升到同一个版本；发版标签必须等于这个版本。
6. **验证优先交给云端 CI**：默认不在本地装浏览器跑全量 Playwright；本地最多单跑一个 spec 定位问题，结论以 GitHub Actions 为准。
7. **文档如实写限制**：做不到的事、会晚几十秒的事、哪些浏览器不支持，写进 README 的“已知限制”，不要用模糊说法糊过去。
8. **交付说人话**：对用户用中文汇报，先给结果、链接和测试数字，再补充实现细节。

### 1.1 这些约定换来了什么

- 单文件 + 离线：用户双击就能用，分享只需要发一个 `.html`，不会被 CDN、构建或后端拖累。
- 统一版本 + 一条命令升版：用户下载任何一个 zip 都是一套同版本的页面，不会出现“提醒器是新版、剪切器还是旧版”。
- 云端 CI + 三环境：本机不装浏览器也能覆盖桌面 Chrome、Android Chrome 和 iPhone 的 WebKit 模拟；代价是每轮要等几分钟。
- 发布包只放 HTML：下载即用，不把 README、测试和仓库结构塞给用户；代价是 `21点游戏/bg.jpg` 不在包里，需要用户自己补。
- 游戏不动、工具降门槛：游戏卖的是观感，工具卖的是“在哪都能打开”；两类项目的取舍不同，不要互相套用。

## 2. 常用命令

| 目的 | 命令 |
| --- | --- |
| 检查所有页面版本号是否一致 | `npm run version:check` |
| 把所有页面统一升到新版本 | `npm run version:set -- 1.10.0` |
| 看最近的 CI / Release 运行 | `gh run list --repo llllllllqq/hellohtml --limit 5` |
| 看某次运行的结果 | `gh run view <run-id> --repo llllllllqq/hellohtml` |
| 只看失败日志 | `gh run view <run-id> --repo llllllllqq/hellohtml --log-failed` |
| 看某个 Release 的附件 | `gh release view v1.10.0 --repo llllllllqq/hellohtml --json assets` |
| 本地单跑一个 spec（仅当已装好浏览器） | `npx playwright test tests/xxx.spec.js --project=desktop-chromium` |

这个仓库的日常验证放在云端；本机没装浏览器时，不要为了“验证一下”去 `npm ci` + `npx playwright install` 跑全量，直接推分支让 CI 跑，成本更低也更接近最终环境。

## 3. 目录结构

```text
.
├── AGENTS.md                 # 本文件
├── README.md                 # 项目总览、版本规则、测试与发布说明
├── CHANGELOG.md              # 每次发版的更新记录（按版本倒序）
├── package.json              # 只有 Playwright 与版本脚本，没有运行时依赖
├── playwright.config.js      # 3 个 project：桌面 Chrome / Pixel 5 / iPhone 13
├── scripts/
│   └── versions.js           # 统一读写各页面的 class="ver" 版本号
├── tests/
│   ├── structure.spec.js     # 仓库结构自检（README、版本号、根 README 表格）
│   ├── utils.js              # 横向溢出、viewport 断言
│   ├── server.js             # 测试用静态文件服务器
│   ├── fixtures/             # 剪切器的媒体夹具（已提交，CI 不需要 ffmpeg）
│   ├── utils/                # 容器解析、剪切辅助
│   └── <subproject>.spec.js  # 每个子项目一个测试文件
├── .github/workflows/
│   ├── ci.yml                # push main / PR / release published / 手动
│   ├── test.yml              # 可复用的 Playwright 测试
│   └── release.yml           # 推 v* 标签后校验版本、打 HTML 包、发 Release
└── <子项目>/
    ├── <page>.html           # 单文件成品
    └── README.md             # 每个子项目必须有
```

子项目目录用中文名，页面文件用语义清晰的英文 kebab-case（例如 `音频发生器/tone-generator.html`）。一个子项目可以有多个页面（`21点游戏`、`音视频剪切器`），但一个页面必须自带全部代码。

## 4. 新增一个子项目的标准流程

### 4.1 建目录和页面

- 新建中文子项目目录，放入单文件 HTML，文件名用英文 kebab-case。
- 如果是从外部单文件改造：先通读原文件，保留功能，删掉统计、追踪、外部请求；不要引入任何运行时依赖。
- 页面本身要能独立打开；除 `提醒器` 的可选 `config.txt`、`21点游戏` 的可选 `bg.jpg`（缺失只影响背景）外，不依赖同目录其他文件。

### 4.2 套页面规范

- 补 `lang="zh-CN"`、`<meta charset>`、viewport、`color-scheme`。
- 在页面可见标题里加**恰好一个**版本标记：`<span class="ver">v1.10.0</span>`。
- `<title>` 只写功能名，不带版本号。
- 详细清单见第 5 节。

### 4.3 写子项目 README

按第 8 节的结构写，至少包含：功能、用法/快捷键、数据行为、测试、已知限制、浏览器兼容。README 里必须提到该目录下的页面文件名，否则结构测试会失败。

### 4.4 写测试

新建 `tests/<subproject>.spec.js`，按第 7 节的模板写。至少覆盖：

- 初始状态、关键控件和默认值
- 移动端 viewport 与无横向滚动
- 没有未捕获的 JS 异常（`pageerror`）
- 主流程（用户真实点击路径）
- 边界与错误分支
- 桌面端才有的能力（音频引擎、键盘）用 `test.skip(isMobile, ...)` 跳过

### 4.5 更新根 README

至少改这几处，漏一处就会留下不一致：

- “项目结构”表格加一行 `[子项目](子项目/)`
- 正文里的子项目数量（当前“十个子项目”）和页面数量（当前“十二个页面”）
- “测试覆盖”列表加上新子项目
- 版本示例（`git tag v1.10.0`、`npm run version:set -- 1.10.0`）按当前版本更新
- 如果新增了测试文件，补一条覆盖说明

### 4.6 统一版本并验证

```bash
npm run version:set -- 1.10.0
npm run version:check
```

`version:set` 会改所有页面；如果 `git diff --stat` 里少了某个页面，说明它的版本标记写法不对，先修页面再继续。

### 4.7 提交、CI、发版

按第 9 节流程走。新文件记得 `git add`，否则 `git archive` 打不进发布包。

## 5. 单文件页面规范

### 5.1 基本骨架

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>功能名 · 一句话定位</title>
<style>/* 全部内联 */</style>
</head>
<body>
  <h1>功能名 <span class="ver">v1.10.0</span></h1>
  <!-- 页面内容 -->
<script>/* 全部内联 */</script>
</body>
</html>
```

- `color-scheme` 要和页面底色一致：白底写 `light`，深色底写 `dark`。不写会让数字输入框、滚动条、表单控件在部分浏览器里变成反色。
- 工具类页面不要加 `user-scalable=no`；游戏为了拖动/双击体验可以加。
- 新页面尽量保持一个 `h1`，正文用 `h2/h3`；现有页面（例如提醒器用 `.hd-title` 容器）不强制回改。

### 5.2 版本标记

- 每页**有且只有一个** `class="ver"` 的元素，内容是 `vX.Y.Z`。
- 位置在页面可见的标题区域（`h1` 里或页面标题容器里），不要只写在注释或 `<title>` 里。
- 不要用 `id="ver"`、`data-version` 等其它写法，`scripts/versions.js` 只认 `class="ver">vX.Y.Z<`。
- 测试里断言版本号用正则 `/^v\d+\.\d+\.\d+$/`，**不要写死 `v1.10.0`**，否则下次统一升版会误报。

### 5.3 离线与 `file://`

- 不引用 CDN、外部字体、外部图标库、外部音频/视频；图标用内联 SVG 或字符。
- 不在运行时 `fetch` / `XMLHttpRequest` 本地文件；`file://` 下会被 CORS 拦住。需要读文件就用 `<input type="file">` + `FileReader`。
- 不使用 Service Worker；本项目没有后台进程，页面关掉就结束。
- 系统通知只在 http(s) 下可用，`file://` 下要降级为页内弹层/标题闪烁，并在 README 写明。
- 页面里的链接、下载文件名、导出内容都用相对路径或 Blob，不依赖服务器。

### 5.4 浏览器兼容

先确定这个页面要支持到哪一档，再决定能不能用某个特性。常用门槛：

| 特性 | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| `async/await` | 55 | 52 | 10.1 |
| `clamp()` | 79 | 75 | 13.1 |
| flex `gap` | 84 | 63 | 14.1 |
| `:focus-visible` | 86 | 85 | 15.4 |
| `aspect-ratio` | 88 | 89 | 15 |
| `accent-color` | 93 | 92 | 15.4 |

原则：

- **布局和主功能**不能依赖高门槛特性；能换就换（flex `gap` → 子元素 margin；`aspect-ratio` → `padding-top` 比例盒）。
- `:focus-visible`、`accent-color`、动画细节这类**纯视觉增强**可以用，但要接受旧浏览器只是“不够好看”，不能因此不可用。
- 如果确实用了会抬高门槛的特性，在子项目 README 的“浏览器兼容”表里写清楚最低版本和“卡在哪”。
- Firefox 不在 CI 矩阵里，兼容表要注明“按特性支持推算”，不要写成已实测。

### 5.5 布局与移动端

- 目标宽度按 360–390px 检查；所有页面都必须通过 `expectNoHorizontalScroll`。
- 容器加 `box-sizing: border-box`；flex 子项加 `min-width: 0`，防止长单词/长数字把布局撑破。
- 长文件名、长提醒内容、大数字要能换行或截断，不能撑出屏幕。
- 固定像素宽度只用在确实不会溢出的小控件上；大块区域用 `max-width` + 百分比。
- Canvas 要按 `devicePixelRatio` 设置像素尺寸，避免模糊；同时处理容器缩放。

### 5.6 交互与可访问性

- 新增/改动的输入要有可见的 `<label>` 或 `aria-label`；按钮优先用 `<button>`，不要新造可点击的 `div`。
- 键盘可达：Tab 能走到主要控件；`Esc` 关闭弹层；输入框聚焦时不要让全局快捷键抢按键。
- 焦点样式不要直接 `outline: none` 而不给替代；至少保留 `:focus` 或 `:focus-visible` 的可见反馈。
- 危险操作（删除、覆盖导入）要二次确认；优先用页内弹层。现有页面（提醒器）用的是原生 `confirm`，测试要处理 dialog，不要为了统一去改它的交互。
- 加载/处理中要禁用按钮并给状态文字，避免重复提交。
- 错误提示要具体（哪个文件、什么原因），不要只写“失败”。

### 5.7 声音、媒体与清理

- `AudioContext` 必须在用户手势后创建或 `resume()`；不要页面一打开就自动出声。
- 兼容 `window.AudioContext || window.webkitAudioContext`。
- iOS Safari 对自动播放更严格，测试里要模拟“先点一下状态条/播放按钮”的路径。
- 页面卸载（`pagehide`）时停止振荡器、断开节点、关闭音频上下文；页面只是隐藏时不要误停正在播放的声音，除非产品明确要求。
- Blob URL 用完 `revokeObjectURL`，否则长时间使用会漏内存。
- 大文件处理尽量分片/流式，不要把整个文件复制多份；下载用 `Blob` + `<a download>`。

### 5.8 数据与安全

- 只在功能确实需要时持久化；能内存里解决的（比如音频发生器的频率）刷新即恢复默认，并在 README 写明。
- 持久化 key 要带项目前缀，避免和同源其它页面冲突；读写包 `try/catch`，配额满或隐私模式要能降级。
- 用户输入渲染到页面前先转义，优先 `textContent`，不要拼 `innerHTML`。
- 不发送任何用户数据；不引入第三方统计。
- 导入备份/配置时校验结构，损坏文件要给明确提示，不能整页崩掉。

## 6. 版本号规则（最容易出错）

- **唯一事实来源**是每个页面里的 `class="ver">vX.Y.Z<`，不是 `package.json` 的 `version`（它只是占位，不参与发版）。
- 全仓库**所有页面**共用一个版本。只改了提醒器，十二个页面也全部升到新版本，没改的子项目不能留在旧版本。
- 发版标签 `vX.Y.Z` 必须和页面版本完全一致。
- **只改文档、没动页面**时：版本号全部不动，也不打标签。
- 统一升版只用脚本，不要手改十二个文件：

```bash
npm run version:set -- 1.10.0
npm run version:check
git diff --stat   # 首次升版应看到全部 12 个页面都变了；已是目标版本的页面不变属正常
```

- 升版后同步更新根 README 里的版本示例（标签命令、`version:set` 示例、版本规则表格），以及本文件顶部的“当前基线”和示例版本。
- 测试断言不要写死版本号；文档里的示例可以写当前版本，但要随发版一起更新，或者直接写成 `vX.Y.Z` 占位。

发版流程见第 9 节。

## 7. 测试范式

### 7.1 组织方式

- 每个子项目一个 spec：`tests/<subproject>.spec.js`；一个子项目有多个页面时，在同一个 spec 里用 `test.describe` 分组（参考 `21-dian.spec.js`）。
- 用例描述用中文，写“用户看到什么/做什么”，不要写“调用 xxx 函数”。
- 页面路径统一 `const PAGE = encodeURI('/子项目/页面.html')`，中文目录必须 `encodeURI`。
- 公共断言放 [tests/utils.js](tests/utils.js)：`expectResponsiveViewport`、`expectNoHorizontalScroll`。
- 仓库级约束放 [tests/structure.spec.js](tests/structure.spec.js)，新增子项目后它应该自动覆盖到。

### 7.2 首个用例的模板

每个 spec 的第一个用例至少做三件事：检查初始状态、检查移动端布局、确认没有未捕获异常。

```js
// @ts-check
const { test, expect } = require('@playwright/test');
const { expectNoHorizontalScroll, expectResponsiveViewport } = require('./utils');

const PAGE = encodeURI('/音频发生器/tone-generator.html');

test.describe('音频发生器', () => {
  test('初始状态：默认值正确，移动端不横向溢出', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(PAGE);

    await expect(page.locator('.ver')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.locator('#freqBig')).toHaveText('440.00');

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
```

### 7.3 让测试可复现

- 涉及定时器/日期：用 `page.clock.install()` / `pauseAt()` / `runFor()`，不要真的 `waitForTimeout(5000)`。
- `page.clock.setSystemTime()` 只改系统时间，**不会触发定时器**；要让定时器跑，必须再 `runFor()`。
- 涉及随机：用 `page.addInitScript` 固定 `Math.random` 的种子（参考 `21-dian.spec.js` 的 `freezeRandom`）。
- 动画/音频重建这类确实需要等一点的，用 `expect.poll` 或短 `waitForTimeout`，并注释原因；不要用长睡眠掩盖竞态。
- 假时钟要在 `page.goto()` 之前安装；安装后页面里的 `Date.now()`、`setTimeout` 都会走假时钟。

### 7.4 常见测试技巧

- **range 输入**：`fill()` 对 `input[type=range]` 不生效，改用：

  ```js
  await page.locator('#freqSlider').evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, 1000);
  ```

- **Web Audio**：桌面端用 `addInitScript` 包一层 `AudioContext.prototype.createOscillator` / `createBufferSource` 计数，验证“播放真的创建了音源、停止后复位”；移动端跳过这类引擎测试。
- **上传**：优先用 `setInputFiles({ name, mimeType, buffer })` 造小文件；需要真实容器时用 `tests/fixtures/` 里已提交的夹具。
- **下载**：先 `const dl = page.waitForEvent('download')`，再点按钮，最后 `await dl` 并读文件内容/文件名。
- **确认框**：页面用 `window.confirm` 时，先注册 `page.on('dialog', (d) => d.accept())` 再点击，否则测试会卡住。
- **多标签页**：用 `context.newPage()` 开第二个页面；两个页面的假时钟要各自推进，不能让一个页面无限等待另一个。
- **移动端/桌面端分流**：桌面能力用 `test.skip(isMobile, '只在桌面端跑')`；只测移动端用 `test.skip(!isMobile, '仅在移动端 project 运行')`。

### 7.5 运行与判读

- CI 固定跑三个 project：`desktop-chromium`、`mobile-chrome`、`mobile-safari`；移动端会跳过桌面专属用例，所以有大量 skipped 是正常的。
- v1.10.0 的基线是 **308 passed / 184 skipped / 0 failed**；数字会随用例增减变化，汇报时以本次 CI 为准。
- 失败时先看 `gh run view <id> --log-failed`；需要细节再下载 `playwright-report` artifact，看 trace / screenshot。
- 不要为了让测试变绿而放宽断言、加无理由的 `waitForTimeout` 或把真实 bug 标成 skip；如果只是环境差异，写清楚原因。
- 修 bug 时先加一条能复现的回归用例，再修；用例名写清症状（例如“另一个标签页接管后，原页面不再响铃”）。

## 8. README 范式

### 8.1 子项目 README

每个子项目必须有 `README.md`，一级标题，且提到本目录的页面文件名。工具类推荐章节：

```text
# 名称 · English Name
一句话定位 + 页面文件与体积 + “零依赖/离线”声明
## 功能
## 用法（含快捷键）
## 数据与状态（存哪、是否上传、刷新后怎样）
## 测试
## 已知限制（如实说明）
## 浏览器兼容（表格：浏览器 / 最低版本 / 卡在哪）
```

游戏类可以用 `玩法`、`实现细节`、`测试`、`已知限制`、`浏览器兼容`，不必硬套工具类章节。

写作要求：

- 数字要具体：频率范围、文件大小、支持格式、超时时间，不要写“很快”“较大”。
- 测试章节要指向 `tests/xxx.spec.js`，并列出覆盖点。
- “已知限制”写真实会发生的降级：后台限速、必须点一次、`file://` 没有通知、iOS 差异等。
- “浏览器兼容”写“最低版本 + 卡在哪”，不要只写“建议使用最新版”。
- 不要承诺做不到的事；不确定就写“未实测”。

### 8.2 根 README

根 README 是索引，改动时同步：

- 项目结构表格（每个子项目一行）
- 子项目/页面数量
- 测试覆盖列表
- 发版示例里的版本号
- 如果新增了目录或测试文件，补对应说明
- 每次发版同步 `CHANGELOG.md` 顶部的版本记录

## 9. CI/CD 与发版

### 9.1 流水线怎么跑

- `ci.yml`：push 到 `main`、PR、Release published、手动触发都会调用 `test.yml`。
- `test.yml`：固定 `mcr.microsoft.com/playwright:v1.64.1-noble` 容器，`npm ci` 后跑 `npx playwright test`，上传报告 artifact。
- `release.yml`：推 `v*` 标签后，先跑测试，再 `node scripts/versions.js check "$GITHUB_REF_NAME"` 校验版本，再用 `git archive HEAD -- '*.html'` 打 zip，最后 `gh release create`（已存在则只更新附件）。

### 9.2 一次完整发版

```bash
# 1. 改代码 + 测试 + README
# 2. 所有页面统一升版
npm run version:set -- 1.10.0
npm run version:check

# 3. 在 CHANGELOG.md 顶部补本次版本记录
#    格式：## [x.y.z] - YYYY-MM-DD，写新增/变更/修复/测试

# 4. 提交并推 main
git status --short
git add -A
git commit -m "Add <功能>; bump to v1.10.0"
git push origin main

# 5. 等 main 的 CI 绿（见第 2 节命令），再打标签
git tag v1.10.0
git push origin v1.10.0
```

- 从 v1.6.0 起，**每次发版都必须更新 CHANGELOG.md**：在顶部新增 `## [x.y.z] - YYYY-MM-DD`，列出新增、变更、修复和测试结果；只改代码不改日志视为未完成。
- 提交信息用英文祈使句，带子项目/动作；涉及版本时在末尾写 `bump to vX.Y.Z`。参考现有提交：

  ```text
  Add audio tone generator subproject; sync versions to v1.5.0
  Reminder: detect browser suspend/freeze and catch up on wake; bump to v1.4.0
  Fix duplicate ringing when another tab takes over the reminder ownership
  ```

- 标签一旦推送就不要移动/强推；发现版本或内容错了，先停下来问用户，不要静默改标签。
- Release 的 zip 只包含 `*.html`，**不含 README、测试、`bg.jpg`**；`21点游戏` 的自定义背景因此不在包里，这是已知行为，README 里已说明。
- 新文件必须先 `git add`；`git archive` 只打包已跟踪文件。

### 9.3 Release notes

`release.yml` 的 `--generate-notes` 只是兜底；实际发布时写中文说明，结构参考：

```markdown
## 新增 / 变更
- 一句话说清用户能得到什么

## 测试
CI：X passed / Y skipped，三种环境全绿。

## 版本
全仓库统一升级到 vX.Y.Z（新增页面 + 其余页面仅同步版本号）。

## 附件
`hellohtml-vX.Y.Z-html.zip`：N 个 HTML 页面，保留子目录结构。
```

Release 已创建时用：

```bash
gh release edit v1.10.0 --repo llllllllqq/hellohtml --notes-file notes.md
```

### 9.4 发布后验收

至少确认这四件事：

1. `gh release view vX.Y.Z --json assets`：附件名、大小正确，只有一个 zip。
2. zip 内 HTML 数量等于 `git ls-files '*.html' | wc -l`（release workflow 已校验，但人工再看一眼）。
3. `node scripts/versions.js check vX.Y.Z` 本地通过（CI 已跑过，用于核对）。
4. 确认它是最新 Release（`gh api repos/llllllllqq/hellohtml/releases/latest --jq .tag_name`），说明文字没有残留旧版本号。

## 10. 各子项目备忘

- **21点游戏（2 页）**：`21.html` 是伪装成测试的普通版，`21plus.html` 是全特效版。测试用固定随机种子保证发牌可复现；`bg.jpg` 不进发布包。默认只同步版本，不改视觉。
- **击鼓传花 / 文字颜色 / 生日老虎机**：纯游戏，测试覆盖初始状态和主流程，重点是小屏不溢出、按钮可点。不要为了“统一风格”改它们的配色和动效。
- **身份证拼接器**：Canvas 拼版 + JPG/PDF 下载；测试用 1×1 PNG 走完整上传/下载，校验文件名和 PDF 头。图片预览/下载的 object URL 要回收。
- **音视频剪切器（2 页）**：纯前端容器级无损剪切。测试不依赖 ffmpeg：夹具已提交，结构用独立解析器校验，内容用 WebAudio 解码后做相关性比对。大文件、长文件、损坏容器都要有错误分支。
- **提醒器**：IndexedDB 优先、localStorage 降级；假时钟测试规则推算、到点弹层、稍后再说、补提醒、多标签页接管；睡眠/冻结用 `freeze`/`resume` + `visibilitychange` + 定时器间隔兜底。涉及 `window.confirm`、音频手势、标签页所有权，改动后务必跑回归。
- **音频发生器**：全部由 Web Audio 实时合成，不加载音频文件；播放必须用户手势；切波形会重建音源，切噪声用 BufferSource；高频/超过 Nyquist 要有提示；示波器用 canvas，后台标签页会降频。
- **文本编辑器**：编码识别和保存依赖 `TextDecoder` / `TextEncoder`；保存是 Blob 下载，不是写回原文件；未保存修改用 `confirm`；`?selftest` 会跑编码往返、BOM 和换行自检。测试覆盖 UTF-8 BOM、GBK + CRLF 的下载字节、查找替换和偏好持久化。
- **文本对比器**：打开文件时按 BOM / 严格 UTF-8 校验 / 字符分布推断编码（UTF-8、UTF-16、GBK、Big5、Shift_JIS、Win-1252），每栏的编码下拉可手动重读原始字节；行级 diff，末尾换行和 CRLF/LF 差异不参与比较，三种换行混排都能正常分行；超大差异会退化为整段删除 + 新增。顶栏「Aa 行内对比」开关对成对修改的行做字符级高亮：先裁公共前后缀，中间用 Myers（上限受控），失败后改用线性空间的 Hirschberg 补齐；单行最多比较 400 万对字符、一次渲染 800 万对，超出就保留整行高亮，避免超长行卡死页面。测试覆盖增删统计、仅差异视图、间隙折叠、布局、编码切换、文件读取、行内开关与长行降级。

## 11. 踩坑清单

**工具与环境**

- `edit` 之前必须先用 `read` 看真实文件；文件在两次读取之间被改过时要重新读，不要凭记忆替换。
- 每次 bash 都是新 shell，`/tmp` 可能被清；临时文件放工作区，用完删掉，不要留在仓库里。
- `gh` 在部分环境需要 `XDG_CACHE_HOME=/tmp/ghcache`；`gh run watch` 偶发 `unexpected EOF`，改用 `gh run view` 轮询/查看。
- 不要并行跑会互相覆盖的格式化/生成命令；改完看 `git diff`，确认没有把无关文件带进去。

**测试**

- `page.clock.setSystemTime()` 不触发定时器；补 `runFor()`。
- `fill()` 不能设置 `input[type=range]`；用 `evaluate` 改 value + 派发 `input`。
- WebKit 对点击位置/可点击元素更挑剔；按钮别用伪元素盖住，必要时点可见的父元素或先滚动到视口。
- `window.confirm` 未注册 dialog handler 会让测试挂起。
- IndexedDB 写入是异步的；断言“刷新后还在”之前要等 UI 状态，不要立刻 reload。
- 中文路径直接 `page.goto('/子项目/页面.html')` 可能 404 或编码错误，统一 `encodeURI`。
- 假时钟会影响 `requestAnimationFrame`/动画；canvas 类断言用 `expect.poll`，不要假设一帧就画好。
- 移动端 project 会跳过桌面用例，skipped 多不等于失败；但新增桌面用例时要主动 `test.skip(isMobile, ...)`。

**页面/浏览器**

- 声音必须用户手势后才能播；`AudioContext` 可能以 `suspended` 启动，要 `resume()`。
- 后台标签页定时器会被限速到约 1 分钟；不要用“后台也能准点”做承诺。
- `file://` 下 `fetch`/XHR 本地文件、Notification、Service Worker 都不可用或受限，必须降级。
- iOS Safari 的 `100vh`、安全区、日期输入样式和桌面不同；用 `viewport-fit=cover` 时记得 padding。
- 页面 `color-scheme` 不匹配会导致输入框/滚动条反色，尤其是白底页面。
- 用了 flex `gap` / `aspect-ratio` / `accent-color` 就会抬高门槛；不确定时查第 5.4 节并写进兼容表。

**版本与发布**

- 版本号只改了一部分页面 → `version:check` 失败，Release 被拦。
- 测试里写死版本号 → 下次统一升版误报；用正则。
- 只改文档却打了标签 → 标签和页面版本对不上，Release 失败；文档改动不要打标签。
- 忘记 `git add` 新页面/新测试 → zip 里没有该页面，或 CI 跑的是旧文件。
- `bg.jpg` 不在 zip 里是预期行为，不要“修复”它。
- Release notes 不要留旧版本号；发完用 `gh release view` 复核。

## 12. 完成定义（Definition of Done）

一次页面改动至少满足：

- [ ] 页面双击 `file://` 能打开，控制台无未捕获异常
- [ ] 移动端 360–390px 无横向滚动，主要按钮可点
- [ ] 恰好一个 `class="ver"`，`<title>` 不含版本号
- [ ] 新功能/修复有对应用例，旧用例没有被无理由放宽
- [ ] 子项目 README 更新（功能、限制、兼容、测试）
- [ ] 根 README 的表格/数量/测试覆盖/版本示例同步
- [ ] CHANGELOG.md 顶部已记录本次版本（新增/变更/修复/测试）
- [ ] `npm run version:set -- X.Y.Z` 后 `npm run version:check` 通过，所有页面都变（当前 12 个；新增页面后以实际数量为准）
- [ ] 推 main 后 CI 全绿（0 failed）
- [ ] 需要发版时：标签 = 页面版本，Release 附件是 HTML-only zip，notes 为中文且版本正确
- [ ] 对用户的汇报是中文，包含改动摘要、测试数字、Release/CI 链接

## 13. 汇报模板

```markdown
已完成，版本 vX.Y.Z。

## 改了什么
- ...

## 验证
- CI：X passed / Y skipped / 0 failed（链接）
- 版本：N 个页面统一为 vX.Y.Z，与标签一致

## 发布
- Release（链接）
- 附件：hellohtml-vX.Y.Z-html.zip，N 个 HTML

## 说明
- 已知限制/未覆盖项（没有就省略）
```
