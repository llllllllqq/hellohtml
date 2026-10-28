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

每个文件夹的详细说明，请见该文件夹内的 README（会陆续补充）。

## 🚀 使用

1. 进入对应的文件夹，双击其中的 `.html` 文件，或把它拖进浏览器
2. 所有页面均为纯前端实现，数据在本地处理，通常无需联网
3. 建议使用较新版本的 Chrome / Edge / Firefox / Safari

## ✅ 测试与发布（CI/CD）

项目使用 [Playwright](https://playwright.dev/) 在 GitHub Actions 云端验证页面逻辑，不需要在本地安装浏览器。

**CI**：推送 `main`、Pull Request、手动触发，以及手动发布 Release 时，都会在云端跑一遍测试。

**CD（发版）**：推送 `v*` 标签后自动执行：

1. 在云端运行 Playwright 测试（不通过就停在这里，不会发版）
2. 把源码打包成 `hellohtml-<tag>.zip`
3. 创建 GitHub Release，附上自动生成的 release notes 和 zip 包

```bash
git tag v0.1.0
git push origin v0.1.0
```

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
