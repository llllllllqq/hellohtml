# 音视频剪切器 · Stream Copy Cutter

两个**零依赖、纯前端、完全离线**的单文件剪裁工具，直接在容器层面搬运原始码流：不重新编码，画质/音质与源文件逐字节相同。

| 单文件 | 说明 |
| --- | --- |
| [video-stream-cutter.html](video-stream-cutter.html) | MP4 / MOV 关键帧对齐切割（约 57 KB） |
| [audio-stream-cutter.html](audio-stream-cutter.html) | WAV / MP3 / M4A / FLAC / OGG 五种容器切割（约 90 KB） |

双击打开即可使用：不上传、不联网、无任何 CDN 或第三方库。

## 功能

**视频版**
- MP4 / MOV / M4V 输入，H.264、HEVC、AV1 等任意编码（只做容器重组，与编码无关）
- 起点自动吸附到最近的关键帧，并如实回显“实际切割区间”
- 保留全部音轨（含多音轨），重写编辑列表（elst）以适配 B 帧重排
- 支持分片式 MP4（fMP4）：重写 `tfhd` 基址 / `trun` 偏移 / `mfhd` 序号
- 时间线波形由视频帧差异生成，可拖拽选区、逐帧微调、循环预览

**音频版**
- 五种容器、七种编码：WAV(PCM/float)、MP3(CBR/VBR)、M4A(AAC/ALAC/Opus)、FLAC、OGG(Vorbis/Opus)
- 自动吸附到格式的最小可切单元（MP3 帧 / FLAC 帧 / OGG 页 / PCM 采样点）
- 完整保留元数据：ID3v2/ID3v1、Vorbis comment、FLAC 元数据块、MP4 音频参数
- 处理真实世界的“脏文件”：RF64、流式长度 0xFFFFFFFF、data 后置 chunk、奇数长度 chunk 的 pad、ID3 前缀的 FLAC、多音轨 M4A（自动只保留音轨）

## 支持矩阵

| 容器 | 编码 | 切割粒度 | 备注 |
| --- | --- | --- | --- |
| WAV / RF64 | PCM 8/16/24/32bit、float32/64 | 采样点（块对齐） | 输出统一为 RIFF；保留 LIST/fact 等块 |
| MP3 | MPEG-1/2/2.5 Layer III | 帧（26/48ms） | 重写 Xing/Info 帧计数；VBRI 标签抹除 |
| M4A / MP4(音频) | AAC、ALAC、Opus | 采样点（stts 重建） | 仅保留第一条音轨；fMP4 音频暂不支持 |
| FLAC | 16/24bit，任意采样率 | 帧（约 93ms@44.1k） | 重写 STREAMINFO 采样数、MD5 置零 |
| OGG | Vorbis、Opus | 页（约 1s Vorbis / 20ms Opus） | 重算 CRC32/MPEG-2、页序号、granule |
| MP4 / MOV(视频) | H.264 / HEVC / AV1 … | 关键帧 | 支持 fMP4；多音轨全保留 |

## 用法

1. 双击打开对应的 HTML
2. 拖入文件 → 在时间线上拖选区间，或直接填时间：`69`（秒）、`01:09`（分:秒）、`00:01:09`（时:分:秒）
3. 点“开始剪切”，浏览器直接生成结果并下载

快捷键：空格播放/暂停 · `I` 设起点 · `O` 设终点 · `P` 预览片段 · `←/→` 单帧步进（视频版）。

## 测试

测试统一在仓库根目录的 Playwright 套件里（`tests/audio-cutter.spec.js`、`tests/video-cutter.spec.js`），随 CI 在三种环境（桌面 Chrome / Pixel 5 / iPhone 13）运行：

- **音频**：9 种“容器 × 编码”组合，外加单体/大元数据/跨页注释/8bit·24bit·float32 WAV 等真实脏文件
  - 结构层：独立的 WAV/MP3/FLAC/OGG 解析器校验 RIFF 闭合、帧/页完整、CRC、时长
  - 内容层：用浏览器 WebAudio 解码输出，与源文件对应区间做皮尔逊相关（含 ±300ms 帧/页对齐搜索）
  - UI 层：真实上传 → 填时间 → 剪切 → 下载 → 页面自检“可播放”
  - 边界：全选、极短 50ms、贴终点、超时长 clamp、截断/伪造文件报错、WAV 畸形 chunk 往返
- **视频**：7 种容器样本（默认布局 / faststart / HEVC+B 帧 / 短 GOP / 无音轨 / 双音轨 / fMP4）
  - 结构层：独立解析 `moov/trak/stbl`、`stss`、`stsc/stco` 越界检查、fMP4 的 `moof` 保留
  - 播放层：浏览器 `<video>` 自检（HEVC 在 Chromium 无解码器，只校验容器结构）
- 测试夹具在 `tests/fixtures/cutter/`（由 `tests/fixtures/cutter/generate.sh` 用 ffmpeg 生成，已随仓库提交，CI 不需要 ffmpeg）

## 已知限制（如实说明）

- **不重编码**：视频必须从关键帧开始，实际起点可能早于所选时间（面板会显示实际区间）；音频吸附到帧/页粒度
- MP3 帧边界切割在起点可能带入 1–2 帧比特库残留（有损格式固有，`ffmpeg -c copy` 同样存在）
- OGG/Vorbis 以页为单位（约 1s），极短选区会被扩展到整页
- FLAC 切割后 STREAMINFO 的 MD5 置零（标准允许，播放器自动忽略）
- 分片式 M4A（fMP4 音频）不支持；纯视频文件拖入音频版会明确提示
- 单线程浏览器内存模型：处理超大文件（>2GB）受浏览器 ArrayBuffer 上限约束

## 浏览器兼容

两个页面用到的特性不同，版本要求也不一样：

| 页面 | Chrome / Edge | Firefox | Safari | iOS Safari |
| --- | --- | --- | --- | --- |
| 音频版 | 76 | 69 | 14 | 14.5 |
| 视频版 | 76 | 69 | 14 | 14.5 |

- 两个页面都用 `file.arrayBuffer()` 一次性读入文件，这是共同门槛（Chrome 76 / Firefox 69 / Safari 14）
- 布局不再依赖 flex `gap`（Chrome 84 / Safari 14.1），改用子元素外边距；复选框也不再用 `accent-color`
- 视频预览区用 `padding-top: 56.25%` 锁住 16:9，不再需要 `aspect-ratio`（Chrome 88 / Firefox 89 / Safari 15）
- 音频版里唯一一处可选链已改成普通 `&&` 判断，不再要求 Firefox 74

Firefox 未纳入 CI 测试矩阵，版本按特性支持情况推算；低于表中版本时页面可能仍能打开，但会出现排版错位或个别功能不可用。不支持 IE。
