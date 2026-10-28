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
2. 校验标签与子项目版本号（见下），不一致直接失败
3. 只把全部 `.html` 成品打成 `hellohtml-<tag>-html.zip`（保留子目录结构，不含测试、README、`bg.jpg` 等）
4. 创建 GitHub Release，附上自动生成的 release notes 和这个 zip

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 版本号规则

每个页面的标题处都标着自己的版本号（`v1.0.0`），**发布版本号 = 所有子项目版本号的最大值**；没改动的子项目保持原版本，不跟着升。

| 本次改动 | 页面上的版本 | 发布标签 |
| --- | --- | --- |
| 只把「提醒器」升到 v1.1.0 | 提醒器 v1.1.0，其余仍是 v1.0.0 | `v1.1.0` |
| 再把「21点游戏」升到 v1.2.0 | 21点游戏 v1.2.0，其余不变 | `v1.2.0` |
| 只改文档、没动页面 | 全部不变 | 不打标签（版本号对不上会被拦下） |

发版流程：把要改的页面标题处的版本号改成新版本 → 提交推送 → 打对应的 `v*` 标签。下载包 `hellohtml-<tag>-html.zip` 解压后是各子文件夹下的页面，双击即可打开；`21点游戏/bg.jpg` 不在包里，需要自定义背景请自行放一张同名图片。

### 测试覆盖

- 测试覆盖全部七个子项目：`21点游戏`、`击鼓传花游戏`、`文字颜色游戏`、`生日老虎机游戏`、`身份证拼接器`、`音视频剪切器`、`提醒器`
- 每个页面都会在三种环境下各跑一遍：桌面 Chrome、Pixel 5（Android Chrome）、iPhone 13（iOS Safari）
- 移动端用例会额外检查 viewport 声明与横向滚动，确保小屏不出现横向溢出
- `21点游戏` 还覆盖了边界：爆牌、平局、黑杰克、庄家爆牌、余额不足、连续开新局
- `提醒器` 用 Playwright 假时钟把时间推到触发点：验证每天/每周/每月/一次性的规则推算与文字描述、到点弹层、「稍后再说」5 分钟后再次提醒、关掉页面后重开的补提醒、导出 `config.txt` 再导入、暂停/删除与多标签页接管
- `音视频剪切器` 覆盖 9 种音频“容器 × 编码”与 7 种 MP4 容器样本：用独立的容器解析器校验结构，用浏览器 WebAudio 解码后与源片段做相关性比对，并走一遍“上传 → 剪切 → 下载 → 可播放”的真实用户路径（测试夹具由 `tests/fixtures/cutter/generate.sh` 生成并随仓库提交，CI 不需要 ffmpeg）
- 运行记录、Playwright 报告和发布记录见 [Actions](https://github.com/llllllllqq/hellohtml/actions) 与 [Releases](https://github.com/llllllllqq/hellohtml/releases)

需要在本地运行时：

```bash
npm ci
npx playwright install chromium webkit
npm test
```

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源，欢迎自由使用、修改和分发。
