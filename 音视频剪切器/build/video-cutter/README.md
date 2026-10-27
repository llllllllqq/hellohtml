# 视频剪切器（单文件）

`video-stream-cutter.html` 是一个自包含的 MP4/MOV 无损剪切器：零依赖、离线、双击即用。

## 用法

1. 双击打开 HTML（Chrome / Edge / Firefox / Safari 新版）
2. 拖入 MP4/MOV
3. 在时间线上拖选区间，或用输入框填写（`69` / `01:09` / `00:01:09`）
4. 点击"开始剪切"，浏览器直接生成结果并下载

## 实现要点

- **容器层切割**：解析 `moov/trak/mdia/minf/stbl` 索引，重建 `stts / stsc / stsz / stco(或 co64) / stss / ctts`，`mdat` 中的样本字节原样搬运，因此无画质损失。
- **关键帧对齐**：起点吸附到 `i` 帧（sync sample），选区终点按呈现时间（PTS）取值，B 帧重排不会导致尾部丢时长。
- **编辑列表**：不粗暴删除 `edts`——有 `ctts` 的轨道按最小重排偏移重写 `elst`，音轨仅在从头切时保留 AAC 编码器前导；否则删除。这样 HEVC 等含 B 帧的文件输出的起点时间才是 0。
- **多音轨**：全部轨道各自重建索引并保留。
- **兼容布局**：音视频按 DTS 交错切块（每 chunk 多帧）、用 `free` 填充使 `mdat` 数据区 8 字节对齐——与 ffmpeg 的封装布局一致，避免老式严格解析器（如 Win7 的 WMP 12）拒绝。
- **分片 MP4（fMP4）**：按 `moof + mdat` 组保留，重写 `tfdt`（时间重基）、`tfhd.base_data_offset`、`trun.data_offset`、`mfhd.sequence_number`。

## 测试

```bash
cd tests
bash make_fixtures.sh    # 生成 8 个夹具（需要 ffmpeg，含 libopenh264 或 libx264）
python3 blackbox_test.py # 7 种文件端到端：上传→切割→下载→ffmpeg 校验
python3 e2e_timeinput.py # 时间输入解析回归（12 项）
```

`blackbox_test.py` 覆盖：默认布局、faststart、短 GOP、HEVC（B 帧）、无音轨、双音轨、fMP4。
判定：ffmpeg 全量解码零错误、视频起点 0、轨道数正确、时长在选区 + GOP 范围内。

内容正确性可进一步用帧哈希核对：

```bash
ffmpeg -v error -i in.mp4  -map 0:v -c copy -f framemd5 - | grep -v '^#' > src.md5
ffmpeg -v error -i out.mp4 -map 0:v -c copy -f framemd5 - | grep -v '^#' > out.md5
# 输出的哈希序列应当是源序列中一段连续子串
```

## 已知限制

- 起点必须落在关键帧上（否则无法独立解码），面板会显示实际区间
- 不处理加密（DRM）文件
- 单文件体积受浏览器内存限制（通常 < 2GB 较稳）
