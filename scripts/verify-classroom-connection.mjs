import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const requests=[];
const c=vm.createContext({console,AbortController,URLSearchParams,setTimeout,clearTimeout,setInterval:()=>0,location:{search:''},localStorage:{getItem:()=>null},window:{addEventListener(){}},document:{addEventListener(){}},esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),icon:()=>'',state:{grade:8},fetch:async(...args)=>{requests.push(args);return Response.json({signedIn:true});}});
vm.runInContext(readFileSync('dist/classroom.js','utf8'),c);
const call=(path='/api/me')=>vm.runInContext('classAPI('+JSON.stringify(path)+')',c);
assert.equal((await call()).signedIn,true);assert.equal(requests[0][1].cache,'no-store');assert.equal(requests[0][1].credentials,'same-origin');
c.fetch=async()=>Response.json({id:'created-class',join_code:'DEMOABCD'},{status:201});assert.equal((await vm.runInContext('classAPI("/api/classes",{method:"POST",body:JSON.stringify({name:"8A",grade:8})})',c)).id,'created-class','Creating a class is accepted without a class-list payload');
async function failure(response,path='/api/me'){
  c.fetch=async()=>response;try{await call(path);assert.fail('Expected a connection error');}catch(e){assert.equal(e.kind,'connection');c.error=e;vm.runInContext("classUI.role='teacher';classUI.error=classError(error)",c);return vm.runInContext('classErrorNotice()',c);}
}
let html=await failure(new Response('<!doctype html><script>private-challenge-content</script>',{headers:{'content-type':'text/html'}}));
assert.match(html,/Open Classroom/);assert.match(html,/https:\/\/lexilab-stem-vn-qn16\.quynhthinhuto\.chatgpt\.site\/\?classroom=teacher/);assert.match(html,/target="_top"/);assert.ok(!html.includes('private-challenge-content'),'Never show raw HTML or challenge contents');
assert.match(await failure(new Response('<html>maintenance</html>',{status:503})),/HTTP 503/);
await failure(Response.json({}));await failure(new Response('{incomplete'));
await failure(Response.json({classes:{}}),'/api/classes');
for(const response of [new Response('<html>sign in</html>',{status:401}),{status:200,ok:true,redirected:true,text:async()=>'<html>sign in</html>'}]){
  c.fetch=async()=>response;await assert.rejects(call(),e=>e.status===401);assert.equal(vm.runInContext('classUI.signedIn',c),false);assert.match(vm.runInContext('renderTeacher()',c),/signin-with-chatgpt\?return_to=/);
}
c.fetch=async()=>{throw new TypeError('Load failed');};await assert.rejects(call(),e=>e.kind==='connection'&&e.message.includes('online app'));
c.setTimeout=fn=>{fn();return 0;};c.clearTimeout=()=>{};c.fetch=async(_url,options)=>{assert.equal(options.signal.aborted,true);throw Object.assign(new Error('aborted'),{name:'AbortError'});};
await assert.rejects(call(),e=>e.kind==='connection'&&e.message.includes('took too long'));
console.log('PASS: HTML/static-preview responses; expired login and login redirects; server downtime; invalid payloads; network failure and timeout; safe recovery links; fresh identity checks; no raw response leakage.');
