// @ts-check
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalScroll,
  expectResponsiveViewport,
} = require('./utils');

const PAGE = encodeURI('/提醒器/reminder.html');

/** 固定基准时间：2026-03-10 是周二，便于推算「下一个工作日 / 周末」。 */
const BASE = '2026-03-10T08:00:00+08:00';

/** 装好假时钟并把时间钉住，避免断言随真实时间漂移。 */
async function installClock(page, iso) {
  const time = new Date(iso);
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

/** 打开页面并等待首屏 boot 结束（状态条不再显示「正在检查…」）。 */
async function openPage(page) {
  await page.goto(PAGE);
  await expect(page.locator('#statusText')).not.toHaveText('正在检查声音状态…');
}

/** 生成一份可直接导入的 config.txt 备份内容。 */
function backupFile(jobs, settings) {
  const body = JSON.stringify({ version: 1, settings: settings || {}, jobs });
  return {
    name: 'config.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(`/* 提醒器配置备份 */\nwindow.REMINDERS = ${body};\n`),
  };
}

/** 通过 UI 新建一条提醒。 */
async function addJob(page, { label, type = 'daily', time = '09:00', dows = [], day, date, audio }) {
  await page.locator('#addBtn').click();
  await page.locator('#fLabel').fill(label);

  if (type !== 'daily') {
    await page.locator(`#segType button[data-type="${type}"]`).click();
  }
  if (type === 'weekly') {
    for (const dow of dows) {
      await page.locator(`#dowsBox label:has(input[value="${dow}"]) span`).click();
    }
  }
  if (type === 'monthly') {
    await page.locator('#fDay').fill(String(day === undefined ? 15 : day));
  }
  if (type === 'once') {
    await page.locator('#fDate').fill(date);
  }

  await page.locator('#fTime').fill(time);
  if (audio) await page.locator('#fAudio').fill(audio);

  await page.locator('#editorSave').click();
  await expect(page.locator('#editorMask')).toHaveClass(/hidden/);
}

/** 导入一份备份并等待列表刷新。 */
async function importJobs(page, jobs, settings) {
  await page.locator('#fileInput').setInputFiles(backupFile(jobs, settings));
  await expect(page.locator('#list .item')).toHaveCount(jobs.length);
}

test.describe('提醒器', () => {
  test('初始状态：空列表、首跑提示，移动端不横向溢出', async ({ page }) => {
    await openPage(page);

    await expect(page).toHaveTitle('提醒器');
    await expect(page.locator('#clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(page.locator('#statusBar')).toHaveClass(/bad/);
    await expect(page.locator('#statusTag')).toHaveText('点击启用');
    await expect(page.locator('#statusText')).toContainText('声音未启用');

    await expect(page.locator('#banner')).toBeVisible();
    await expect(page.locator('#banner')).toContainText('还没有提醒');
    await expect(page.locator('#list')).toContainText('还没有任何提醒');
    // 没有提醒时不显示「下一个」
    await expect(page.locator('#nextLine')).toBeHidden();
    await expect(page.locator('#footInfo')).toContainText('共 0 条');

    await expectResponsiveViewport(page);
    await expectNoHorizontalScroll(page);
  });

  test('点一下状态条即启用声音', async ({ page, browserName }) => {
    // 统计状态条真正收到的 click 事件，确认「点一下」这条路径走通
    await page.addInitScript(() => {
      window.__statusBarClicks = 0;
      document.addEventListener(
        'click',
        (event) => {
          if (event.target.closest('#statusBar')) window.__statusBarClicks++;
        },
        true,
      );
    });
    await openPage(page);

    await page.locator('#statusBar').click();

    await expect(page.locator('#statusBar')).toHaveClass(/ok/);
    await expect(page.locator('#statusTag')).toHaveText('守护中');
    await expect(page.locator('#statusText')).toContainText('声音已就绪');
    expect(await page.evaluate(() => window.__statusBarClicks)).toBe(1);
    // WebKit 的点击会先被 pointerdown 的静默解锁吃掉，toast 文案不作为断言
    if (browserName !== 'webkit') {
      await expect(page.locator('#toast')).toHaveText('声音已启用');
    }
  });

  test('不点页面时，几秒后提示先启用声音', async ({ page }) => {
    await installClock(page, BASE);
    await openPage(page);

    await page.clock.runFor(3_000);

    await expect(page.locator('#toast')).toHaveText('点一下顶部状态条启用声音');
    await expect(page.locator('#statusTag')).toHaveText('点击启用');
  });

  test('新建每天提醒：写入列表、「下一个」与页脚', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);
    await page.locator('#statusBar').click();

    await addJob(page, { label: '吃降压药' });

    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('.item-label')).toHaveText('吃降压药');
    await expect(page.locator('.item-sub')).toContainText('每天 09:00');
    await expect(page.locator('.item-sub')).toContainText('下次 今天 09:00');
    await expect(page.locator('#nextLine')).toContainText('吃降压药');
    await expect(page.locator('#nextLine')).toContainText('今天 09:00');
    await expect(page.locator('#nextLine')).toContainText('还有 1 小时');
    await expect(page.locator('#footInfo')).toContainText('共 1 条');
    await expect(page.locator('#footInfo')).toContainText('未备份');
    // 有提醒后首跑提示条收起
    await expect(page.locator('#banner')).toBeHidden();
  });

  test('表单校验：内容、星期、每月日期、一次性日期', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);

    await page.locator('#addBtn').click();

    await page.locator('#editorSave').click();
    await expect(page.locator('#toast')).toHaveText('请填写提醒内容');

    await page.locator('#fLabel').fill('测试提醒');

    await page.locator('#segType button[data-type="weekly"]').click();
    await page.locator('#editorSave').click();
    await expect(page.locator('#toast')).toHaveText('请至少选择一个星期几');

    await page.locator('#segType button[data-type="monthly"]').click();
    await page.locator('#fDay').fill('32');
    await page.locator('#editorSave').click();
    await expect(page.locator('#toast')).toHaveText('日期需在 1–31 之间');

    await page.locator('#segType button[data-type="once"]').click();
    await page.locator('#fDate').fill('');
    await page.locator('#editorSave').click();
    await expect(page.locator('#toast')).toHaveText('请选择日期');

    // 校验失败不落库，也不关闭对话框
    await expect(page.locator('#list .item')).toHaveCount(0);
    await expect(page.locator('#editorMask')).not.toHaveClass(/hidden/);
  });

  test('每周规则：工作日 / 周末 / 全选都翻译成人话', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);

    await addJob(page, { label: '上班打卡', type: 'weekly', dows: [1, 2, 3, 4, 5], time: '08:30' });
    await addJob(page, { label: '家庭日', type: 'weekly', dows: [0, 6], time: '10:00' });
    await addJob(page, { label: '吃药', type: 'weekly', dows: [0, 1, 2, 3, 4, 5, 6], time: '20:00' });

    await expect(page.locator('#list .item')).toHaveCount(3);
    await expect(page.locator('#list')).toContainText('工作日 08:30');
    await expect(page.locator('#list')).toContainText('周末 10:00');
    await expect(page.locator('#list')).toContainText('每天 20:00');
  });

  test('每月提醒：2 月没有 31 号时收敛到当月最后一天', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, '2026-02-10T08:00:00+08:00');
    await openPage(page);

    await importJobs(page, [
      {
        id: 'm31',
        label: '月底对账',
        rule: { type: 'monthly', day: 31, h: 9, m: 0, overflow: 'last' },
        enabled: true,
      },
    ]);

    await expect(page.locator('.item-sub')).toContainText('每月 31 日 09:00');
    await expect(page.locator('#nextLine')).toContainText('2 月 28 日 09:00');
  });

  test('到点弹出提醒，确认后顺延到明天', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, '2026-03-10T08:59:30+08:00');
    await openPage(page);
    await page.locator('#statusBar').click();

    await addJob(page, { label: '吃降压药' });
    await expect(page.locator('#nextLine')).toContainText('还有 30 秒');

    await page.clock.runFor(45_000);

    await expect(page.locator('#alarmMask')).not.toHaveClass(/hidden/);
    await expect(page.locator('#alarmLabel')).toHaveText('吃降压药');
    await expect(page.locator('#alarmTime')).toHaveText('原定 今天 09:00');
    await expect(page.locator('#alarmExtra')).toHaveText('');
    await expect(page.locator('#alarmList')).toHaveText('');

    await page.locator('#btnAck').click();

    await expect(page.locator('#alarmMask')).toHaveClass(/hidden/);
    await page.clock.runFor(3_000);
    await expect(page.locator('#nextLine')).toContainText('明天 09:00');
  });

  test('稍后再说：5 分钟后再次提醒', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, '2026-03-10T08:59:30+08:00');
    await openPage(page);
    await page.locator('#statusBar').click();

    await addJob(page, { label: '站起来活动' });
    await page.clock.runFor(45_000);

    await expect(page.locator('#alarmMask')).not.toHaveClass(/hidden/);
    await page.locator('#btnSnooze').click();

    await expect(page.locator('#alarmMask')).toHaveClass(/hidden/);
    await expect(page.locator('#toast')).toHaveText('将在 5 分钟后再次提醒');

    await page.clock.runFor(5 * 60_000 + 2_000);
    await expect(page.locator('#alarmMask')).not.toHaveClass(/hidden/);
    await expect(page.locator('#alarmLabel')).toHaveText('站起来活动');

    await page.locator('#btnAck').click();
    await expect(page.locator('#alarmMask')).toHaveClass(/hidden/);
  });

  test('打开页面时补提醒，并标注已晚几分钟', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, '2026-03-10T08:00:00+08:00');
    await openPage(page);

    await importJobs(page, [
      { id: 'd1', label: '吃降压药', rule: { type: 'daily', h: 9, m: 0 }, enabled: true },
    ]);

    // 模拟「关掉页面，5 分钟后再打开」
    await page.clock.setSystemTime(new Date('2026-03-10T09:05:00+08:00'));
    await page.reload();
    await expect(page.locator('#statusText')).not.toHaveText('正在检查声音状态…');
    await page.clock.runFor(1_000);

    await expect(page.locator('#alarmMask')).not.toHaveClass(/hidden/);
    await expect(page.locator('#alarmLabel')).toHaveText('吃降压药');
    await expect(page.locator('#alarmExtra')).toContainText('页面刚打开');
    await expect(page.locator('#alarmExtra')).toContainText('5 分钟前已到点');

    await page.locator('#btnAck').click();
    await expect(page.locator('#alarmMask')).toHaveClass(/hidden/);
  });

  test('编辑提醒：改内容与时间', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);

    await addJob(page, { label: '喝水' });
    await expect(page.locator('.item-sub')).toContainText('每天 09:00');

    await page.locator('.item-ops button[data-act="edit"]').click();
    await expect(page.locator('#editorTitle')).toHaveText('编辑提醒');
    await expect(page.locator('#fLabel')).toHaveValue('喝水');
    await page.locator('#fLabel').fill('喝水（大杯）');
    await page.locator('#fTime').fill('21:30');
    await page.locator('#editorSave').click();

    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('.item-label')).toHaveText('喝水（大杯）');
    await expect(page.locator('.item-sub')).toContainText('每天 21:30');
    await expect(page.locator('#nextLine')).toContainText('喝水（大杯）');
  });

  test('暂停 / 启用 / 删除提醒（删除需确认）', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);
    await addJob(page, { label: '喝水' });

    // 暂停
    await page.locator('.item-ops button[data-act="toggle"]').click();
    await expect(page.locator('#list .item')).toHaveClass(/off/);
    await expect(page.locator('.item-sub')).toContainText('已暂停');
    await expect(page.locator('#nextLine')).toHaveText('所有提醒都已暂停');
    await expect(page.locator('.item-ops button[data-act="toggle"]')).toHaveText('启用');

    // 再启用
    await page.locator('.item-ops button[data-act="toggle"]').click();
    await expect(page.locator('#list .item')).not.toHaveClass(/off/);
    await expect(page.locator('#nextLine')).toContainText('喝水');

    // 取消删除：列表保持不变
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('.item-ops button[data-act="del"]').click();
    await expect(page.locator('#list .item')).toHaveCount(1);

    // 确认删除：回到空状态
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('删除「喝水」？');
      await dialog.accept();
    });
    await page.locator('.item-ops button[data-act="del"]').click();
    await expect(page.locator('#list .item')).toHaveCount(0);
    await expect(page.locator('#list')).toContainText('还没有任何提醒');
    await expect(page.locator('#footInfo')).toContainText('共 0 条');
  });

  test('刷新后提醒仍在（IndexedDB 持久化）', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);
    await addJob(page, { label: '喝水', time: '15:00' });

    await page.reload();
    await expect(page.locator('#statusText')).not.toHaveText('正在检查声音状态…');

    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('.item-label')).toHaveText('喝水');
    await expect(page.locator('.item-sub')).toContainText('每天 15:00');
    await expect(page.locator('#footInfo')).toContainText('已存入浏览器数据库');
  });

  test('导出备份 config.txt：内容可再次导入', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);
    await addJob(page, { label: '喝水', time: '15:00' });
    await expect(page.locator('#footInfo')).toContainText('未备份');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btnSave').click(),
    ]);

    expect(download.suggestedFilename()).toBe('config.txt');
    const text = fs.readFileSync(await download.path(), 'utf8');
    expect(text).toContain('window.REMINDERS');

    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    expect(json.jobs).toHaveLength(1);
    expect(json.jobs[0].label).toBe('喝水');
    expect(json.jobs[0].rule).toMatchObject({ type: 'daily', h: 15, m: 0 });

    await expect(page.locator('#footInfo')).not.toContainText('未备份');
    await expect(page.locator('#toast')).toHaveText('已导出备份 config.txt');
  });

  test('从备份导入：覆盖为文件里的提醒', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);
    await addJob(page, { label: '旧提醒' });

    await importJobs(page, [
      { id: 'a', label: '喝水', rule: { type: 'daily', h: 8, m: 30 }, enabled: true },
      { id: 'b', label: '周会', rule: { type: 'weekly', dows: [1, 3], h: 21, m: 0 }, enabled: true },
    ]);

    await expect(page.locator('#toast')).toHaveText('已导入 2 条提醒');
    await expect(page.locator('#list')).toContainText('每天 08:30');
    await expect(page.locator('#list')).toContainText('每周一、三 21:00');
    await expect(page.locator('#list')).not.toContainText('旧提醒');
    await expect(page.locator('#footInfo')).toContainText('共 2 条');

    // 导入结果同样落库
    await page.reload();
    await expect(page.locator('#statusText')).not.toHaveText('正在检查声音状态…');
    await expect(page.locator('#list .item')).toHaveCount(2);
  });

  test('导入损坏的备份文件时给出提示', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await openPage(page);
    await addJob(page, { label: '喝水' });

    await page.locator('#fileInput').setInputFiles({
      name: 'config.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('这不是备份文件'),
    });

    await expect(page.locator('#toast')).toHaveText('文件解析失败，请确认是 config.txt 备份文件');
    await expect(page.locator('#list .item')).toHaveCount(1);
  });

  test('一次性提醒：过去的时间需要二次确认', async ({ page, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, '2026-03-10T10:00:00+08:00');
    await openPage(page);

    await page.locator('#addBtn').click();
    await page.locator('#fLabel').fill('取快递');
    await page.locator('#segType button[data-type="once"]').click();
    await page.locator('#fDate').fill('2026-03-10');
    await page.locator('#fTime').fill('08:00');

    // 取消：不保存
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('已经过去了');
      await dialog.dismiss();
    });
    await page.locator('#editorSave').click();
    await expect(page.locator('#list .item')).toHaveCount(0);
    await page.locator('#editorCancel').click();

    // 确认：保存为一次性提醒
    await page.locator('#addBtn').click();
    await page.locator('#fLabel').fill('取快递');
    await page.locator('#segType button[data-type="once"]').click();
    await page.locator('#fDate').fill('2026-03-10');
    await page.locator('#fTime').fill('08:00');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#editorSave').click();

    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('.item-sub')).toContainText('2026 年 3 月 10 日 08:00 · 一次性');
  });

  test('多标签页：第二个页面不重复响铃，可接管', async ({ page, context, isMobile }) => {
    test.skip(isMobile, '只在桌面端跑');
    await installClock(page, BASE);
    await openPage(page);
    // 先有一条提醒，否则首跑提示条会盖住「另一个标签页」的提示
    await addJob(page, { label: '喝水' });
    // 第一个页面是「主」页面，不该出现被接管的提示
    await expect(page.locator('#banner')).not.toContainText('另一个标签页');

    const second = await context.newPage();
    await second.goto(PAGE);
    await expect(second.locator('#statusText')).not.toHaveText('正在检查声音状态…');

    await expect(second.locator('#banner')).toBeVisible();
    await expect(second.locator('#banner')).toContainText('另一个标签页正在负责提醒');

    await second.locator('#btnTakeover').click();
    await expect(second.locator('#banner')).toBeHidden();
    await expect(second.locator('#toast')).toHaveText('本页已接管');
  });

  test('移动端：编辑器与列表在窄屏可用且不溢出', async ({ page, isMobile }) => {
    test.skip(!isMobile, '仅在移动端 project 运行');
    await installClock(page, BASE);
    await openPage(page);
    await page.locator('#statusBar').click();

    await page.locator('#addBtn').click();
    const dialogBox = await page.locator('#editorMask .dialog').boundingBox();
    expect(dialogBox.width).toBeLessThanOrEqual(page.viewportSize().width);
    await expectNoHorizontalScroll(page);

    await page.locator('#fLabel').fill('喝水');
    await page.locator('#fTime').fill('10:30');
    await page.locator('#editorSave').click();

    await expect(page.locator('.item-label')).toHaveText('喝水');
    await expect(page.locator('.item-sub')).toContainText('每天 10:30');
    await expectNoHorizontalScroll(page);

    // 触控下操作按钮依然可点
    await page.locator('.item-ops button[data-act="toggle"]').click();
    await expect(page.locator('#list .item')).toHaveClass(/off/);
  });

  test('移动端：到点提醒的按钮可点、弹层不溢出', async ({ page, isMobile }) => {
    test.skip(!isMobile, '仅在移动端 project 运行');
    await installClock(page, '2026-03-10T08:59:30+08:00');
    await openPage(page);
    await page.locator('#statusBar').click();
    await addJob(page, { label: '喝水' });

    await page.clock.runFor(45_000);

    await expect(page.locator('#alarmMask')).not.toHaveClass(/hidden/);
    await expect(page.locator('#btnAck')).toBeVisible();
    await expect(page.locator('#btnSnooze')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.locator('#btnAck').click();
    await expect(page.locator('#alarmMask')).toHaveClass(/hidden/);
  });
});
