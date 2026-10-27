/* =====================================================================
 *  app.js — UI 逻辑（沿用视频剪切器的设计理念与交互）
 * ===================================================================== */
(function(root){
'use strict';
const $ = s => document.querySelector(s);
const S = { file: null, buf: null, info: null, start: 0, end: 0, t0: 0, t1: 0, outBlob: null, outUrl: null, dragging: null, moveOff: 0, rafId: 0 };

function log(msg){
  const el = $('#log');
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  el.textContent += `[${t}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
function fmtSize(n){
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtT(sec){
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
}
function fmtTFF(sec){
  sec = Math.max(0, sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
}
// 时间输入解析：支持 "69"/"69.5"（秒）、"01:09"/"01:09.5"（分:秒）、"00:01:09"（时:分:秒）；
// 全角冒号与逗号小数点自动归一化；分/秒允许溢出（如 01:75 视为 135s）
function parseT(str){
  const s = String(str).trim().replace(/[：︓]/g, ':').replace(/,/g, '.');
  if (!s) return NaN;
  const m = s.match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  const c = +m[3];
  if (!isFinite(c)) return NaN;
  if (m[2] !== undefined) return (+m[1]) * 3600 + (+m[2]) * 60 + c;  // 时:分:秒
  if (m[1] !== undefined) return (+m[1]) * 60 + c;                   // 分:秒
  return c;                                                          // 纯秒
}

/* ---------- 文件载入 ---------- */
const PARSERS = {
  WAV: () => root.ACWav, MP3: () => root.ACMp3,
  M4A: () => root.ACM4a, FLAC: () => root.ACFlac, OGG: () => root.ACOgg
};

async function loadFile(file){
  S.file = file; S.outBlob = null;
  $('#result').hidden = true;
  $('#unsupportedBox').hidden = true;
  log(`载入文件：${file.name}（${fmtSize(file.size)}）`);
  setProgress(0.05, '读取文件…');
  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e){
    setProgress(0, '');
    log('读取失败：' + e.message);
    alert('读取文件失败：' + e.message);
    return;
  }
  const b = new Uint8Array(buf);
  S.buf = b;
  setProgress(0.4, '解析音频结构…');
  await new Promise(r => setTimeout(r, 30));

  const fmt = root.ACDetect.detect(buf, file.name);
  if (!fmt){
    setProgress(0, '');
    $('#editor').hidden = true;
    showUnsupported(`无法识别该音频格式。<br>支持：WAV / MP3 / M4A(AAC/ALAC/Opus) / FLAC / OGG(Vorbis/Opus)。`);
    return;
  }
  let info;
  try { info = PARSERS[fmt]().parse(b); }
  catch (e){
    setProgress(0, '');
    $('#editor').hidden = true;
    showUnsupported(e.message);
    log('分析失败：' + e.message);
    return;
  }
  S.info = info;
  setProgress(1, '完成'); setTimeout(() => setProgress(0, ''), 600);
  log(`解析完成：${info.format} / ${info.codec}，时长 ${info.duration.toFixed(3)}s，${info.sampleRate} Hz`);

  const a = $('#audio');
  if (S.outUrl){ URL.revokeObjectURL(S.outUrl); S.outUrl = null; }
  a.src = URL.createObjectURL(file);

  const rows = [
    ['文件名', file.name],
    ['文件大小', fmtSize(file.size)],
    ['格式', info.format],
    ['时长', fmtT(info.duration) + '  (' + info.duration.toFixed(3) + ' s)'],
    ['编码', info.codec],
    ['采样率', info.sampleRate + ' Hz'],
    ['声道', info.channels + (info.channels > 2 ? '' : (info.channels === 2 ? '（立体声）' : '（单声道）'))],
  ];
  if (info.bitDepth) rows.push(['位深', info.bitDepth + '-bit']);
  if (info.bitrate) rows.push(['平均码率', (info.bitrate / 1000).toFixed(0) + ' kbps' + (info.vbr ? '（VBR）' : '')]);
  rows.push(['切割精度', info.boundaryLabel]);
  for (const [k, v] of (info.extra || [])) rows.push([k, v]);
  $('#infoList').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#durLabel').textContent = fmtT(info.duration);

  S.start = 0; S.end = info.duration; S.t0 = 0; S.t1 = info.duration;
  $('#editor').hidden = false;
  syncInputs(); drawTL(); updateSnapNote();
  $('#dropZone').style.display = 'none';
}
function showUnsupported(msg){
  const box = $('#unsupportedBox');
  box.hidden = false;
  box.innerHTML = `<b>无法处理该文件</b><br>${msg}`;
}

/* ---------- 时间线 ---------- */
const tl = $('#tl');
const tctx = tl.getContext('2d');
function tlW(){ return tl.clientWidth; }
function t2x(t){ return t / S.info.duration * tlW(); }
function x2t(x){ return Math.max(0, Math.min(S.info.duration, x / tlW() * S.info.duration)); }

function drawTL(){
  if (!S.info) return;
  const dpr = window.devicePixelRatio || 1;
  const W = tlW(), H = 86;
  if (tl.width !== W * dpr || tl.height !== H * dpr){ tl.width = W * dpr; tl.height = H * dpr; }
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.clearRect(0, 0, W, H);
  const info = S.info, dur = info.duration || 1;

  // 密度条
  const d = info.density, bw = W / d.length;
  tctx.fillStyle = '#7c9bdd';
  for (let i = 0; i < d.length; i++){
    const h = Math.max(1, d[i] * 44);
    tctx.fillRect(i * bw, H - 22 - h, Math.max(1, bw - 0.5), h);
  }
  // 帧/页边界刻度
  tctx.fillStyle = '#0a9d6ecc';
  for (const k of info.boundaries){
    const x = k / dur * W;
    if (x < 0 || x > W) continue;
    tctx.fillRect(x, H - 20, 1, 10);
  }
  // 区间
  const xs = t2x(S.t0), xe = t2x(S.t1);
  tctx.fillStyle = 'rgba(31,111,235,.12)';
  tctx.fillRect(xs, 0, Math.max(1, xe - xs), H);
  // 选中边框 + 手柄
  tctx.strokeStyle = '#1f6feb'; tctx.lineWidth = 2;
  tctx.beginPath(); tctx.moveTo(xs, 0); tctx.lineTo(xs, H); tctx.moveTo(xe, 0); tctx.lineTo(xe, H); tctx.stroke();
  tctx.fillStyle = '#1f6feb';
  tctx.fillRect(xs - 4, 0, 8, 14); tctx.fillRect(xe - 4, 0, 8, 14);
  // 实际起点虚线（帧/页吸附）
  const xsnap = t2x(actualStart());
  if (Math.abs(xsnap - xs) > 1.5){
    tctx.strokeStyle = '#8b5cf6'; tctx.setLineDash([6, 4]); tctx.lineWidth = 2;
    tctx.beginPath(); tctx.moveTo(xsnap, 12); tctx.lineTo(xsnap, H - 2); tctx.stroke();
    tctx.setLineDash([]);
  }
  // 播放头
  const a = $('#audio');
  if (a.duration){
    const xp = a.currentTime / dur * W;
    tctx.fillStyle = '#e5484d';
    tctx.fillRect(xp - 1.5, 0, 3, H);
    tctx.beginPath(); tctx.moveTo(xp - 5, 0); tctx.lineTo(xp + 5, 0); tctx.lineTo(xp, 7); tctx.closePath(); tctx.fill();
  }
  // 顶部时间刻度
  const step = niceStep(dur, W);
  tctx.fillStyle = '#5b6577'; tctx.font = '10px ui-monospace,monospace';
  tctx.textAlign = 'center';
  for (let t = 0; t <= dur; t += step){
    const x = t / dur * W;
    tctx.fillRect(x, H - 8, 1, 8);
    if (x > 18 && x < W - 18) tctx.fillText(fmtShort(t), x, H - 10);
  }
  tctx.textAlign = 'left';
}
function niceStep(dur, W){
  const target = W / 90;
  const raw = dur / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}
function fmtShort(t){
  const m = Math.floor(t / 60), s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(0).padStart(2, '0')}` : s.toFixed(0) + 's';
}
/* 吸附：起点取 <= start 的最后一个边界；WAV 等无边界格式原样返回 */
function actualStart(){
  if (!S.info) return 0;
  return root.ACCommon.snapTo(S.info.boundaries, S.start);
}
function actualEnd(){
  if (!S.info) return 0;
  return root.ACCommon.snapEndTo(S.info.boundaries, S.end);
}

tl.addEventListener('pointerdown', e => {
  if (!S.info) return;
  const r = tl.getBoundingClientRect();
  const x = e.clientX - r.left, t = x2t(x);
  const xs = t2x(S.t0), xe = t2x(S.t1);
  if (Math.abs(x - xs) < 9) S.dragging = 'start';
  else if (Math.abs(x - xe) < 9) S.dragging = 'end';
  else if (x > xs && x < xe){ S.dragging = 'move'; S.moveOff = t - S.t0; }
  else { S.dragging = 'seek'; seekAudio(t); }
  tl.setPointerCapture(e.pointerId);
});
tl.addEventListener('pointermove', e => {
  if (!S.info) return;
  const r = tl.getBoundingClientRect();
  const x = e.clientX - r.left, t = x2t(x);
  if (!S.dragging){
    const xs = t2x(S.t0), xe = t2x(S.t1);
    tl.style.cursor = (Math.abs(x - xs) < 9 || Math.abs(x - xe) < 9) ? 'col-resize' : (x > xs && x < xe ? 'grab' : 'pointer');
    return;
  }
  const minLen = Math.min(0.05, S.info.duration / 100);
  if (S.dragging === 'start'){ S.start = Math.min(t, S.end - minLen); }
  else if (S.dragging === 'end'){ S.end = Math.max(t, S.start + minLen); }
  else if (S.dragging === 'move'){
    const len = S.t1 - S.t0;
    S.start = Math.max(0, Math.min(t - S.moveOff, S.info.duration - len));
    S.end = S.start + len;
  }
  else if (S.dragging === 'seek') seekAudio(t);
  syncSel(); syncInputs(); drawTL(); updateSnapNote();
});
tl.addEventListener('pointerup', () => { S.dragging = null; });
tl.addEventListener('pointercancel', () => { S.dragging = null; });

function seekAudio(t){
  const a = $('#audio');
  if (!a.duration) return;
  a.currentTime = Math.max(0, Math.min(a.duration, t));
}
function syncInputs(){
  $('#inTime').value = fmtT(S.start);
  $('#outTime').value = fmtT(S.end);
}
function syncSel(){ S.t0 = S.start; S.t1 = S.end; }
function updateSnapNote(){
  if (!S.info) return;
  const s = actualStart(), e = actualEnd();
  if (!S.info.boundaries.length){
    $('#snapNote').textContent = `所选区间 ${fmtT(S.start)} → ${fmtT(S.end)}；PCM 样本级切割，输出区间与所选完全一致。`;
  } else {
    $('#snapNote').textContent =
      `所选区间 ${fmtT(S.start)} → ${fmtT(S.end)}；因不修改编码，实际切割点吸附到${S.info.format === 'OGG' ? '页' : '帧'}边界 ${fmtT(s)} → ${fmtT(e)}。`;
  }
}
function setProgress(p, text){
  $('#progWrap').classList.toggle('on', p > 0 || !!text);
  $('#progBar').style.width = (p * 100).toFixed(1) + '%';
  $('#progText').textContent = text || '';
}

/* ---------- 控件事件 ---------- */
$('#pickBtn').addEventListener('click', e => { e.stopPropagation(); $('#fileInput').click(); });
$('#dropZone').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); $('#dropZone').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); $('#dropZone').classList.remove('over'); }));
document.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

