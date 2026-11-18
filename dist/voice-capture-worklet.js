// Local microphone PCM only; never sends audio to the network.
class LevoVoiceCapture extends AudioWorkletProcessor{
  constructor(){super();this.samples=new Float32Array(2048);this.used=0;this.port.onmessage=e=>{if(e.data==='flush'){this.flush();this.port.postMessage({type:'flushed'});}};}
  flush(){if(this.used){const data=this.samples.slice(0,this.used);this.port.postMessage({type:'samples',data},[data.buffer]);this.used=0;}}
  process(inputs){const channels=inputs[0];if(!channels?.length)return true;let best=channels[0],power=-1;for(const ch of channels){let n=0;for(const x of ch)n+=x*x;if(n>power){best=ch;power=n;}}for(const x of best){this.samples[this.used++]=x;if(this.used===this.samples.length)this.flush();}return true;}
}
registerProcessor('levo-voice-capture',LevoVoiceCapture);
