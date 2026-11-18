"""Create standard PCM WAV clips with measured signal and audible headroom."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import array, hashlib, json, math, struct, subprocess, wave

root=Path(__file__).resolve().parent.parent
source=root/'.local/pronunciations'
target=root/'.local/pronunciations-v2'
target.mkdir(parents=True,exist_ok=True)
manifest=json.loads((source/'manifest.json').read_text())

def convert(entry):
    key=entry['key']; raw=target/(key+'.raw.wav'); out=target/(key+'.wav')
    subprocess.run(['/usr/bin/afconvert','-f','WAVE','-d','LEI16',str(source/(key+'.m4a')),str(raw)],check=True,capture_output=True)
    b=raw.read_bytes(); offset=12; chunks={}
    while offset+8<=len(b):
        name=b[offset:offset+4]; size=struct.unpack_from('<I',b,offset+4)[0]
        chunks[name]=b[offset+8:offset+8+size]; offset+=8+size+(size%2)
    fmt=chunks[b'fmt ']; tag,channels,rate=struct.unpack_from('<HHI',fmt)
    bits=struct.unpack_from('<H',fmt,14)[0]
    if tag not in (1,65534) or channels!=1 or bits!=16: raise ValueError('Unexpected audio format')
    samples=array.array('h',chunks[b'data'])
    if len(samples)<rate*.15: raise ValueError('Empty or truncated voice: '+entry['en'])
    centre=sum(samples)/len(samples); values=[x-centre for x in samples]
    peak=max(map(abs,values)); rms=math.sqrt(sum(x*x for x in values)/len(values))
    if peak<2000 or rms<150: raise ValueError('Silent or too quiet: '+entry['en'])
    gain=min(3,5000/rms,30000/peak)
    voice=array.array('h',(round(max(-32768,min(32767,x*gain))) for x in values))
    audio=array.array('h',[0]*round(rate*.08)); audio.extend(voice)
    audio.extend([0]*max(round(rate*.2),round(rate*1.3)-len(audio)))
    with wave.open(str(out),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(audio.tobytes())
    raw.unlink()
    return {**entry,'seconds':round(len(audio)/rate,3),'peak':max(map(abs,audio)),'rms':round(math.sqrt(sum(x*x for x in audio)/len(audio)),1),'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}

results=[]
with ThreadPoolExecutor(max_workers=6) as pool:
    for i,result in enumerate(pool.map(convert,manifest['entries']),1):
        results.append(result)
        if i%200==0 or i==len(manifest['entries']): print(f'PCM audio: {i}/{len(manifest["entries"])}',flush=True)
(target/'manifest.json').write_text(json.dumps({'version':2,'format':'wav','voice':manifest['voice'],'rate':manifest['rate'],'entries':results},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'clips':len(results),'minimum_rms':min(x['rms'] for x in results),'minimum_seconds':min(x['seconds'] for x in results),'bytes':sum((target/(x['key']+'.wav')).stat().st_size for x in results)}))
