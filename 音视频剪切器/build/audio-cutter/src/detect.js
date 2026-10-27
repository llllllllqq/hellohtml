/* =====================================================================
 *  detect.js — 音频格式探测（魔术字 + 扩展名兜底）
 * ===================================================================== */
(function(root, factory){
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACDetect = api;
})(typeof self !== 'undefined' ? self : globalThis, function(){
  'use strict';

  /* 返回 'WAV' | 'MP3' | 'M4A' | 'FLAC' | 'OGG' | null */
  function detect(buf, fileName){
    const b = new Uint8Array(buf);
    const ext = (fileName || '').split('.').pop().toLowerCase();

    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&   // RIFF
        b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'WAV';        // WAVE
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x46 && b[2] === 0x36 && b[3] === 0x34 &&   // RF64
        b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'WAV';
    if (b.length >= 4 && b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'FLAC';  // fLaC
    if (b.length >= 4 && b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'OGG';   // OggS
    if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33){                      // ID3v2 前缀
      // 跳过 ID3 标签再看真实容器（部分工具会给 FLAC/OGG 也加 ID3）
      const sz = ((b[6] & 0x7F) << 21) | ((b[7] & 0x7F) << 14) | ((b[8] & 0x7F) << 7) | (b[9] & 0x7F);
      const p = 10 + sz + ((b[5] & 0x10) ? 10 : 0);
      if (b.length > p + 4){
        if (b[p] === 0x66 && b[p+1] === 0x4C && b[p+2] === 0x61 && b[p+3] === 0x43) return 'FLAC';
        if (b[p] === 0x4F && b[p+1] === 0x67 && b[p+2] === 0x67 && b[p+3] === 0x53) return 'OGG';
        if ((b[p] === 0x52 && b[p+1] === 0x49 && b[p+2] === 0x46 && b[p+3] === 0x46) ||
            (b[p] === 0x52 && b[p+1] === 0x46 && b[p+2] === 0x36 && b[p+3] === 0x34)) return 'WAV';
        if (b.length > p + 8 && b[p+4] === 0x66 && b[p+5] === 0x74 && b[p+6] === 0x79 && b[p+7] === 0x70) return 'M4A';
      }
      return 'MP3';
    }
    if (b.length >= 2 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0 && (b[1] & 0x06) === 0x02) return 'MP3';  // 帧同步（Layer III）
    if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'M4A';  // ftyp

    // 魔术字失败时按扩展名兜底
    if (['wav', 'wave'].includes(ext)) return 'WAV';
    if (['mp3', 'mp2', 'mpga'].includes(ext)) return 'MP3';
    if (['m4a', 'm4b', 'mp4a', 'aac'].includes(ext)) return 'M4A';
    if (['flac'].includes(ext)) return 'FLAC';
    if (['ogg', 'oga', 'opus'].includes(ext)) return 'OGG';
    return null;
  }

  return { detect };
});
