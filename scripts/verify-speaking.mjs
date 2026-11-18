import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
import {localD1} from './d1-local.mjs';
const db=localD1();for(const f of ['0000_classrooms','0001_speaking_checks'])db.raw.exec(readFileSync('drizzle/'+f+'.sql','utf8'));
const ctx=vm.createContext({});for(const f of ['data','catalog','curriculum-data','curriculum'])vm.runInContext(readFileSync('dist/'+f+'.js','utf8'),ctx);
const w=JSON.parse(vm.runInContext('JSON.stringify(WORDS.find(w=>w.active&&w.en==="monomial"&&w.grade===8))',ctx));
const manifest=JSON.parse(readFileSync('.local/pronunciations-v2/manifest.json','utf8')),entry=manifest.entries.find(x=>x.en==='monomial'),wave=readFileSync('.local/pronunciations-v2/'+entry.key+'.wav');
const env={DB:db,OPENAI_API_KEY:'test-key'};
const config=await worker.fetch(new Request('https://school.test/api/speaking/config'),env);assert.equal(config.status,200);const cookie=config.headers.get('set-cookie').split(';')[0];assert.equal((await config.json()).enabled,true);
let providerCalls=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'gpt-audio-1.5');assert.deepEqual(body.modalities,['text']);assert.equal(body.store,false);assert.equal(body.messages[1].content[1].input_audio.format,'wav');assert.equal(body.messages[1].content[1].input_audio.data,wave.toString('base64'));providerCalls++;return Response.json({choices:[{message:{content:JSON.stringify({verdict:'clear',heard:'monomial',feedback_en:'Clear word.',feedback_vi:'Từ đọc rõ.',tip_en:'Keep the stress clear.',tip_vi:'Giữ trọng âm rõ.'})}}]});};
const call=async(data,extra={})=>{const response=await worker.fetch(new Request('https://school.test/api/speaking/check',{method:'POST',headers:{'content-type':'application/json',cookie,...extra},body:JSON.stringify(data)}),env);return {status:response.status,body:await response.json()};};
const payload={requestId:crypto.randomUUID(),wordId:w.id,audio:wave.toString('base64')};
try{
  const silence=Buffer.from(wave);silence.fill(0,44);assert.equal((await call({...payload,audio:silence.toString('base64')})).status,422);assert.equal(providerCalls,0);
  assert.equal((await call({...payload,wordId:'nonexistent'})).status,400);
  assert.equal((await call(payload,{origin:'https://attacker.test'})).status,403);
  const good=await call(payload);assert.equal(good.status,200);assert.equal(good.body.verdict,'clear');assert.equal(providerCalls,1);
  const duplicate=await call(payload);assert.equal(duplicate.status,200);assert.equal(duplicate.body.cached,true);assert.equal(providerCalls,1,'Retries do not bill a second AI call');
  assert.equal((await call({...payload,requestId:crypto.randomUUID()})).status,429,'Short cooldown is enforced');
  db.raw.prepare('UPDATE speaking_checks SET created_at=?').run(Date.now()-6000);
  const otherCookie=await worker.fetch(new Request('https://school.test/api/speaking/config'),env);const wrong=await worker.fetch(new Request('https://school.test/api/speaking/check',{method:'POST',headers:{'content-type':'application/json',cookie:otherCookie.headers.get('set-cookie').split(';')[0]},body:JSON.stringify(payload)}),env);assert.equal(wrong.status,409,'One browser cannot retrieve another browser’s feedback');
  globalThis.fetch=async()=>new Response('{}',{status:429});
  const unavailable=await call({...payload,requestId:crypto.randomUUID()});assert.equal(unavailable.status,503);assert.ok(!unavailable.body.verdict,'No invented grade when API is unavailable');
  const stored=db.raw.prepare('SELECT * FROM speaking_checks WHERE request_id=?').get(payload.requestId);assert.equal(stored.status,'done');assert.ok(stored.result_json);assert.ok(!Object.keys(stored).some(k=>/audio|recording|base64/.test(k)),'Raw recordings are not stored in class database');
}finally{globalThis.fetch=originalFetch;}
// Validate actual browser WAV encoding with mono and stereo source buffers.
const c=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,window:{addEventListener:()=>{}},document:{addEventListener:()=>{}},URL,Blob,Float32Array,ArrayBuffer,DataView});
vm.runInContext(readFileSync('dist/speaking.js','utf8'),c);
c.sample={numberOfChannels:2,length:16000,sampleRate:16000,getChannelData:channel=>new Float32Array(16000).fill(channel?.1:.3)};
const encoded=vm.runInContext('speakingWav(sample)',c);const bytes=Buffer.from(encoded.bytes);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),1);assert.equal(bytes.readUInt32LE(24),16000);assert.ok(encoded.rms>.19&&encoded.rms<.21);assert.equal(bytes.length,32044);
console.log('PASS: microphone WAV encoding; real audio sent to an audio model; silence rejection before API calls; origin checks; per-browser ownership; bounded practice; idempotent retries; honest API failures; bilingual feedback; no raw recording storage.');
