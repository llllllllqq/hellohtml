# 音频剪切器

`audio-stream-cutter.html` 是一个自包含的音频无损剪切器：支持 WAV / MP3 / M4A / FLAC / OGG，
零依赖、完全离线。本目录包含完整源码、构建脚本与全部测试。

## 一、环境要求

| 组件 | 版本（开发时所用） | 用途 |
|---|---|---|
| 操作系统 | Ubuntu 22.04（任意 Linux/macOS/Windows 均可） | — |
| Python | 3.11+（仅标准库：os/subprocess/json/struct/time） | 构建 + 测试 |
| Node.js | 22.13 | 运行 src/*.js 解析器做单测 |
| ffmpeg / ffprobe | 任意较新版本（需含 aac、flac、vorbis、opus、libmp3lame 编码器；H.264 需 libx264 或 libopenh264） | 生成测试文件 + 验证输出 |
| Playwright（Python 包） | 1.58 | e2e 浏览器测试 |
| Chromium | stable（`playwright install chromium`） | e2e 浏览器 |

安装（任选其一）：

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y python3 python3-pip nodejs ffmpeg
pip3 install playwright && python3 -m playwright install chromium

# 或 conda
conda create -n cutter python=3.11 nodejs=22 -c conda-forge ffmpeg -y
pip install playwright && python -m playwright install chromium
```

> 说明：本项目零第三方运行时依赖——交付的 HTML 不引用任何 CDN/库，
> 构建和测试脚本也只用 Python 标准库 + ffmpeg + Playwright。

## 二、目录结构

```
audio-cutter/
├── template.html          # UI 模板（含 /*__APP__*/ 占位符）
├── build.py               # 构建：把 src/*.js 按序内联进模板 → 单文件 HTML
├── src/
│   ├── common.js          # 字节工具 / 波形密度 / 吸附
│   ├── wav.js             # WAV/RIFF 解析与切割
│   ├── mp3.js             # MP3 帧解析、Xing 重写、帧级切割
│   ├── m4a.js             # M4A/ISO-BMFF box 引擎（AAC/ALAC/Opus）
│   ├── flac.js            # FLAC metadata + 帧扫描
│   ├── ogg.js             # OggS 页、CRC-32/MPEG-2、逻辑包重组（Vorbis/Opus）
│   ├── detect.js          # 魔术字格式探测
│   └── app.js             # UI 逻辑（时间线、输入解析、剪切调度）
├── test/                  # 测试夹具（17 个音视频文件，见下）
├── test_cut.py            # ① 9 格式解析+切割 → ffmpeg 解码/时长验证
├── verify_content.py      # ② PCM 内容相关性验证（皮尔逊相关 + 能量比）
├── supplement_test.py     # ③ 多样化文件 / 边界参数 / 损坏文件 / 性能
├── e2e.py                 # ④ Playwright 全流程 UI 测试（9 文件选→填→切→下载）
├── test_wav_roundtrip.py  # ⑤ WAV 往返测试：切割→下载→重导入 + chunk 结构校验
└── e2e_timeinput.py       # ⑥ 时间输入解析回归
```

## 三、构建

```bash
cd audio-cutter
python3 build.py        # 产出 audio-stream-cutter.html（约 90 KB）
```

改任何 `src/*.js` 或 `template.html` 后重新执行即可；无其他依赖。

## 四、测试夹具生成（test/ 目录）

夹具已随包提供；如需重新生成，命令如下（30 秒立体声 44.1kHz 测试音频为基底）：

```bash
cd test
# 基底 WAV（sine + 扫频混合，30s）
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=30" \
       -f lavfi -i "sine=frequency=1470:duration=30" \
       -filter_complex "[0:a][1:a]amix=inputs=2,volume=0.5" \
       -ar 44100 -ac 2 -c:a pcm_s16le test.wav

ffmpeg -y -i test.wav -c:a libmp3lame -b:a 128k test.mp3                          # MP3 CBR
ffmpeg -y -i test.wav -c:a libmp3lame -q:a 4 test_vbr.mp3                        # MP3 VBR
ffmpeg -y -i test.wav -c:a aac -b:a 128k test.m4a                                 # M4A/AAC
ffmpeg -y -i test.wav -c:a alac test_alac.m4a                                     # M4A/ALAC 无损
ffmpeg -y -i test.wav -c:a libopus -b:a 96k -f mp4 test_opus.m4a                  # M4A/Opus
ffmpeg -y -i test.wav -c:a flac test.flac                                         # FLAC
ffmpeg -y -i test.wav -c:a libvorbis -q:a 3 test.ogg                              # OGG/Vorbis
ffmpeg -y -i test.wav -ar 48000 -c:a libopus -b:a 96k test_opus.ogg               # OGG/Opus 48k
```

补充夹具：

```bash
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=20" -ar 48000 -ac 1 -c:a libmp3lame -b:a 48k -write_xing 0 mono.mp3   # 单声道 48k 无 ID3
ffmpeg -y -i test.wav -c:a libmp3lame -b:a 128k -metadata title="$(python3 -c 'print("x"*5000)')" bigmeta.mp3             # 大 ID3v2
ffmpeg -y -i test.wav -c:a pcm_f32le -ar 44100 wav_float32.wav                      # float32 WAV
ffmpeg -y -i test.wav -c:a pcm_u8 -ar 22050 wav_8bit.wav                             # 8bit WAV
ffmpeg -y -i test.wav -c:a pcm_s24le wav_24bit.wav                                   # 24bit WAV
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=180" -c:a flac long.flac         # 180s 性能测试
ffmpeg -y -i test.wav -c:a libvorbis -q:a 3 -metadata comment="$(python3 -c 'print("y"*5000)')" ogg_bigcomment.ogg  # 跨页大注释
# 损坏文件：把正常文件截断到 1/3 长度
for f in test.mp3 test.flac test.ogg test.m4a; do head -c $(( $(stat -c%s $f) / 3 )) $f > trunc.${f#test.}; done
# 伪造文件：假扩展名 + 垃圾内容
echo "not a real mp3 at all, just text" > fake.mp3
echo "not a real wav" > fake.wav
```

## 五、运行测试

```bash
cd audio-cutter

python3 test_cut.py          # ① 解析+切割+ffmpeg 解码/时长（9 用例）
python3 verify_content.py    # ② PCM 内容相关性（9 用例，需先跑过 ①）
python3 supplement_test.py   # ③ 边界/损坏/性能（约 24 项）
python3 e2e.py               # ④ Playwright UI 全流程（9 文件，零页面错误）
python3 test_wav_roundtrip.py    # ⑤ WAV 往返：奇数 chunk/fact/异常 fmt 等 6 例，结构校验+重导入
python3 e2e_timeinput.py         # ⑥ 时间输入解析回归
```

全部通过时的输出标志：`ALL OK` / `CONTENT ALL OK` / `SUPPLEMENT ALL OK` / 汇总 9/9。

预期耗时：①③ 各约 10–20s，② 约 1–2 分钟（PCM 解码+相关计算），④ 约 1–2 分钟（浏览器驱动）。

## 六、测试体系设计（为什么这样测）

| 层 | 手段 | 保证什么 |
|---|---|---|
| 结构层 | test_cut.py：node 跑解析器 → 切割 → ffprobe 时长 + ffmpeg 全量解码 | 输出容器/索引合法，播放器能解析 |
| 内容层 | verify_content.py：源与输出各抽 PCM（8kHz 单声道），±300ms 偏移搜索后算皮尔逊相关 + 能量比 | 切的是正确片段、无丢音错音（有损格式起点偏移由搜索吸收） |
| UI 层 | e2e.py：Playwright 真实文件上传、填时间、点剪切、捕获下载文件 | 用户路径端到端可用，无 JS 报错 |
| 边界层 | supplement_test.py：全选/极短/贴终点/超时长/损坏/伪造/大文件 | 异常输入不崩、行为符合文档 |

## 七、已知边界（如实说明）

- MP3 切割吸附到帧边界（约 26ms/帧），极短切割至少保留 3 帧（Xing 信息帧 + 2 个真实音频帧，ffmpeg 探测下限）
- OGG 吸附到页边界（约 1s/页），切割保留整页，面板回显实际区间
- 切割不重编码，起始点对齐关键帧（视频版）/ 最小单元（音频版），面板均有提示
- WAV 切割会保留全部非 data chunk（LIST/id3/fact 等）并**补齐 RIFF 2 字节对齐的 pad**；
  fact 整块保留仅改写样本数；blockAlign/byteRate 为 0 的异常文件按格式参数推导。
  历史版本曾因丢 pad/截断 fact 导致输出无法再次解析，`test_wav_roundtrip.py` 专门守护此路径
- 视频版是独立工程，见仓库 `../video-cutter/`
