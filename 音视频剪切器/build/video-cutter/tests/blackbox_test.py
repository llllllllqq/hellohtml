"""视频剪切器黑盒测试：真实浏览器切割 → 下载 → ffmpeg 校验（结构/解码/时长/元数据）。
不需要视频版源码，直接驱动 /workspace/video-stream-cutter.html。
"""
import asyncio, os, subprocess, sys, json
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
HTML = "file://" + os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "video-stream-cutter.html")
SRC = os.environ.get("VSRC", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures"))
OUT = os.path.join(BASE, "out_video", "")
OUT = os.path.join(BASE, "out_video")
os.makedirs(OUT, exist_ok=True)

# (文件, 起点, 终点, 期望键帧起点(秒)或None, 是否应报错)
CASES = [
    ("v1_default.mp4",  "10", "20", 10.0, False),
    ("v2_faststart.mp4","10", "20", 10.0, False),
    ("v4_shortgop.mp4", "10", "20", 10.0, False),
    ("v3_hevc.mp4",     "10", "20", 10.0, False),
    ("v5_noaudio.mp4",  "10", "20",  8.0, False),
    ("v6_twoaudio.mp4", "10", "20", 10.0, False),
    ("v7_frag.mp4",     "10", "20",  8.0, False),
]

def probe(path):
    j = json.loads(subprocess.run(
        ["ffprobe","-v","error","-show_entries","format=duration:stream=codec_type,codec_name,start_time",
         "-of","json",path], capture_output=True, text=True).stdout)
    return j

def decode_errors(path):
    r = subprocess.run(["ffmpeg","-v","error","-i",path,"-f","null","-"],
                       capture_output=True, text=True)
    return [l for l in r.stderr.strip().splitlines() if l.strip()][:5]

async def main():
    fails = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1300, "height": 950})
        page.on("pageerror", lambda e: fails.append(f"pageerror: {e}"))
        for i, (name, t0, t1, exp_start, expect_err) in enumerate(CASES):
            path = os.path.join(SRC, name)
            await page.goto(HTML)
            await page.set_input_files("#fileInput", path)
            # 等待载入完成或报错（两选一）
            await page.wait_for_function(
                "() => !document.getElementById('editor').hidden || !document.getElementById('unsupportedBox').hidden",
                timeout=60000)
            err_shown = not await page.evaluate("() => document.getElementById('unsupportedBox').hidden")
            if expect_err:
                ok = err_shown
                msg = (await page.locator("#unsupportedBox").inner_text()).replace("\n", " ")[:90] if err_shown else "未报错"
                print(("OK  " if ok else "FAIL") + f" {name:18} 预期拒绝 → {msg}")
                if not ok: fails.append(f"{name}: 应拒绝但进入编辑器")
                continue
            if err_shown:
                fails.append(f"{name}: 不应拒绝却报错")
                print(f"FAIL {name:18} 意外报错")
                continue

            # 等时长标签出现
            await page.wait_for_function("() => document.getElementById('durLabel').textContent.includes(':')", timeout=30000)
            await page.locator("#inTime").fill(t0); await page.locator("#inTime").press("Enter"); await page.locator("#inTime").blur()
            await page.locator("#outTime").fill(t1); await page.locator("#outTime").press("Enter"); await page.locator("#outTime").blur()
            async with page.expect_download(timeout=120000) as dl_info:
                await page.locator("#cutBtn").click()
            dl = await dl_info.value
            out_path = os.path.join(OUT, "vc_" + name)
            await dl.save_as(out_path)

            j = probe(out_path)
            dur = float(j["format"]["duration"])
            streams = j["streams"]
            types = [s["codec_type"] for s in streams]
            errs = decode_errors(out_path)
            # 视频流起点应约为 0；实际切片起点由关键帧决定
            vst = [float(s.get("start_time", "0")) for s in streams if s["codec_type"] == "video"]
            start_ok = (not vst) or abs(vst[0]) < 0.5
            dur_ok = 5 < dur < 14   # 选区 10s，按关键帧对齐可能前后浮动；上限覆盖 HEVC 的 2.6s GOP
            streams_ok = ("video" in types)
            ok = dur_ok and streams_ok and not errs and start_ok
            print(("OK  " if ok else "FAIL") +
                  f" {name:18} 输出 {dur:5.2f}s start={vst[0] if vst else '-'} streams={','.join(types)}"
                  + ("" if not errs else f" errs={errs[:1]}"))
            if not ok:
                fails.append(f"{name}: dur={dur} start={vst} types={types} errs={errs[:2]}")
        await browser.close()
    print("=====", "ALL OK" if not fails else f"{len(fails)} FAILURES")
    for f in fails: print("  -", f)
    sys.exit(1 if fails else 0)

asyncio.run(main())
