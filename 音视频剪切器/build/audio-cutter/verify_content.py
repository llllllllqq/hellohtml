#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_content.py — 内容级验证：输出的解码音频 vs 源对应区间
   有损格式起点有帧/页级偏移，允许 ±300ms 偏移搜索取最佳相关；"""
import os, subprocess, sys, struct

BASE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(BASE, "test")
OUT = os.path.join(BASE, "out")

CASES = [
    ("test.wav", "out_test.wav", 5.000, 12.000),
    ("test.mp3", "out_test.mp3", 5.016, 11.990),
    ("test_vbr.mp3", "out_test_vbr.mp3", 3.318, 11.677),
    ("test.m4a", "out_test.m4a", 5.016, 11.981),
    ("test_alac.m4a", "out_test_alac.m4a", 5.016, 11.981),
    ("test_opus.m4a", "out_test_opus.m4a", 5.000, 12.000),
    ("test.flac", "out_test.flac", 5.016, 12.016),
    ("test.ogg", "out_test.ogg", 4.077, 11.228),
    ("test_opus.ogg", "out_test_opus.ogg", 4.994, 11.993),
]

def pcm(path, ss=None, to=None, skip=0.0):
    cmd = ["ffmpeg", "-v", "error"]
    if ss is not None: cmd += ["-ss", f"{ss:.3f}"]
    if to is not None: cmd += ["-to", f"{to:.3f}"]
    cmd += ["-i", path, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"]
    if skip > 0: cmd += ["-ss", f"{skip:.3f}"]   # 输出侧 seek（重采样后跳过，近似）
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:200])
    return r.stdout

def samples(data):
    n = len(data) // 2
    return struct.unpack(f"<{n}h", data[:n*2])

def best_corr(A, B, sr=8000, max_shift_ms=300):
    """在 ±max_shift_ms 内搜索最佳相关系数"""
    n = min(len(A), len(B))
    if n < sr // 2: return 0.0, 0.0
    A = A[:n]; B = B[:n]
    def corr_at(shift):
        m = n - abs(shift)
        if m < sr // 2: return -1
        if shift >= 0: a = A[shift:shift+m]; b = B[:m]
        else: a = A[:m]; b = B[-shift:-shift+m]
        ma = sum(a) / m; mb = sum(b) / m
        va = sum((x - ma) ** 2 for x in a); vb = sum((x - mb) ** 2 for x in b)
        if va <= 0 or vb <= 0: return -1
        vab = sum((a[i] - ma) * (b[i] - mb) for i in range(m))
        return vab / (va ** 0.5 * vb ** 0.5)
    best = -1; bestShift = 0
    step = max(1, int(sr * 0.002))     # 2ms 步进
    for shift in range(-int(sr * max_shift_ms / 1000), int(sr * max_shift_ms / 1000) + 1, step):
        c = corr_at(shift)
        if c > best: best = c; bestShift = shift
    return best, bestShift / sr

def main():
    fails = 0
    for src, out, t0, t1 in CASES:
        sp = os.path.join(TEST, src); op = os.path.join(OUT, out)
        try:
            src_pcm = pcm(sp, ss=t0, to=t1)
            out_pcm = pcm(op)
        except RuntimeError as e:
            print(f"FAIL {out}: {e}"); fails += 1; continue
        A = samples(src_pcm); B = samples(out_pcm)
        # 能量比（整体）
        ea = (sum(x*x for x in A) / max(1, len(A))) ** 0.5
        eb = (sum(x*x for x in B) / max(1, len(B))) ** 0.5
        ratio = eb / ea if ea > 0 else 0
        mx = max((abs(x) for x in B), default=0)
        c, shift = best_corr(A, B)
        dur_out = len(B) / 8000
        ok = c > 0.9 and 0.85 < ratio < 1.18 and mx > 400 and abs(dur_out - (t1 - t0)) < 0.2
        print(f"{'OK ' if ok else 'FAIL'} {out}: 相关 {c:.4f}(偏移{shift*1000:+.0f}ms) 能量比 {ratio:.3f} "
              f"时长 {dur_out:.2f}s(期望{t1-t0:.2f}) 峰值 {mx}{'' if ok else '  ← 异常'}")
        if not ok: fails += 1
    print(f"\n===== {'CONTENT ALL OK' if fails == 0 else str(fails) + ' FAILURES'} =====")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
