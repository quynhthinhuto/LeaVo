import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
import {localD1} from './d1-local.mjs';
const db=localD1();
for(const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json')).entries)db.raw.exec(readFileSync('drizzle/'+entry.tag+'.sql','utf8'));
const ctx=vm.createContext({});for(const f of ['data','catalog','curriculum-data','curriculum'])vm.runInContext(readFileSync('dist/'+f+'.js','utf8'),ctx);
const vocabulary=JSON.parse(vm.runInContext('JSON.stringify({words:WORDS,lessons:LESSONS,subjects:SUBJECTS})',ctx));
const monomial=vocabulary.words.find(w=>w.active&&w.en==='monomial'&&w.grade===8),polynomial=vocabulary.words.find(w=>w.active&&w.en==='polynomial'&&w.grade===8);
const call=async(path,{owner,token,data}={})=>{const response=await worker.fetch(new Request('https://school.example'+path,{method:data?'POST':'GET',headers:{...(owner?{'oai-authenticated-user-id':owner}:{}),...(token?{authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{DB:db,OPENAI_API_KEY:'test-key'});return {status:response.status,body:await response.json()};};
const makeClass=async(owner,name)=>(await call('/api/classes',{owner,data:{name,grade:8}})).body;
const aClass=await makeClass('teacher-a','Speaking class'),otherClass=await makeClass('teacher-b','Other class'),secondClass=await makeClass('teacher-a','Second class');
const join=async(c,name)=>(await call('/api/join',{data:{code:c.join_code,name}})).body;
const an=await join(aClass,'An <script>'),binh=await join(aClass,'Bình'),empty=await join(aClass,'No checks'),other=await join(otherClass,'Other student'),second=await join(secondClass,'Second student');
const feedback=verdict=>({verdict,heard:'monomial',feedback_en:'Practice feedback <script>not HTML</script>',feedback_vi:'Nhận xét thử nghiệm.',tip_en:'Say it again.',tip_vi:'Hãy đọc lại.'});
let sequence=0;const base=Date.now()-10000000;
function fixture(student,word,verdict='clear',status='done',raw){
  db.raw.prepare('INSERT INTO speaking_checks(request_id,actor_hash,student_id,word_id,lesson_id,status,result_json,created_at,duration) VALUES(?,?,?,?,?,?,?,?,?)').run('fixture-'+String(++sequence).padStart(12,'0'),'fixture-actor',student?.student.id||null,word.id,word.lessonIds[0],status,raw??JSON.stringify(feedback(verdict)),base+sequence,1.3);
}
for(const verdict of ['clear','clear','nearly','practice','unclear'])fixture(an,monomial,verdict);
fixture(an,polynomial);
fixture(an,monomial,'clear','pending');fixture(an,monomial,'clear','error');
fixture(an,monomial,'clear','done','broken JSON');fixture(an,monomial,'unrecognised');
fixture(null,monomial);fixture(other,monomial);fixture(second,monomial);
// Exercise the real student-token save path and idempotent retries, without billing an API call.
const clip=JSON.parse(readFileSync('.local/pronunciations-v2/manifest.json')).entries.find(e=>e.en==='monomial');
const payload={requestId:crypto.randomUUID(),wordId:monomial.id,audio:readFileSync('.local/pronunciations-v2/'+clip.key+'.wav').toString('base64')};
const originalFetch=globalThis.fetch;let calls=0;
db.raw.prepare('UPDATE students SET last_seen=1 WHERE id=?').run(binh.student.id);
try{
  globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(feedback('clear'))}}]});};
  assert.equal((await call('/api/speaking/check',{token:binh.token,data:payload})).status,200);
  assert.equal((await call('/api/speaking/check',{token:binh.token,data:payload})).body.cached,true);
  assert.equal(calls,1,'A retry calls the provider once and counts once');
}finally{globalThis.fetch=originalFetch;}
assert.ok(db.raw.prepare('SELECT last_seen FROM students WHERE id=?').get(binh.student.id).last_seen>base);
const path='/api/classes/'+aClass.id;
for(const options of [{},{owner:'teacher-b'},{token:an.token}])assert.ok([401,404].includes((await call(path,options)).status));
assert.equal((await call(path+'/students/'+other.student.id,{owner:'teacher-a'})).status,404);
assert.equal((await call(path+'/students/'+second.student.id,{owner:'teacher-a'})).status,404);
const overview=await call(path,{owner:'teacher-a'});assert.equal(overview.status,200);
const summary=overview.body.speaking.summary.find(r=>r.student_id===an.student.id);
assert.deepEqual([summary.checks,summary.correct,summary.words],[6,3,2]);
assert.equal(overview.body.speaking.summary.find(r=>r.student_id===binh.student.id).checks,1);
assert.equal(overview.body.speaking.summary.some(r=>r.student_id===empty.student.id),false);
assert.deepEqual(overview.body.speaking.words,[]);assert.deepEqual(overview.body.speaking.history,[]);
let detail=(await call(path+'/students/'+an.student.id,{owner:'teacher-a'})).body;
assert.equal(detail.speaking.history.length,6,'Errors, pending, malformed, unknown and guest checks are excluded');
const word=detail.speaking.words.find(r=>r.word_id===monomial.id);
assert.deepEqual([word.checks,word.correct,word.nearly,word.practice,word.unclear],[5,2,1,1,1]);
assert.equal(detail.speaking.history.every(r=>r.feedback_vi&&r.feedback_en),true);
assert.equal(JSON.stringify(detail).includes('fixture-actor'),false,'Reports do not expose actor hashes');
const none=(await call(path+'/students/'+empty.student.id,{owner:'teacher-a'})).body;
assert.deepEqual(none.speaking.words,[]);assert.deepEqual(none.speaking.history,[]);
// The 100-row history cap must never truncate totals.
for(let i=0;i<110;i++)fixture(an,polynomial);
detail=(await call(path+'/students/'+an.student.id,{owner:'teacher-a'})).body;
assert.equal(detail.speaking.history.length,100);
assert.equal(detail.speaking.summary.find(r=>r.student_id===an.student.id).checks,116);
assert.equal(detail.speaking.summary.find(r=>r.student_id===an.student.id).correct,113);
assert.equal(detail.speaking.words.find(r=>r.word_id===polynomial.id).checks,111);
// Render actual responses, including empty results and untrusted names / AI feedback.
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const browser=vm.createContext({console,URLSearchParams,location:{search:''},localStorage:{getItem:()=>null},window:{addEventListener:()=>{}},document:{addEventListener:()=>{}},setInterval:()=>0,esc,icon:()=>'',byId:id=>vocabulary.words.find(w=>w.id===id),lessonById:id=>vocabulary.lessons.find(l=>l.id===id),subj:id=>vocabulary.subjects.find(s=>s.id===id),state:{grade:8}});
vm.runInContext(readFileSync('dist/classroom.js','utf8'),browser);
browser.report=detail;browser.student=an.student;
let html=vm.runInContext('renderStudentSpeaking(student,report.speaking)',browser);
assert.match(html,/Words practised/);assert.match(html,/113/);assert.match(html,/monomial/);assert.match(html,/đơn thức/);
assert.ok(!html.includes('<script>'),'Names and feedback are escaped');
browser.report=none;browser.student=empty.student;
assert.match(vm.runInContext('renderStudentSpeaking(student,report.speaking)',browser),/No checked recordings yet/);
assert.match(vm.runInContext('classUI.signedIn=false;renderTeacher()',browser),/signin-with-chatgpt\?return_to=/,'Teacher sign-in uses the platform return parameter');
assert.ok(!vm.runInContext('classUI.signedIn=null;classUI.loading=true;renderTeacher()',browser).includes('create-class-form'),'Do not offer class creation before identity is checked');
console.log('PASS: class-owner privacy; student-token Speaking saves; one-count retries; per-student / per-word correct totals; all four verdicts; legacy results; excluded errors and guests; uncapped totals with 100-check history; escaped bilingual reports and empty states.');
