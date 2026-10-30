# hellohtml

[![CI](https://github.com/llllllllqq/hellohtml/actions/workflows/ci.yml/badge.svg)](https://github.com/llllllllqq/hellohtml/actions/workflows/ci.yml)

一个聚合各类创意 HTML 文件的项目。

这里的每个子项目都是独立、纯前端实现的页面，直接双击打开或用浏览器打开即可运行，无需构建、安装依赖或启动后端服务。适合随手把玩、分享，或者当作单文件 Web 小工具使用。

## 📁 项目结构

| 文件夹 | 内容 |
| --- | --- |
| [21点游戏](21点游戏/) | 21 点（Blackjack）小游戏 |
| [击鼓传花游戏](击鼓传花游戏/) | 击鼓传花小游戏 |
| [文字颜色游戏](文字颜色游戏/) | 文字颜色（Stroop 效应）挑战 |
| [生日老虎机游戏](生日老虎机游戏/) | 生日主题老虎机 |
| [身份证拼接器](身份证拼接器/) | 身份证正反面扫描件拼接工具 |
| [音视频剪切器](音视频剪切器/) | 纯前端无损音视频剪切工具（视频 MP4/MOV、音频 WAV/MP3/M4A/FLAC/OGG） |
| [提醒器](提醒器/) | 纯前端离线定时提醒（每天/每周/每月/一次性） |

每个子项目都有独立的 README：玩法、实现细节、测试覆盖与已知限制都写在里面。

## 🚀 使用

1. 进入对应的文件夹，双击其中的 `.html` 文件，或把它拖进浏览器
2. 所有页面均为纯前端实现，数据在本地处理，通常无需联网
3. 建议使用较新版本的 Chrome / Edge / Firefox / Safari

## ✅ 测试与发布（CI/CD）

项目使用 [Playwright](https://playwright.dev/) 在 GitHub Actions 云端验证页面逻辑，不需要在本地安装浏览器。

**CI**：推送 `main`、Pull Request、手动触发，以及手动发布 Release 时，都会在云端跑一遍测试。

**CD（发版）**：推送 `v*` 标签后自动执行：

1. 在云端运行 Playwright 测试（不通过就停在这里，不会发版）
2. 校验所有页面的版本号完全一致、且等于标签（见下），不一致直接失败
3. 只把全部 `.html` 成品打成 `hellohtml-<tag>-html.zip`（保留子目录结构，不含测试、README、`bg.jpg` 等）
4. 创建 GitHub Release，附上自动生成的 release notes 和这个 zip

```bash
git tag v1.2.1
git push origin v1.2.1
```

### 版本号规则

全仓库**共用一个版本号**：九个页面标题处标的版本号必须完全一样，发版标签就等于这个版本号。任何子项目有改动（哪怕只改了一个页面、一行代码），发版时**所有页面**都要一起升到同一个新版本——没改动的子项目也要跟着升，不能留在旧版本。

| 本次改动 | 页面上的版本 | 发布标签 |
| --- | --- | --- |
| 只修了「提醒器」 | 全部九个页面统一 `v1.2.1`（其余子项目也一起升） | `v1.2.1` |
| 只改文档、没动页面 | 全部不变 | 不打标签（版本号对不上会被拦下） |

不需要手改九个文件，一条命令统一升版：

```bash
npm run version:set -- 1.2.1   # 把所有页面的 class="ver" 统一改成 v1.2.1
npm run version:check          # 本地检查是否全部一致
```

发版流程：`npm run version:set -- <新版本>` → 提交推送 → 打对应的 `v*` 标签并推送。CI 会用 `scripts/versions.js` 再校验一遍，只要有一个页面版本号不一致或与标签不符就停在上一步，不会发版。下载包 `hellohtml-<tag>-html.zip` 解压后是各子文件夹下的页面，双击即可打开；`21点游戏/bg.jpg` 不在包里，需要自定义背景请自行放一张同名图片。

### 测试覆盖

- 测试覆盖全部七个子项目：`21点游戏`、`击鼓传花游戏`、`文字颜色游戏`、`生日老虎机游戏`、`身份证拼接器`、`音视频剪切器`、`提醒器`
- 每个页面都会在三种环境下各跑一遍：桌面 Chrome、Pixel 5（Android Chrome）、iPhone 13（iOS Safari）
- 移动端用例会额外检查 viewport 声明与横向滚动，确保小屏不出现横向溢出
- `21点游戏` 还覆盖了边界：爆牌、平局、黑杰克、庄家爆牌、余额不足、连续开新局
- `提醒器` 用 Playwright 假时钟把时间推到触发点：验证每天/每周/每月/一次性的规则推算与文字描述、到点弹层、「稍后再说」5 分钟后再次提醒、关掉页面后重开的补提醒、导出 `config.txt` 再导入、暂停/删除与多标签页接管
- `音视频剪切器` 覆盖 9 种音频“容器 × 编码”与 7 种 MP4 容器样本：用独立的容器解析器校验结构，用浏览器 WebAudio 解码后与源片段做相关性比对，并走一遍“上传 → 剪切 → 下载 → 可播放”的真实用户路径（测试夹具由 `tests/fixtures/cutter/generate.sh` 生成并随仓库提交，CI 不需要 ffmpeg）
- 仓库结构自检：每个子项目都有 README 且提到自己的页面、根 README 列全所有子项目、每个页面正文恰好一个版本号且 `<title>` 不带版本号、**九个页面版本号必须完全一致**，并直接跑一遍 `scripts/versions.js`
- 运行记录、Playwright 报告和发布记录见 [Actions](https://github.com/llllllllqq/hellohtml/actions) 与 [Releases](https://github.com/llllllllqq/hellohtml/releases)

需要在本地运行时：

```bash
npm ci
npx playwright install chromium webkit
npm test
```

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源，欢迎自由使用、修改和分发。
