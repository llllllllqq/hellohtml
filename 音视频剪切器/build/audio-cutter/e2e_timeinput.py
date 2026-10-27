"""时间输入解析回归（音频版）：驱动同目录 audio-stream-cutter.html，夹具 test/long.flac（180s）"""
import sys, os, asyncio
from playwright.async_api import async_playwright

URL = "file://" + os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio-stream-cutter.html")
VIDEO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test", "long.flac")
fails = []

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: fails.append(f"pageerror: {e}"))
        await page.goto(URL)

        # 载入测试视频（180s）
        await page.set_input_files("#fileInput", VIDEO)
        await page.wait_for_selector("#editor:not([hidden])", timeout=60000)
        # 等信息面板填充（时长标签出现具体秒数）
        await page.wait_for_function(
            "document.getElementById('durLabel').textContent.includes('03:00')",
            timeout=30000)

        async def try_input(sel, text, expect_value):
            """填入 text 触发 change，等待输入框稳定后返回值"""
            el = page.locator(sel)
            await el.click()
            await el.fill(text)
            await el.press("Enter")   # 确保触发 change
            await el.blur()
            await page.wait_for_timeout(250)
            return await el.input_value()

        cases = [
            # (选择器, 输入, 期望回显值)
            ("#inTime",  "01:09",    "01:09.000"),   # 核心 bug：旧逻辑会变成 02:59.9xx（最大值）
            ("#inTime",  "00:01:09", "01:09.000"),   # 时:分:秒
            ("#inTime",  "69",       "01:09.000"),   # 纯秒
            ("#inTime",  "01:09.5",  "01:09.500"),
            ("#inTime",  "01:75",    "02:15.000"),   # 溢出归一化
            ("#inTime",  "01：09",   "01:09.000"),   # 全角冒号
            ("#inTime",  "junk",     None),          # 非法输入：应保持上一个有效值
            ("#outTime", "01:09",    "01:09.001"),   # 音频版最小间隔=1采样点(1/44100s)
            ("#outTime", "02:00",    "02:00.000"),
            ("#outTime", "01:30.250","01:30.250"),
        ]
        for sel, text, expect in cases:
            got = await try_input(sel, text, expect)
            if expect is None:
                # 非法输入应回退到当前有效值（此处上一次有效值即 01:09.000 / 02:15.000）
                ok = got not in ("", "NaN") and ":" in got
                note = "保持旧值" if ok else f"异常回显 {got!r}"
            else:
                ok = got == expect
                note = "" if ok else f"期望 {expect}"
            print(("OK  " if ok else "FAIL") + f" {sel} 输入 {text!r:12} → 回显 {got!r} {note}")
            if not ok:
                fails.append(f"{sel} {text!r} → {got!r} (期望 {expect})")

        # 双向 clamp 回归：end=01:30.250 时，start 填 02:00 被压到 end-1帧=01:30.208；
        # 随后 end 填 01:00（早于 start）被抬回 01:30.250（=start+1帧）
        await page.locator("#inTime").fill("02:00"); await page.locator("#inTime").press("Enter"); await page.locator("#inTime").blur()
        await page.locator("#outTime").fill("01:00"); await page.locator("#outTime").press("Enter"); await page.locator("#outTime").blur()
        await page.wait_for_timeout(250)
        v_in = await page.locator("#inTime").input_value()
        v_out = await page.locator("#outTime").input_value()
        ok = v_in == "01:30.249" and v_out == "01:30.250"
        print(("OK  " if ok else "FAIL") + f" clamp 回归: in={v_in} out={v_out}（期望 01:30.249 / 01:30.250，音频为采样级）")
        if not ok: fails.append(f"clamp: in={v_in} out={v_out}")

        # 提示文案存在
        hint = await page.locator(".fmt-hint").inner_text()
        ok = "分:秒" in hint
        print(("OK  " if ok else "FAIL") + f" 格式提示: {hint!r}")
        if not ok: fails.append("fmt-hint missing")

        await browser.close()

asyncio.run(main())
print("=====", "ALL OK" if not fails else f"{len(fails)} FAILURES: {fails}")
sys.exit(1 if fails else 0)