$('#inTime').addEventListener('change', e => {
  const t = parseT(e.target.value);
  if (!isNaN(t)){ S.start = Math.max(0, Math.min(t, S.end - 0.001)); syncSel(); syncInputs(); drawTL(); updateSnapNote(); }
  else syncInputs();
});
$('#outTime').addEventListener('change', e => {
  const t = parseT(e.target.value);
  if (!isNaN(t)){ S.end = Math.min(S.info.duration, Math.max(t, S.start + 0.001)); syncSel(); syncInputs(); drawTL(); updateSnapNote(); }
  else syncInputs();
});
$('#btnSetStart').addEventListener('click', () => {
  const a = $('#audio'); if (a.duration){ S.start = Math.max(0, Math.min(a.currentTime, S.end - 0.001)); syncSel(); syncInputs(); drawTL(); updateSnapNote(); }
});
$('#btnSetEnd').addEventListener('click', () => {
  const a = $('#audio'); if (a.duration){ S.end = Math.min(S.info.duration, Math.max(a.currentTime, S.start + 0.001)); syncSel(); syncInputs(); drawTL(); updateSnapNote(); }
});
$('#btnPlaySel').addEventListener('click', () => playSelection());
function playSelection(){
  const a = $('#audio');
  if (!a.duration) return;
  a.currentTime = S.t0 || S.start;
  a.play().catch(() => {});
}
const audio = $('#audio');
audio.addEventListener('timeupdate', () => {
  if (!S.info) return;
  const end = S.t1 || S.end;
  if (!audio.paused && audio.currentTime >= end - 0.005){
    if ($('#loopChk').checked){ audio.currentTime = S.t0 || S.start; }
    else audio.pause();
  }
});
function rafLoop(){ if (S.info) drawTL(); S.rafId = requestAnimationFrame(rafLoop); }
rafLoop();
window.addEventListener('resize', () => drawTL());

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || !S.info) return;
  if (e.code === 'Space'){ e.preventDefault(); audio.paused ? playSelection() : audio.pause(); }
  else if (e.key === 'i' || e.key === 'I') $('#btnSetStart').click();
  else if (e.key === 'o' || e.key === 'O') $('#btnSetEnd').click();
  else if (e.key === 'p' || e.key === 'P') playSelection();
});

