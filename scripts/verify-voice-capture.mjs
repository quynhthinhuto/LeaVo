import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Run the actual audio-thread processor. Opposite-phase stereo must not cancel speech.
const messages=[];let Processor;
class WorkletBase{constructor(){this.port={postMessage:m=>messages.push(m)};}}
const worklet=vm.createContext({AudioWorkletProcessor:WorkletBase,registerProcessor:(name,type)=>{assert.equal(name,'levo-voice-capture');Processor=type;},Float32Array});
vm.runInContext(readFileSync('dist/voice-capture-worklet.js','utf8'),worklet);
const processor=new Processor(),left=new Float32Array(128).fill(.01),right=new Float32Array(128).fill(-.01);
for(let i=0;i<17;i++)processor.process([[left,right]]);
processor.port.onmessage({data:'flush'});
const captured=messages.filter(m=>m.type==='samples').flatMap(m=>Array.from(m.data));
assert.equal(captured.length,2176,'Flush keeps the last partial frame');assert.ok(captured.every(x=>x>.009),'Stereo phase does not cancel voice');assert.equal(messages.at(-1).type,'flushed');
// Older Safari fallback captures PCM and never routes the live microphone to speakers.
let audioNode,gain,disconnected=0;
const context={sampleRate:48000,destination:{},resume:async()=>{},createMediaStreamSource:()=>({connect(){},disconnect(){disconnected++;}}),createGain:()=>{gain={gain:{value:1},connect(){},disconnect(){disconnected++;}};return gain;},createScriptProcessor:()=>{audioNode={connect(){},disconnect(){disconnected++;}};return audioNode;}};
let level=0;const browser=vm.createContext({window:{},Float32Array,WeakMap,URL,setTimeout,clearTimeout});
vm.runInContext(readFileSync('dist/voice-recorder.js','utf8'),browser);browser.testContext=context;browser.onLevel=x=>level=x;
const recorder=await vm.runInContext('createVoiceRecorder({},testContext,onLevel)',browser);
const samples=new Float32Array(2048).fill(.002);audioNode.onaudioprocess({inputBuffer:{getChannelData:()=>samples}});
assert.equal(gain.gain.value,0,'No microphone echo to the speakers');assert.ok(level>.0019);
const recording=await recorder.stop();assert.equal(recording.length,2048);assert.ok(disconnected===3);assert.ok(recording.getChannelData(0)[0]>.0019);
// A quiet spoken word within a long recording is trimmed and normalised; silence stays rejected.
const signal=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,window:{addEventListener(){}},document:{addEventListener(){}},Float32Array,ArrayBuffer,DataView});
vm.runInContext(readFileSync('dist/speaking.js','utf8'),signal);
const quiet=new Float32Array(160000);for(let i=40000;i<56000;i++)quiet[i]=Math.sin(i*.13)*.003;
signal.quiet={numberOfChannels:1,length:quiet.length,sampleRate:16000,duration:10,getChannelData:()=>quiet};
const pcm=vm.runInContext('prepareVoicePCM(quiet)',signal);assert.ok(pcm.duration<2&&pcm.duration>1);signal.pcm=pcm;
const wav=vm.runInContext('speakingWav(pcm)',signal);assert.ok(wav.rms>.01&&wav.peak>.04,'A quiet real signal passes the server thresholds');assert.equal(new DataView(wav.bytes.buffer).getUint32(24,true),16000);
signal.silence={...signal.quiet,getChannelData:()=>new Float32Array(160000)};assert.throws(()=>vm.runInContext('prepareVoicePCM(silence)',signal),/No microphone signal/);
console.log('PASS: real worklet PCM capture and final-frame flush; stereo safety; old-browser fallback; live input level; no mic-to-speaker echo; quiet speech normalisation and silence rejection.');
