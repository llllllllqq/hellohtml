#!/usr/bin/env bash
# 生成 音视频剪切器 的测试夹具（需要 ffmpeg）。
# 夹具已随仓库提交，一般无需运行；仅在需要重建时执行：bash tests/fixtures/cutter/generate.sh
set -euo pipefail
cd "$(dirname "$0")"
AUDIO=audio
VIDEO=video
mkdir -p "$AUDIO" "$VIDEO"

# ---------- 音频 ----------
# 8s 立体声基底：三个驻波音 + 各自的慢速幅度调制 + 低幅粉噪。
# 设计要点：
#   - 驻波（不扫频）保证“整体时移”不改变频谱，解码器延迟导致的几十毫秒偏移不会破坏相关性；
#   - 三路独立的慢速 AM（0.37/0.83/1.61Hz）让不同时间位置的能量/频谱分布不同，
#     切错片段时相关会明显下降；25ms 级时移对 AM 包络几乎无影响。
ffmpeg -v error -y \
  -f lavfi -i "sine=frequency=330:duration=8" \
  -f lavfi -i "sine=frequency=770:duration=8" \
  -f lavfi -i "sine=frequency=1330:duration=8" \
  -f lavfi -i "anoisesrc=color=pink:amplitude=0.02:duration=8:sample_rate=44100" \
  -filter_complex "[0:a]volume='0.28*(0.62+0.38*sin(2*PI*0.37*t))':eval=frame[a0];[1:a]volume='0.28*(0.62+0.38*sin(2*PI*0.83*t+1.1))':eval=frame[a1];[2:a]volume='0.28*(0.62+0.38*sin(2*PI*1.61*t+2.3))':eval=frame[a2];[a0][a1][a2][3:a]amix=inputs=4:normalize=0[out]" \
  -map "[out]" -ar 44100 -ac 2 -c:a pcm_s16le "$AUDIO/test.wav"

ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a libmp3lame -b:a 128k "$AUDIO/test.mp3"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a libmp3lame -q:a 4 "$AUDIO/test_vbr.mp3"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a aac -b:a 128k "$AUDIO/test.m4a"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a alac "$AUDIO/test_alac.m4a"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a libopus -b:a 96k -f mp4 "$AUDIO/test_opus.m4a"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a flac "$AUDIO/test.flac"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a libvorbis -q:a 3 "$AUDIO/test.ogg"
ffmpeg -v error -y -i "$AUDIO/test.wav" -ar 48000 -c:a libopus -b:a 96k "$AUDIO/test_opus.ogg"

# 单声道 48k、无 Xing 头帧
ffmpeg -v error -y -i "$AUDIO/test.wav" -ar 48000 -ac 1 -c:a libmp3lame -b:a 48k -write_xing 0 "$AUDIO/mono.mp3"
# 大 ID3v2
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a libmp3lame -b:a 128k \
  -metadata title="$(head -c 5000 /dev/zero | tr '\0' 'x')" "$AUDIO/bigmeta.mp3"
# 跨页大 Vorbis 注释
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a libvorbis -q:a 3 \
  -metadata comment="$(head -c 5000 /dev/zero | tr '\0' 'y')" "$AUDIO/ogg_bigcomment.ogg"
# WAV 位深 / 采样率变体（单声道 22.05k）
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a pcm_f32le -ar 22050 -ac 1 "$AUDIO/wav_float32.wav"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a pcm_u8 -ar 22050 -ac 1 "$AUDIO/wav_8bit.wav"
ffmpeg -v error -y -i "$AUDIO/test.wav" -c:a pcm_s24le -ar 22050 -ac 1 "$AUDIO/wav_24bit.wav"
# 75s 长文件（时间输入回归：需 > 135s 才不会被 clamp）
ffmpeg -v error -y -f lavfi -i "sine=frequency=330:duration=150" -ar 44100 -ac 1 -c:a flac "$AUDIO/long.flac"

# 损坏（截断到 1/3）与伪造文件
for f in test.mp3 test.flac test.ogg test.m4a; do
  head -c $(( $(stat -c%s "$AUDIO/$f") / 3 )) "$AUDIO/$f" > "$AUDIO/trunc.${f#test.}"
done
printf 'not a real mp3 at all, just text\n' > "$AUDIO/fake.mp3"
printf 'not a real wav\n' > "$AUDIO/fake.wav"

# ---------- 视频 ----------
V="-f lavfi -i testsrc=duration=8:size=160x120:rate=10"
A="-f lavfi -i sine=frequency=440:duration=8"
H264="-c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p"

ffmpeg -v error -y $V $A $H264 -g 20 -c:a aac -shortest "$VIDEO/v1_default.mp4"
ffmpeg -v error -y -i "$VIDEO/v1_default.mp4" -c copy -movflags +faststart "$VIDEO/v2_faststart.mp4"
ffmpeg -v error -y $V $A -c:v libx265 -preset veryfast -crf 32 -x265-params log-level=error \
  -pix_fmt yuv420p -tag:v hvc1 -g 20 -c:a aac -shortest "$VIDEO/v3_hevc.mp4"
ffmpeg -v error -y $V $A $H264 -g 10 -c:a aac -shortest "$VIDEO/v4_shortgop.mp4"
ffmpeg -v error -y $V $H264 -g 20 "$VIDEO/v5_noaudio.mp4"
ffmpeg -v error -y $V -f lavfi -i "sine=frequency=440:duration=8" -f lavfi -i "sine=frequency=880:duration=8" \
  -map 0:v -map 1:a -map 2:a $H264 -g 20 -c:a aac -shortest "$VIDEO/v6_twoaudio.mp4"
ffmpeg -v error -y $V $A $H264 -g 20 -c:a aac -movflags +frag_keyframe+empty_moov "$VIDEO/v7_frag.mp4"
# 伪造 MP4（纯文本，用于“拒绝非法输入”用例）
printf 'this is definitely not an mp4 file\n' > "$VIDEO/fake.mp4"

# 150s 长文件（时间输入回归；24fps 决定 clamp 粒度为 1/24s）
ffmpeg -v error -y -f lavfi -i "testsrc=duration=150:size=96x64:rate=24" \
  -c:v libx264 -preset veryfast -crf 40 -pix_fmt yuv420p -g 48 "$VIDEO/long_150s.mp4"

du -sh "$AUDIO" "$VIDEO"
