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
| [音视频剪切器](音视频剪切器/) | 纯前端音视频剪切工具（源码与测试见 `build/`） |

每个文件夹的详细说明，请见该文件夹内的 README（会陆续补充）。

## 🚀 使用

1. 进入对应的文件夹，双击其中的 `.html` 文件，或把它拖进浏览器
2. 所有页面均为纯前端实现，数据在本地处理，通常无需联网
3. 建议使用较新版本的 Chrome / Edge / Firefox / Safari

## ✅ 测试（CI）

项目使用 [Playwright](https://playwright.dev/) 在 GitHub Actions 云端验证页面逻辑，不需要在本地安装浏览器：

- 推送 `main`、Pull Request、推送 `v*` 标签、手动触发，以及**发布 Release** 时都会自动跑一遍
- 目前测试覆盖 `21点游戏` 下的两个页面，之后每个文件夹可以继续补充
- 运行记录和 Playwright 报告见 [Actions](https://github.com/llllllllqq/hellohtml/actions)

需要在本地运行时：

```bash
npm ci
npx playwright install chromium
npm test
```

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源，欢迎自由使用、修改和分发。
