#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_cut.py — node 解析/切割 + ffmpeg 验证全流程"""
import os, subprocess, sys, json

BASE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(BASE, "test")
OUT = os.path.join(BASE, "out")
os.makedirs(OUT, exist_ok=True)

CASES = [
    ("test.wav", 5.0, 12.0),
    ("test.mp3", 5.0, 12.0),
    ("test_vbr.mp3", 3.3, 11.7),
    ("test.m4a", 5.0, 12.0),
    ("test_alac.m4a", 5.0, 12.0),
    ("test_opus.m4a", 5.0, 12.0),
    ("test.flac", 5.0, 12.0),
    ("test.ogg", 5.0, 12.0),
    ("test_opus.ogg", 5.0, 12.0),
]

JS = r"""
const fs=require('fs');
const W=require('%s/src/wav.js'), M=require('%s/src/mp3.js'), A=require('%s/src/m4a.js'),
      F=require('%s/src/flac.js'), O=require('%s/src/ogg.js'), D=require('%s/src/detect.js');
const P={WAV:W,MP3:M,M4A:A,FLAC:F,OGG:O};
const [file, s, e]=process.argv.slice(2);
const b=new Uint8Array(fs.readFileSync(file));
const fmt=D.detect(b.buffer, file);
if(!fmt){ console.log(JSON.stringify({error:'detect failed'})); process.exit(1); }
let info;
try{ info=P[fmt].parse(b); }catch(err){ console.log(JSON.stringify({error:'parse: '+err.message})); process.exit(1); }
const res=P[fmt].cut(b, info, parseFloat(s), parseFloat(e));
const parts=res.parts;
const total=parts.reduce((a,p)=>a+p.length,0);
const out=Buffer.allocUnsafe(total);
let o=0; for(const p of parts){ out.set(Buffer.from(p.buffer,p.byteOffset,p.length), o); o+=p.length; }
const outName=process.argv[5];
fs.writeFileSync(outName, out);
console.log(JSON.stringify({
  fmt, duration:info.duration, sampleRate:info.sampleRate, channels:info.channels,
  codec:info.codec, bitrate:info.bitrate, vbr:info.vbr,
  boundaries:info.boundaries.length, t0:res.t0, t1:res.t1, outSize:total
}));
""" % (BASE, BASE, BASE, BASE, BASE, BASE)

def run_js(file, s, e, out):
    js = os.path.join(BASE, "test", "_run.js")
    open(js, "w").write(JS)
    r = subprocess.run(["node", js, file, str(s), str(e), out], capture_output=True, text=True)
    if r.returncode != 0:
        return None, (r.stderr.strip() or r.stdout.strip() or "node exit " + str(r.returncode))[:500]
    try:
        return json.loads(r.stdout.strip().splitlines()[-1]), None
    except Exception as ex:
        return None, f"json parse: {r.stdout[:300]} / {ex}"

def ffprobe_dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except: return None

def ffmpeg_check(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"],
                       capture_output=True, text=True)
    return r.stderr.strip()[:300]

def main():
    fails = 0
    for name, s, e in CASES:
        src = os.path.join(TEST, name)
        if not os.path.exists(src):
            print(f"SKIP {name} (missing)"); continue
        base = os.path.splitext(name)[0]
        out = os.path.join(OUT, "out_" + name)
        info, err = run_js(src, s, e, out)
        if err:
            print(f"FAIL {name}: {err}"); fails += 1; continue
        src_dur = ffprobe_dur(src)
        out_dur = ffprobe_dur(out)
        dec = ffmpeg_check(out)
        dur_err = ""
        if out_dur is not None and info:
            exp = info["t1"] - info["t0"]
            if abs(out_dur - exp) > 0.15:
                dur_err = f"  ⚠ 输出时长 {out_dur:.3f} 与声明区间 {exp:.3f} 偏差 > 150ms"
        src_txt = f"{src_dur:.3f}" if src_dur is not None else "?"
        print(f"{'OK ' if not dec else 'FAIL'} {name}: {info['fmt']}/{info['codec']} "
              f"{info['sampleRate']}Hz {info['channels']}ch 边界{info['boundaries']}个 "
              f"时长 {info['duration']:.3f}s(ffprobe {src_txt}) → 切出 [{info['t0']:.3f},{info['t1']:.3f}] "
              f"{info['outSize']}B{dur_err}")
        if dec:
            print(f"     解码错误: {dec}"); fails += 1
        if dur_err or out_dur is None:
            fails += 1
    print(f"\n===== {'ALL OK' if fails == 0 else str(fails) + ' FAILURES'} =====")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
