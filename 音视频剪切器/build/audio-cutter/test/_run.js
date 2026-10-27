
const fs=require('fs');
const W=require('/root/.codebuddy/artifact/audio-cutter/src/wav.js'), M=require('/root/.codebuddy/artifact/audio-cutter/src/mp3.js'), A=require('/root/.codebuddy/artifact/audio-cutter/src/m4a.js'),
      F=require('/root/.codebuddy/artifact/audio-cutter/src/flac.js'), O=require('/root/.codebuddy/artifact/audio-cutter/src/ogg.js'), D=require('/root/.codebuddy/artifact/audio-cutter/src/detect.js');
const P={WAV:W,MP3:M,M4A:A,FLAC:F,OGG:O};
const [file, s, e, outName, mode]=process.argv.slice(2);
const b=new Uint8Array(fs.readFileSync(file));
if(mode==='parse'){
  const fmt=D.detect(b.buffer, file);
  if(!fmt){ console.log(JSON.stringify({error:'detect failed'})); process.exit(2); }
  let info;
  try{ info=P[fmt].parse(b); }catch(err){ console.log(JSON.stringify({error:'parse: '+err.message})); process.exit(3); }
  console.log(JSON.stringify({fmt, duration:info.duration, sampleRate:info.sampleRate,
    channels:info.channels, codec:info.codec, boundaries:info.boundaries.length}));
  process.exit(0);
}
// cut 模式
const fmt=D.detect(b.buffer, file);
if(!fmt){ console.log(JSON.stringify({error:'detect failed'})); process.exit(2); }
let info;
try{ info=P[fmt].parse(b); }catch(err){ console.log(JSON.stringify({error:'parse: '+err.message})); process.exit(3); }
let res;
try{ res=P[fmt].cut(b, info, parseFloat(s), parseFloat(e)); }
catch(err){ console.log(JSON.stringify({error:'cut: '+err.message})); process.exit(4); }
const parts=res.parts;
const total=parts.reduce((a,p)=>a+p.length,0);
const out=Buffer.allocUnsafe(total);
let o=0; for(const p of parts){ out.set(Buffer.from(p.buffer,p.byteOffset,p.length), o); o+=p.length; }
fs.writeFileSync(outName, out);
console.log(JSON.stringify({fmt, t0:res.t0, t1:res.t1, outSize:total, parts:parts.length,
  sampleRate:info.sampleRate, channels:info.channels, codec:info.codec, duration:info.duration}));