/* ---------- 执行剪切 ---------- */
$('#cutBtn').addEventListener('click', doCut);
async function doCut(){
  if (!S.info) return;
  const btn = $('#cutBtn'); btn.disabled = true;
  try{
    setProgress(0.15, '计算切割点…');
    await new Promise(r => setTimeout(r, 20));
    setProgress(0.45, '重组文件…');
    await new Promise(r => setTimeout(r, 20));
    const res = PARSERS[S.info.format]().cut(S.buf, S.info, S.start, S.end);
    S.t0 = res.t0; S.t1 = res.t1;
    setProgress(0.95, '封装输出…');
    await new Promise(r => setTimeout(r, 20));
    const blob = new Blob(res.parts, { type: S.info.mime });
    if (S.outUrl) URL.revokeObjectURL(S.outUrl);
    S.outBlob = blob; S.outUrl = URL.createObjectURL(blob);

    const base = S.file.name.replace(/\.[^.]+$/, '');
    const name = `${base}_cut_${fmtT(S.t0).replace(/[:.]/g, '-')}_${fmtT(S.t1).replace(/[:.]/g, '-')}.${S.info.ext}`;
    const dl = $('#dlBtn');
    dl.href = S.outUrl; dl.download = name;

    $('#resList').innerHTML = [
      ['输出时长', fmtT(S.t1 - S.t0) + `  (${(S.t1 - S.t0).toFixed(3)} s)`],
      ['输出大小', fmtSize(blob.size)],
      ['编码', '与源文件完全相同（未重新编码）'],
      ['实际区间', `${fmtT(S.t0)} → ${fmtT(S.t1)}`],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('#ffCmd').textContent = `ffmpeg -ss ${fmtTFF(S.t0)} -to ${fmtTFF(S.t1)} -i "${S.file.name}" -c copy "${name}"`;
    $('#result').hidden = false;
    setProgress(1, '完成'); setTimeout(() => setProgress(0, ''), 600);
    log(`输出完成：${name}（${fmtSize(blob.size)}）`);

    // 浏览器可播放性验证
    $('#playCheck').textContent = '正在验证输出文件…';
    const test = document.createElement('audio');
    test.preload = 'metadata';
    test.onloadedmetadata = () => {
      $('#playCheck').textContent = `✓ 已验证可在浏览器播放（时长 ${test.duration.toFixed(2)}s）`;
      log('输出验证：可播放，时长 ' + test.duration.toFixed(2) + 's');
    };
    test.onerror = () => { $('#playCheck').textContent = '⚠ 浏览器不支持该编码预览（文件本身有效，可用本地播放器打开）'; log('输出验证：浏览器不支持预览'); };
    test.src = S.outUrl;

    dl.click();
  } catch (err){
    console.error(err);
    setProgress(0, '');
    log('剪切失败：' + err.message);
    alert('剪切失败：' + err.message);
  } finally {
    btn.disabled = false;
  }
}
$('#againBtn').addEventListener('click', () => { $('#result').hidden = true; });

log('就绪。请选择或拖入一个音频文件（WAV / MP3 / M4A / FLAC / OGG）。');
})(typeof self !== 'undefined' ? self : globalThis);
