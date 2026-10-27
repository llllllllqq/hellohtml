#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""e2e.py — Playwright 驱动音频剪切器 UI 全流程测试（5 格式 9 文件）"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(BASE, "test")
OUT = os.path.join(BASE, "out")
HTML = "file://" + os.path.join(BASE, "/workspace/audio-stream-cutter.html")

CASES = [
    ("test.wav", "00:05.000", "00:12.000"),
    ("test.mp3", "00:05.000", "00:12.000"),
    ("test_vbr.mp3", "00:03.300", "00:11.700"),
    ("test.m4a", "00:05.000", "00:12.000"),
    ("test_alac.m4a", "00:05.000", "00:12.000"),
    ("test_opus.m4a", "00:05.000", "00:12.000"),
    ("test.flac", "00:05.000", "00:12.000"),
    ("test.ogg", "00:05.000", "00:12.000"),
    ("test_opus.ogg", "00:05.000", "00:12.000"),
]

def main():
    results = []
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: (errors.append(str(e)), print("  [PAGE ERROR]", e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(HTML)
        page.wait_for_selector("#dropZone")
        for name, s, e in CASES:
            print(f"\n===== {name} [{s} -> {e}] =====")
            page.set_input_files("#fileInput", os.path.join(TEST, name))
            page.wait_for_function(
                "n => (document.querySelector('#infoList').textContent||'').includes(n)",
                arg=name, timeout=60000)
            info = page.inner_text("#infoList")
            print("  信息:", " | ".join(x.strip() for x in info.split("\n") if x.strip()))
            page.fill("#inTime", s)
            page.fill("#outTime", e)
            page.press("#outTime", "Tab")   # 失焦触发 change
            try:
                with page.expect_download(timeout=180000) as dl:
                    page.click("#cutBtn")
                    page.wait_for_selector("#result:not([hidden])", timeout=180000)
                d = dl.value
                out = os.path.join(OUT, "e2e_" + name)
                d.save_as(out)
                res = page.inner_text("#resList")
                print("  结果:", " | ".join(x.strip() for x in res.split("\n") if x.strip()))
                print("  已保存:", out, os.path.getsize(out), "bytes")
                results.append((name, out, True))
            except Exception as ex:
                print("  !! 失败:", str(ex)[:400])
                log = page.inner_text("#log")
                print("  页面日志:\n", log[-1500:])
                results.append((name, None, False))
        # 截图：编辑器态（用 wav）+ 结果态
        page.set_input_files("#fileInput", os.path.join(TEST, "test.mp3"))
        page.wait_for_function(
            "n => (document.querySelector('#infoList').textContent||'').includes(n)",
            arg="test.mp3", timeout=60000)
        page.fill("#inTime", "00:05.000")
        page.fill("#outTime", "00:12.000")
        page.press("#outTime", "Tab")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(BASE, "e2e_editor.png"), full_page=True)
        try:
            with page.expect_download(timeout=180000) as dl:
                page.click("#cutBtn")
                page.wait_for_selector("#result:not([hidden])", timeout=180000)
            dl.value.save_as("/tmp/e2e_discard.mp3")
            page.wait_for_timeout(600)
            page.screenshot(path=os.path.join(BASE, "e2e_result.png"), full_page=True)
            print("\n截图完成：e2e_editor.png / e2e_result.png")
        except Exception as ex:
            print("截图态切割失败:", str(ex)[:200])
        browser.close()
    print("\n===== 汇总 =====")
    for name, out, ok in results:
        print(f"  {'OK ' if ok else 'FAIL'} {name} -> {out}")
    print(f"  页面错误: {len(errors)} 个" + (f" -> {errors[:3]}" if errors else ""))
    return 0 if all(ok for _, _, ok in results) and not errors else 1

if __name__ == "__main__":
    sys.exit(main())
