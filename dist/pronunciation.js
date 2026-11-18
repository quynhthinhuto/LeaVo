'use strict';
// Decode our known PCM samples ourselves: no browser codec or range-request dependency.
const audioPlayback={context:null,source:null,request:0,word:null,cache:new Map(),abort:null,timer:null,nativeURL:null};
const pronunciationElement=id=>document.getElementById(id);
const pronunciationTerm=value=>value.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
const pronunciationOrigin=()=>location.protocol==='file:'?'https://lexilab-stem-vn-qn16.quynhthinhuto.chatgpt.site':'';
function pronunciationURL(word,legacy=false){const key=PRONUNCIATION_AUDIO[pronunciationTerm(word.en)];return key?pronunciationOrigin()+'/audio/v'+(legacy?'1/':'2/')+key+(legacy?'.m4a':'.wav'):'';}
function audioSessionPlayback(){try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}}
function unlockWordAudio(){
  audioSessionPlayback();const Constructor=window.AudioContext||window.webkitAudioContext;
  try{if(Constructor&&(!audioPlayback.context||audioPlayback.context.state==='closed'))audioPlayback.context=new Constructor();const c=audioPlayback.context;if(c&&c.state!=='running')c.resume().catch(()=>{});if(c&&!c.levoUnlocked){const s=c.createBufferSource();s.buffer=c.createBuffer(1,1,c.sampleRate);s.connect(c.destination);s.start(0);c.levoUnlocked=true;}}catch{}
  return audioPlayback.context;
}
function stopAudioBuffer(){if(audioPlayback.source){try{audioPlayback.source.onended=null;audioPlayback.source.stop();}catch{}audioPlayback.source=null;}}
function stopAllAudio(){audioPlayback.request++;clearTimeout(audioPlayback.timer);audioPlayback.abort?.abort();stopAudioBuffer();for(const a of document.querySelectorAll('audio'))a.pause();if(audioPlayback.nativeURL){URL.revokeObjectURL(audioPlayback.nativeURL);audioPlayback.nativeURL=null;}}
function pronunciationStatus(text){const el=pronunciationElement('pronunciation-status');if(el)el.textContent=text;}
function playbackTargetStatus(audio,text){const local=audio.closest?.('.study-audio,.speaking-reference')?.querySelector('.audio-status');if(local)local.textContent=text;if(audio.id==='pronunciation-audio')pronunciationStatus(text);}
function decodePronunciationPCM(bytes,context){
  const v=new DataView(bytes),tag=(at,n)=>String.fromCharCode(...new Uint8Array(bytes,at,n));
  if(v.byteLength<44||tag(0,4)!=='RIFF'||tag(8,4)!=='WAVE')throw new Error('Invalid audio file');
  let fmt=null,data=null,at=12;
  while(at+8<=v.byteLength){const size=v.getUint32(at+4,true),start=at+8;if(start+size>v.byteLength)throw new Error('Incomplete audio file');const name=tag(at,4);if(name==='fmt '&&size>=16)fmt={kind:v.getUint16(start,true),channels:v.getUint16(start+2,true),rate:v.getUint32(start+4,true),bits:v.getUint16(start+14,true)};if(name==='data')data={start,size};at=start+size+(size%2);}
  if(!fmt||!data||fmt.kind!==1||fmt.bits!==16||fmt.channels<1||fmt.channels>2||fmt.rate<8000||fmt.rate>96000||data.size%(fmt.channels*2))throw new Error('Unsupported audio file');
  const frames=data.size/(fmt.channels*2);if(!frames||frames/fmt.rate>30)throw new Error('Invalid audio duration');
  const buffer=context.createBuffer(fmt.channels,frames,fmt.rate);let power=0;
  for(let c=0;c<fmt.channels;c++){const samples=buffer.getChannelData(c);for(let i=0;i<frames;i++){const x=v.getInt16(data.start+(i*fmt.channels+c)*2,true)/32768;samples[i]=x;power+=x*x;}}
  if(Math.sqrt(power/(frames*fmt.channels))<.0001)throw new Error('No audio signal');return buffer;
}
async function downloadPronunciation(url,signal){const r=await fetch(url,{signal,credentials:'omit',cache:'reload'});if(!r.ok)throw new Error('Audio download failed ('+r.status+')');return r;}
async function decodedWordAudio(url,signal){if(audioPlayback.cache.has(url))return audioPlayback.cache.get(url);const context=audioPlayback.context||unlockWordAudio();if(!context)throw new Error('Audio engine unavailable');const r=await downloadPronunciation(url,signal),buffer=decodePronunciationPCM(await r.arrayBuffer(),context);if(audioPlayback.cache.size>=8)audioPlayback.cache.delete(audioPlayback.cache.keys().next().value);audioPlayback.cache.set(url,buffer);return buffer;}
async function playWordBuffer(word,audio,request){
  const context=audioPlayback.context||unlockWordAudio();if(!context)throw new Error('Audio engine unavailable');
  if(context.state!=='running')await context.resume();
  const buffer=await decodedWordAudio(pronunciationURL(word),audioPlayback.abort.signal);if(request!==audioPlayback.request)return;
  stopAudioBuffer();audio.hidden=true;const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);audioPlayback.source=source;
  source.onended=()=>{if(request===audioPlayback.request){audioPlayback.source=null;playbackTargetStatus(audio,'Finished / Đã phát xong · '+buffer.duration.toFixed(1)+'s');}};
  source.start(0);playbackTargetStatus(audio,'Playing / Đang phát · '+buffer.duration.toFixed(1)+'s');
}
async function playNativePronunciation(word,audio,request){
  // Fetch the complete AAC file and play a local Blob, avoiding browser range probes.
  const r=await downloadPronunciation(pronunciationURL(word,true),audioPlayback.abort.signal),blob=await r.blob();if(request!==audioPlayback.request)return;
  audioPlayback.nativeURL=URL.createObjectURL(blob);audio.src=audioPlayback.nativeURL;audio.hidden=false;audio.muted=false;audio.volume=1;audio.load();
  audio.onplaying=()=>{if(request===audioPlayback.request)playbackTargetStatus(audio,'Playing / Đang phát');};audio.onended=()=>{if(request===audioPlayback.request)playbackTargetStatus(audio,'Finished / Đã phát xong');};
  audio.onerror=()=>{if(request===audioPlayback.request)playbackTargetStatus(audio,'The alternate player could not play. Use Open audio. / Trình phát khác chưa hoạt động. Hãy chọn Mở âm thanh.');};
  try{await audio.play();}catch{playbackTargetStatus(audio,'Press Play on the audio bar. / Bấm nút Play trên thanh âm thanh.');}
}
function playWordAudio(word,audio,native=false){
  if(!word||!audio)return;stopAllAudio();audioPlayback.word=word;const request=audioPlayback.request;audioPlayback.abort=new AbortController();unlockWordAudio();
  playbackTargetStatus(audio,'Loading audio… / Đang tải âm thanh…');
  const failure=e=>{if(request!==audioPlayback.request||e.name==='AbortError')return;playbackTargetStatus(audio,'Audio could not load. Try Open audio or reload this page. / Chưa tải được âm thanh. Thử Mở âm thanh hoặc tải lại trang.');};
  if(native){playNativePronunciation(word,audio,request).catch(failure);return;}
  playWordBuffer(word,audio,request).catch(e=>{if(request!==audioPlayback.request||e.name==='AbortError')return;playbackTargetStatus(audio,'Trying another player… / Đang thử trình phát khác…');playNativePronunciation(word,audio,request).catch(failure);});
}
function playPronunciation(id){const word=byId(id);if(!word)return;pronunciationElement('pronunciation-player').hidden=false;pronunciationElement('pronunciation-word').textContent=word.en;pronunciationElement('pronunciation-meaning').textContent=word.vi;pronunciationElement('pronunciation-open').href=pronunciationURL(word,true);document.querySelector('#modal-root .modal')?.setAttribute('aria-modal','false');playWordAudio(word,pronunciationElement('pronunciation-audio'));}
function closePronunciation(){stopAllAudio();pronunciationElement('pronunciation-player').hidden=true;document.querySelector('#modal-root .modal')?.setAttribute('aria-modal','true');}
window.LexiAudio={url:pronunciationURL,play:playWordAudio,stop:stopAllAudio,unlock:unlockWordAudio};
document.addEventListener('pointerdown',e=>{if(e.target.closest('audio,[data-action="speak"],[data-action="listen-inline"],[data-action="audio-replay"],[data-action="audio-alternate"],[data-action="speaking-listen"]'))unlockWordAudio();},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='audio-replay'||a==='audio-alternate')playWordAudio(audioPlayback.word,pronunciationElement('pronunciation-audio'),a==='audio-alternate');if(a==='audio-close')closePronunciation();if(a==='listen-inline')playWordAudio(byId(b.dataset.word),b.closest('.study-audio')?.querySelector('audio'));});
document.addEventListener('play',e=>{if(e.target.tagName!=='AUDIO')return;audioSessionPlayback();stopAudioBuffer();for(const other of document.querySelectorAll('audio'))if(other!==e.target)other.pause();},true);
window.addEventListener('pagehide',stopAllAudio);
