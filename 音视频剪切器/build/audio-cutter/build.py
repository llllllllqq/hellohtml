#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build.py — 把 src/*.js 按序内联进 template.html，产出单文件 HTML"""
import os, re

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'src')
ORDER = ['common.js', 'wav.js', 'mp3.js', 'm4a.js', 'flac.js', 'ogg.js', 'detect.js', 'app.js']
OUT = os.path.join(BASE, 'audio-stream-cutter.html')

def main():
    tpl = open(os.path.join(BASE, 'template.html'), encoding='utf-8').read()
    parts = []
    for f in ORDER:
        code = open(os.path.join(SRC, f), encoding='utf-8').read().strip()
        parts.append(f'/* ==================== {f} ==================== */\n{code}')
    app = '\n\n'.join(parts)
    html = tpl.replace('/*__APP__*/', app)
    open(OUT, 'w', encoding='utf-8').write(html)
    print(f'built {OUT} ({os.path.getsize(OUT)} bytes)')

if __name__ == '__main__':
    main()
