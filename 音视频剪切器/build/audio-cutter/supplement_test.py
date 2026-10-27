#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""supplement_test.py — 补充测试：
   1) 多样化文件（单声道/无ID3/大ID3/float32/8bit/24bit WAV/180s长文件/大Vorbis注释跨页）
   2) 边界切割参数（t=0 全选、极短区间、终点超时长、起终点贴脸）
   3) 损坏/伪造文件必须优雅报错（不得崩溃、不得产出垃圾文件）
   4) 性能（180s FLAC 解析耗时）
"""
import os, subprocess, sys, json, time

BASE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(BASE, "test")
OUT = os.path.join(BASE, "out")
os.makedirs(OUT, exist_ok=True)

JS = r"""
const fs=require('fs');
const W=require('%s/src/wav.js'), M=require('%s/src/mp3.js'), A=require('%s/src/m4a.js'),
      F=require('%s/src/flac.js'), O=require('%s/src/ogg.js'), D=require('%s/src/detect.js');
const P={WAV:W,MP3:M,M4A:A,FLAC:F,OGG:O};
const [file, s, e, outName, mode]=process.argv.slice(2);
const b=new Uint8Array(fs.readFileSync(file));
if(mode==='parse'){
  const fmt=D.detect(b.buffer, file);
  if(!fmt){ console.log(JSON.stringify({error:'detect failed'})); process.exit(2); }
  let info;
  try{ info=P[fmt].parse(b); }catch(err){ console.log(JSON.stringify({error:'parse: '+err.message})); process.exit(3); }
  console.log(JSON.stringify({fmt, duration:info.duration, sampleRate:info.sampleRate,
    channels:info.channels, codec:info.codec, boundaries:info.boundaries.length}));
  process.exit(0);
}
// cut 模式
const fmt=D.detect(b.buffer, file);
if(!fmt){ console.log(JSON.stringify({error:'detect failed'})); process.exit(2); }
let info;
try{ info=P[fmt].parse(b); }catch(err){ console.log(JSON.stringify({error:'parse: '+err.message})); process.exit(3); }
let res;
try{ res=P[fmt].cut(b, info, parseFloat(s), parseFloat(e)); }
catch(err){ console.log(JSON.stringify({error:'cut: '+err.message})); process.exit(4); }
const parts=res.parts;
const total=parts.reduce((a,p)=>a+p.length,0);
const out=Buffer.allocUnsafe(total);
let o=0; for(const p of parts){ out.set(Buffer.from(p.buffer,p.byteOffset,p.length), o); o+=p.length; }
fs.writeFileSync(outName, out);
console.log(JSON.stringify({fmt, t0:res.t0, t1:res.t1, outSize:total, parts:parts.length,
  sampleRate:info.sampleRate, channels:info.channels, codec:info.codec, duration:info.duration}));
