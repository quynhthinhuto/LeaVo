import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
import {localAudioBucket} from './r2-local.mjs';
const manifest=JSON.parse(readFileSync('.local/pronunciations-v2/manifest.json','utf8'));
assert.equal(manifest.entries.length,1772);
const c=vm.createContext({});for(const f of ['data','catalog','curriculum-data','curriculum','audio-manifest'])vm.runInContext(readFileSync('dist/'+f+'.js','utf8'),c);
assert.equal(vm.runInContext('WORDS.filter(w=>!PRONUNCIATION_AUDIO[w.en.normalize("NFC").trim().replace(/\\s+/g," ").toLowerCase()]).length',c),0);
for(const e of manifest.entries){const b=readFileSync('.local/pronunciations-v2/'+e.key+'.wav');assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');assert.equal(b.readUInt16LE(20),1);assert.equal(b.readUInt16LE(22),1);assert.equal(b.readUInt16LE(34),16);assert.ok(e.seconds>=1.3);assert.ok(e.rms>1000);assert.ok(e.peak<=30001&&e.peak>6000);}
const first=manifest.entries[0],path='/audio/v2/'+first.key+'.wav',bucket=localAudioBucket('.local/pronunciations');
const call=(options={},env={BUCKET:bucket})=>worker.fetch(new Request('https://school.test'+path,options),env);
const response=await call();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');const clip=Buffer.from(await response.arrayBuffer());
for(const [range,start,length] of [['bytes=0-1',0,2],['bytes=2-',2,clip.length-2],['bytes=-100',clip.length-100,100]]){const r=await call({headers:{range}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes ${start}-${start+length-1}/${clip.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),clip.subarray(start,start+length));}
assert.equal((await call({headers:{range:'bytes=99999999-'}})).status,416);assert.equal((await call({headers:{'if-none-match':response.headers.get('etag')}})).status,304);const head=await call({method:'HEAD'});assert.equal(head.headers.get('content-length'),String(clip.length));assert.equal((await head.arrayBuffer()).byteLength,0);
const testBucket=localAudioBucket(mkdtempSync(join(tmpdir(),'levo-audio-'))),url='https://school.test/internal/audio/v2/'+first.key;
assert.equal((await worker.fetch(new Request(url,{method:'PUT',body:clip}),{BUCKET:testBucket})).status,403);
const uploaded=await worker.fetch(new Request(url,{method:'PUT',headers:{authorization:'Bearer test-secret'},body:clip}),{BUCKET:testBucket,PRONUNCIATION_UPLOAD_KEY:'test-secret'});assert.equal(uploaded.status,201);

const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{id,hidden:true,textContent:'',src:'',paused:true,currentTime:0,playCalls:0,pause(){this.paused=true;},load(){},play(){this.playCalls++;this.paused=false;return Promise.resolve();},getAttribute(name){return this[name]||null;},closest(){return null;},setAttribute(name,value){this[name]=value;}});return elements.get(id);}
let buffersStarted=0,codecCalls=0;
class Context{constructor(){this.state='running';this.sampleRate=48000;this.destination={};}resume(){return Promise.resolve();}createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,getChannelData:c=>data[c]};}decodeAudioData(){codecCalls++;throw Error('Simulated Safari decoder failure');}createBufferSource(){return {connect(){},start(){buffersStarted++;},stop(){}};}}
const raw=clip.buffer.slice(clip.byteOffset,clip.byteOffset+clip.byteLength),fetchOptions=[];
const test=vm.createContext({PRONUNCIATION_AUDIO:{gravity:'123456789012345678901234'},byId:()=>({en:'gravity',vi:'trọng lực'}),location:{protocol:'https:'},AbortController,URL,fetch:async(url,options)=>{fetchOptions.push(options);return {ok:true,arrayBuffer:async()=>raw,blob:async()=>new Blob([clip],{type:'audio/mp4'})};},navigator:{audioSession:{}},window:{AudioContext:Context,addEventListener:()=>{}},document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[el('pronunciation-audio')],addEventListener:()=>{}},setTimeout:()=>1,clearTimeout:()=>{}});
vm.runInContext(readFileSync('dist/pronunciation.js','utf8'),test);
vm.runInContext('playPronunciation("word")',test);await new Promise(resolve=>setImmediate(resolve));
assert.equal(el('pronunciation-audio').playCalls,0,'The primary player bypasses HTML media codecs');assert.equal(buffersStarted,2,'Unlock pulse plus real PCM buffer');assert.equal(codecCalls,0,'Even a failing Safari codec is never invoked');assert.equal(fetchOptions[0].credentials,'omit');assert.equal(el('pronunciation-audio').hidden,true);assert.match(el('pronunciation-status').textContent,/Playing/);
const decoded=vm.runInContext('audioPlayback.cache.values().next().value',test);assert.ok(decoded.duration>=1.3);assert.ok(decoded.getChannelData(0).some(x=>Math.abs(x)>.1));
assert.throws(()=>vm.runInContext('decodePronunciationPCM(new ArrayBuffer(44),audioPlayback.context)',test),/Invalid audio/);
vm.runInContext('closePronunciation()',test);assert.equal(el('pronunciation-player').hidden,true);
console.log('PASS: all 1772 PCM clips; full/range/HEAD; protected uploads; actual PCM samples played without HTML or Web Audio codecs, including a simulated Safari decoder failure.');
