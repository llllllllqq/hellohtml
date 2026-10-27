#!/usr/bin/env bash
# 生成视频版测试夹具（60s 或 180s，合成画面 + 正弦音）
# 用法：bash make_fixtures.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixtures
cd fixtures

V="-f lavfi -i testsrc=duration=60:size=320x240:rate=24"
A="-f lavfi -i sine=frequency=440:duration=60"

# 1) 默认布局（moov 在文件尾），GOP 2s
ffmpeg -v error -y $V $A -c:v libopenh264 -pix_fmt yuv420p -g 48 -c:a aac -shortest v1_default.mp4
# 2) faststart（moov 前置）
ffmpeg -v error -y -i v1_default.mp4 -c copy -movflags +faststart v2_faststart.mp4
# 3) HEVC（B 帧多、GOP 2.67s，用于 elst/ctts 回归）
ffmpeg -v error -y $V $A -c:v libkvazaar -pix_fmt yuv420p -g 48 -c:a aac -shortest v3_hevc.mp4
# 4) 短 GOP（1s）
ffmpeg -v error -y $V $A -c:v libopenh264 -pix_fmt yuv420p -g 24 -c:a aac -shortest v4_shortgop.mp4
# 5) 纯视频（无音轨）
ffmpeg -v error -y $V -c:v libopenh264 -pix_fmt yuv420p -g 48 v5_noaudio.mp4
# 6) 双音轨
ffmpeg -v error -y $V -f lavfi -i sine=frequency=440:duration=60 -f lavfi -i sine=frequency=880:duration=60 \
  -map 0:v -map 1:a -map 2:a -c:v libopenh264 -pix_fmt yuv420p -g 48 -c:a aac -shortest v6_twoaudio.mp4
# 7) 分片式 fMP4
ffmpeg -v error -y $V $A -c:v libopenh264 -pix_fmt yuv420p -g 48 -c:a aac -movflags +frag_keyframe+empty_moov v7_frag.mp4
# 8) 180s（时间输入回归用）
ffmpeg -v error -y -f lavfi -i testsrc=duration=180:size=320x240:rate=24 -f lavfi -i sine=frequency=440:duration=180 \
  -c:v libopenh264 -pix_fmt yuv420p -g 48 -c:a aac -shortest long_180s.mp4

echo "fixtures ready in $(pwd)"
ls -1
