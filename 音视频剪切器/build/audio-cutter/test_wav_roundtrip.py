"""WAV 切割往返测试：浏览器内切割 → 下载 → 重新导入，断言可正常解析。
覆盖：奇数长度 chunk、fact size>4、blockAlign/byteRate=0、8bit 奇数字节、24bit、float32。
"""
import asyncio, os, sys, struct
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
HTML = "file://" + os.path.join(BASE, "audio-stream-cutter.html")
OUT = os.path.join(BASE, "out_roundtrip")
os.makedirs(OUT, exist_ok=True)

CASES = [
    ("/tmp/wavtest/e_oddchunk.wav", "0", "0.5"),
    ("/tmp/wavtest/f_fact8.wav",    "0", "0.5"),
    ("/tmp/wavtest/g_ba0.wav",      "0", "0.5"),
    ("/tmp/wavtest/c_u8.wav",       "0", "0.0001"),   # 8bit 单声道 1 样本 → 奇数 data 长度
    ("/tmp/wavtest/d_24.wav",       "0.2", "0.7"),
    ("/tmp/wavtest/b_float.wav",    "0.2", "0.7"),
]

def check_wav_structure(path):
    """独立校验：chunk 遍历必须首尾吻合，RIFF size == 文件长度-8，data 存在。"""
    b = open(path, "rb").read()
    assert b[:4] == b"RIFF" and b[8:12] == b"WAVE", "RIFF/WAVE 头缺失"
    riff_size = struct.unpack("<I", b[4:8])[0]
    p, chunks = 12, []
    while p + 8 <= len(b):
        cid = b[p:p+4]; size = struct.unpack("<I", b[p+4:p+8])[0]
        chunks.append((cid, size, p))
        p += 8 + size + (size & 1)
    assert p == len(b), f"chunk 遍历未闭合：p={p} len={len(b)}（存在错位/缺 pad）"
    assert riff_size == len(b) - 8, f"RIFF size={riff_size} != {len(b)-8}"
    ids = [c[0] for c in chunks]
    assert b"data" in ids, f"缺少 data chunk，实际 {ids}"
    for cid, size, off in chunks:
        assert cid.isascii() and all(32 <= x < 127 for x in cid), f"非法 chunk ID {cid!r} @{off}"
    return [(c[0].decode(), c[1]) for c in chunks]

async def main():
    fails = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: fails.append(f"pageerror: {e}"))
        await page.goto(HTML)

        for src, t0, t1 in CASES:
            name = os.path.basename(src)
            # 1) 首次导入
            await page.set_input_files("#fileInput", src)
            await page.wait_for_selector("#editor:not([hidden])", timeout=30000)
            await page.wait_for_function(
                "(n)=>document.getElementById('infoList').innerText.includes(n)", arg=name, timeout=30000)
            await page.locator("#inTime").fill(t0); await page.locator("#inTime").press("Enter")
            await page.locator("#outTime").fill(t1); await page.locator("#outTime").press("Enter")
            # 2) 切割并下载
            async with page.expect_download(timeout=30000) as dl_info:
                await page.locator("#cutBtn").click()
            dl = await dl_info.value
            out_path = os.path.join(OUT, "rt_" + name)
            await dl.save_as(out_path)

            # 3) 独立结构校验
            try:
                layout = check_wav_structure(out_path)
                struct_ok = True
                struct_msg = " ".join(f"{c}:{s}" for c, s in layout)
            except AssertionError as e:
                struct_ok = False
                struct_msg = str(e)

            # 4) 重新导入（真实用户路径）
            await page.reload()
            await page.set_input_files("#fileInput", out_path)
            await page.wait_for_function(
                "(n)=>document.getElementById('infoList').innerText.includes(n)",
                arg=os.path.basename(out_path), timeout=30000)
            reimport_ok = True
            try:
                await page.wait_for_selector("#editor:not([hidden])", timeout=15000)
            except Exception:
                reimport_ok = False
            log_text = await page.locator("#logPanel").inner_text()
            parse_fail = "分析失败" in log_text
            dur_label = ""
            if reimport_ok:
                dur_label = await page.locator("#durLabel").inner_text()

            ok = struct_ok and reimport_ok and not parse_fail
            print(("OK  " if ok else "FAIL") + f" {name:16} 结构[{struct_msg}] 重导入={'成功' if reimport_ok else '失败'} {dur_label}"
                  + ("" if ok else f"  日志片段={log_text[-160:]!r}"))
            if not ok:
                fails.append(f"{name}: struct_ok={struct_ok} reimport={reimport_ok} parse_fail={parse_fail}")

        await browser.close()
    print("=====", "ALL OK" if not fails else f"{len(fails)} FAILURES: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())
