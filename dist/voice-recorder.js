'use strict';
const voiceWorklets=new WeakMap();
async function createVoiceRecorder(stream,context,onLevel){
  const chunks=[];let length=0,node,flushed=null,closed=false;const source=context.createMediaStreamSource(stream),quiet=context.createGain();quiet.gain.value=0;
  const receive=data=>{if(closed||!data?.length)return;if(length>context.sampleRate*12)return;chunks.push(data);length+=data.length;let sum=0;for(const x of data)sum+=x*x;onLevel(Math.sqrt(sum/data.length));};
  try{
    if(context.audioWorklet&&window.AudioWorkletNode){
      if(!voiceWorklets.has(context))voiceWorklets.set(context,context.audioWorklet.addModule(new URL('voice-capture-worklet.js?v=20261118-pcm1',document.baseURI)));
      await voiceWorklets.get(context);node=new AudioWorkletNode(context,'levo-voice-capture');node.port.onmessage=e=>{if(e.data.type==='samples')receive(e.data.data);if(e.data.type==='flushed')flushed?.();};
    }
  }catch{node=null;}
  if(!node){if(!context.createScriptProcessor)throw new Error('PCM recording is unavailable');node=context.createScriptProcessor(2048,1,1);node.onaudioprocess=e=>receive(new Float32Array(e.inputBuffer.getChannelData(0)));}
  const disconnect=()=>{closed=true;try{source.disconnect();node.disconnect();quiet.disconnect();}catch{}if(node.port)node.port.onmessage=null;node.onaudioprocess=null;};
  source.connect(node);node.connect(quiet);quiet.connect(context.destination);try{await context.resume();}catch(e){disconnect();throw e;}
  return {state:'recording',cancel(){this.state='inactive';disconnect();},async stop(){
    if(this.state!=='recording')return null;this.state='inactive';
    if(node.port)await new Promise(resolve=>{const timeout=setTimeout(resolve,400);flushed=()=>{clearTimeout(timeout);resolve();};node.port.postMessage('flush');});
    disconnect();const samples=new Float32Array(length);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
    return {numberOfChannels:1,length,sampleRate:context.sampleRate,duration:length/context.sampleRate,getChannelData:()=>samples};
  }};
}