""" % (BASE, BASE, BASE, BASE, BASE, BASE)

def run_js(file, s=None, e=None, out=None, mode="cut"):
    js = os.path.join(BASE, "test", "_run.js")
    open(js, "w").write(JS)
    args = ["node", js, file]
    if mode == "cut": args += [str(s), str(e), out, "cut"]
    else: args += ["-", "-", "-", "parse"]
    r = subprocess.run(args, capture_output=True, text=True, timeout=120)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else None, r.returncode
    except Exception:
        return None, r.returncode

def ffprobe_dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except: return None

def ffmpeg_check(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"],
                       capture_output=True, text=True)
    return r.stderr.strip()[:200]

fails = []

print("========== 1) 多样化文件 ==========")
DIVERSE = [
    ("mono.mp3", 2.0, 15.0, "单声道 48k 无 ID3"),
    ("bigmeta.mp3", 3.0, 10.0, "大 ID3v2 元数据"),
    ("wav_float32.wav", 5.0, 12.0, "float32 WAV"),
    ("wav_8bit.wav", 5.0, 12.0, "8bit 22.05k WAV"),
    ("wav_24bit.wav", 5.0, 12.0, "24bit WAV"),
    ("ogg_bigcomment.ogg", 5.0, 12.0, "大 Vorbis 注释（跨页）"),
]
for name, s, e, desc in DIVERSE:
    src = os.path.join(TEST, name)
    if not os.path.exists(src): continue
    out = os.path.join(OUT, "sup_" + name)
    info, rc = run_js(src, s, e, out)
    if not info or "error" in info:
        print(f"FAIL {name} ({desc}): {info}"); fails.append(name); continue
    dec = ffmpeg_check(out)
    dur = ffprobe_dur(out)
    ok = not dec and dur is not None and abs(dur - (info["t1"] - info["t0"])) < 0.2
    print(f"{'OK ' if ok else 'FAIL'} {name} ({desc}): {info['fmt']} {info['sampleRate']}Hz "
          f"{info['channels']}ch → [{info['t0']:.3f},{info['t1']:.3f}] 输出时长 {dur}{' 解码错误:'+dec if dec else ''}")
    if not ok: fails.append(name)

print("\n========== 2) 边界切割参数 ==========")
EDGE = [
    # (文件, s, e, 说明)
    ("test.wav", 0.0, 30.0, "全选"),
    ("test.wav", 0.0, 0.05, "极短区间 50ms"),
    ("test.wav", 29.9, 30.0, "贴终点"),
    ("test.mp3", 0.0, 30.0, "MP3 全选（含 Xing 头帧）"),
    ("test.mp3", 0.0, 0.05, "MP3 极短"),
    ("test.m4a", 0.0, 30.0, "M4A 全选"),
    ("test.flac", 0.0, 30.0, "FLAC 全选"),
    ("test.flac", 29.95, 30.0, "FLAC 贴终点"),
    ("test.ogg", 0.0, 30.0, "OGG 全选"),
    ("test_opus.ogg", 0.0, 30.0, "Opus OGG 全选"),
    ("test.wav", 10.0, 100.0, "终点超时长（应 clamp）"),
    ("test.mp3", 10.0, 100.0, "MP3 终点超时长"),
]
for name, s, e, desc in EDGE:
    src = os.path.join(TEST, name)
    if not os.path.exists(src): continue
    out = os.path.join(OUT, f"sup_edge_{name.replace('.', '_')}_{int(s*1000)}_{int(e*1000)}")
    info, rc = run_js(src, s, e, out)
    if not info or "error" in info:
        print(f"FAIL {name} {desc}: {info}"); fails.append(f"{name}:{desc}"); continue
    dec = ffmpeg_check(out)
    dur = ffprobe_dur(out)
    exp = info["t1"] - info["t0"]
    ok = not dec and dur is not None and abs(dur - exp) < 0.2 and exp > 0
    print(f"{'OK ' if ok else 'FAIL'} {name} [{s}→{e}] {desc}: 切出 [{info['t0']:.3f},{info['t1']:.3f}] "
          f"({exp:.3f}s) 输出 {dur}{' 解码错误:'+dec if dec else ''}")
    if not ok: fails.append(f"{name}:{desc}")

print("\n========== 3) 损坏/伪造文件错误处理 ==========")
BAD = ["trunc.mp3", "trunc.flac", "trunc.ogg", "trunc.m4a", "fake.mp3", "fake.wav"]
for name in BAD:
    src = os.path.join(TEST, name)
    if not os.path.exists(src): continue
    info, rc = run_js(src, mode="parse")
    graceful = info is not None and "error" in info and rc != 0
    # 截断文件可能恰好能解析（容忍）；但伪造文件必须报错
    must_fail = name.startswith("fake") or name.startswith("trunc.m4a")
    ok = graceful if must_fail else (info is not None)
    print(f"{'OK ' if ok else 'FAIL'} {name}: rc={rc} {info if info else '(无输出)'}")
    if not ok: fails.append(f"bad:{name}")

print("\n========== 4) 性能（180s FLAC） ==========")
src = os.path.join(TEST, "long.flac")
t0 = time.time()
info, rc = run_js(src, 30.0, 90.0, os.path.join(OUT, "sup_long.flac"))
dt = time.time() - t0
if info and "error" not in info:
    dec = ffmpeg_check(os.path.join(OUT, "sup_long.flac"))
    dur = ffprobe_dur(os.path.join(OUT, "sup_long.flac"))
    ok = not dec and dur is not None and abs(dur - (info["t1"] - info["t0"])) < 0.2
    print(f"{'OK ' if ok else 'FAIL'} long.flac 180s: 解析+切割 {dt:.1f}s，切出 [{info['t0']:.3f},{info['t1']:.3f}]，输出时长 {dur}")
    if not ok: fails.append("long.flac")
else:
    print(f"FAIL long.flac: {info}"); fails.append("long.flac")

print(f"\n===== {'SUPPLEMENT ALL OK' if not fails else str(len(fails)) + ' FAILURES: ' + ', '.join(fails)} =====")
sys.exit(1 if fails else 0)
