/* =====================================================================
 *  common.js — 共享工具：字节读取、密度数组、吸附查找
 * ===================================================================== */
(function(root, factory){
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACCommon = api;
})(typeof self !== 'undefined' ? self : globalThis, function(){
  'use strict';

  function u32(b, o){ return ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0; }
  function u16(b, o){ return ((b[o] << 8) | b[o+1]) >>> 0; }
  function u32le(b, o){ return ((b[o+3] << 24) | (b[o+2] << 16) | (b[o+1] << 8) | b[o]) >>> 0; }
  function u16le(b, o){ return ((b[o+1] << 8) | b[o]) >>> 0; }
  function u24(b, o){ return ((b[o] << 16) | (b[o+1] << 8) | b[o+2]) >>> 0; }
  function i16(b, o){ return (u16(b, o) | 0) / 32768; }          // 归一化 -1..1
  function i16le(b, o){ return (u16le(b, o) << 16 >> 16) / 32768; } // 小端归一化 -1..1
  function i32(b, o){ return (u32(b, o) | 0); }
  function u64(b, o){ return u32(b, o) * 4294967296 + u32(b, o + 4); }
  function fcc(b, o){ return String.fromCharCode(b[o], b[o+1], b[o+2], b[o+3]); }
  function w32(o, off, v){ o[off] = (v >>> 24) & 255; o[off+1] = (v >>> 16) & 255; o[off+2] = (v >>> 8) & 255; o[off+3] = v & 255; }
  function w32le(o, off, v){ o[off] = v & 255; o[off+1] = (v >>> 8) & 255; o[off+2] = (v >>> 16) & 255; o[off+3] = (v >>> 24) & 255; }
  function w64le(o, off, v){ w32le(o, off, v % 4294967296); w32le(o, off + 4, Math.floor(v / 4294967296)); }
  function w16(o, off, v){ o[off] = (v >>> 8) & 255; o[off+1] = v & 255; }
  function setType(o, off, t){ o[off] = t.charCodeAt(0); o[off+1] = t.charCodeAt(1); o[off+2] = t.charCodeAt(2); o[off+3] = t.charCodeAt(3); }

  const COLS = 400;

  /* 把 (时间, 权重) 序列累积成归一化密度数组 */
  function buildDensity(points, duration){
    const d = new Float32Array(COLS);
    if (!(duration > 0)) return d;
    for (const [t, w] of points){
      const c = Math.min(COLS - 1, Math.max(0, Math.floor(t / duration * COLS)));
      d[c] += w;
    }
    let mx = 0;
    for (let i = 0; i < COLS; i++) if (d[i] > mx) mx = d[i];
    if (mx > 0) for (let i = 0; i < COLS; i++) d[i] /= mx;
    return d;
  }

  /* 在有序 boundaries 中找 start 的吸附点（<= start 的最后一个；若都大于则取第一个） */
  function snapTo(boundaries, t){
    if (!boundaries || !boundaries.length) return t;
    let best = boundaries[0];
    for (const b of boundaries){ if (b <= t + 1e-9) best = b; else break; }
    return best;
  }

  /* 终点吸附：<= t 的最后一个边界（不超过所选终点） */
  function snapEndTo(boundaries, t){
    if (!boundaries || !boundaries.length) return t;
    let best = boundaries[0];
    for (const b of boundaries){ if (b <= t + 1e-9) best = b; else break; }
    return best;
  }

  return { u32, u16, u24, i16, i16le, i32, u64, fcc, w32, w16, setType, u32le, u16le, w32le, w64le, COLS, buildDensity, snapTo, snapEndTo };
});
