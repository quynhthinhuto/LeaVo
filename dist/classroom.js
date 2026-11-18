'use strict';
const CLASS_STORAGE='lexilab-classroom-v1';
let classroom={token:'',student:null,queue:[]},classUI={role:'student',loading:false,error:'',classes:null,detail:null,selectedStudent:'',signedIn:null,lastSynced:null,joinCode:'',subject:'all',activityFilter:'all'};
try{const v=JSON.parse(localStorage.getItem(CLASS_STORAGE)||'null');if(v&&Array.isArray(v.queue))classroom={...classroom,...v};}catch{}
let syncingClass=false;
const classSave=()=>{try{localStorage.setItem(CLASS_STORAGE,JSON.stringify(classroom));}catch{}};
const classDate=value=>value?new Date(value).toLocaleString(undefined,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const classError=e=>{classUI.connectionIssue=e?.kind==='connection';return e?.message||'Unable to connect. / Chưa kết nối được.';};
const onlineClassroom=()=> 'https://lexilab-stem-vn-qn16.quynhthinhuto.chatgpt.site/?classroom='+(classUI.role==='teacher'?'teacher':'student')+'&v=20261118-class-connection1';
const classConnectionError=(message,status=0)=>Object.assign(new Error(message),{kind:'connection',status});
function classErrorNotice(){
  if(!classUI.error)return '';
  return `<div class="class-alert" role="alert"><p>${esc(classUI.error)}</p>${classUI.connectionIssue?`<div class="class-connection-actions"><a class="btn primary" target="_top" href="${onlineClassroom()}">Open Classroom ${icon('arrow')}</a><button class="btn secondary" data-action="class-refresh">Try again ${icon('repeat')}</button></div><p class="form-hint">Use the online app for shared classrooms. A downloaded HTML file or a static preview has no classroom service.<br><span lang="vi">Dùng app trực tuyến để tạo và quản lý lớp. File HTML tải về hoặc bản xem trước tĩnh không có dịch vụ lớp học.</span></p>`:''}</div>`;
}
async function classAPI(path,options={},student=false){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(path,{...options,cache:'no-store',signal:options.signal||controller.signal,headers:{...(options.body?{'content-type':'application/json'}:{}),...(student?{authorization:'Bearer '+classroom.token}:{}),...options.headers},credentials:'same-origin'});
    const raw=await response.text();let result;try{result=JSON.parse(raw);}catch{}
    if(!student&&(response.status===401||(response.redirected&&!result))){classUI.signedIn=false;throw Object.assign(new Error('Sign in again to manage your classes. / Đăng nhập lại để quản lý lớp.'),{status:401});}
    if(!result||typeof result!=='object'||Array.isArray(result)){
      if(response.status>=500)throw classConnectionError('The classroom server is temporarily unavailable (HTTP '+response.status+'). Please try again. / Máy chủ lớp học tạm thời chưa phản hồi (HTTP '+response.status+'). Hãy thử lại.',response.status);
      throw classConnectionError('This page did not receive classroom data. Open online Classroom below. / Trang này chưa nhận được dữ liệu lớp học. Hãy mở lớp học trực tuyến bên dưới.',response.status);
    }
    if(!response.ok)throw Object.assign(new Error(result.error||'Request failed. / Chưa thực hiện được.'),{status:response.status,...(response.status>=500?{kind:'connection'}:{})});
    const get=!options.method||options.method==='GET';if((path==='/api/me'&&typeof result.signedIn!=='boolean')||(path==='/api/classes'&&get&&!Array.isArray(result.classes)))throw classConnectionError('Classroom data is incomplete. Open the online app or try again. / Dữ liệu lớp học chưa đầy đủ. Hãy mở app trực tuyến hoặc thử lại.',response.status);
    return result;
  }catch(e){if(e.name==='AbortError')throw classConnectionError('The connection took too long. Refresh your class list, then try again. / Kết nối quá lâu. Hãy tải lại danh sách lớp rồi thử lại.');if(e.name==='TypeError')throw classConnectionError('Could not reach the classroom server. Check your connection or open the online app. / Chưa kết nối được máy chủ lớp học. Kiểm tra mạng hoặc mở app trực tuyến.');throw e;}finally{clearTimeout(timeout);}
}
function classRerender(){
  if(view!=='classroom'||currentModal)return;
  const report=document.querySelector('.class-speaking-report'),sameStudent=report?.dataset.student===classUI.selectedStudent;
  const historyOpen=sameStudent&&report.querySelector('.class-speaking-history')?.open;
  const feedbackOpen=new Set(sameStudent?[...report.querySelectorAll('.class-speaking-feedback[open]')].map(e=>e.dataset.check):[]);
  render();
  if(historyOpen){const history=document.querySelector('.class-speaking-history');if(history)history.open=true;}
  for(const feedback of document.querySelectorAll('.class-speaking-feedback'))if(feedbackOpen.has(feedback.dataset.check))feedback.open=true;
}
function trackClass(kind,w=null,lid=null,known=false){
  if(!classroom.token||!classroom.student)return;
  if(w&&!w.active)return;
  const lesson=lid&&lessonById(lid)||w&&lessonById(w.lessonIds?.[0]);
  if(kind!=='visit'&&!lesson)return;
  classroom.queue.push({type:'event',studentId:classroom.student.id,id:crypto.randomUUID(),kind,wordId:w?.id||null,lessonId:lesson?.id||null,known});
  classSave();syncClass();
}
function trackClassStudy(s){
  if(!classroom.token||!classroom.student||s.classStudentId!==classroom.student.id||!s.finished||s.mode!=='cards'||!s.lessonId)return;
  const lesson=lessonById(s.lessonId);if(!lesson||s.words.length!==lesson.wordIds.length||s.words.some(w=>!lesson.wordIds.includes(w.id)))return;
  const id='study-'+s.trackingId;if(classroom.queue.some(item=>item.id===id))return;
  classroom.queue.push({type:'event',studentId:classroom.student.id,id,kind:'study_complete',lessonId:s.lessonId,wordIds:s.words.map(w=>w.id)});classSave();syncClass();
}
function trackClassQuiz(s){
  if(!classroom.token||!classroom.student||(Object.hasOwn(s,'classStudentId')&&s.classStudentId!==classroom.student.id)||!s.answerRecords?.length||s.words.some(w=>!w.active))return;
  classroom.queue.push({type:'attempt',studentId:classroom.student.id,id:s.trackingId||crypto.randomUUID(),lessonId:s.lessonId||null,answers:s.answerRecords});classSave();syncClass();
}
async function syncClass(){
  if(syncingClass||!classroom.token||!classroom.student||!classroom.queue.length)return;syncingClass=true;
  try{
    while(classroom.queue.length){
      const item=classroom.queue[0];if(item.studentId!==classroom.student.id){classUI.error='Pending records belong to another student. / Có bản ghi chờ của học sinh khác.';break;}
      if(item.type==='event')await classAPI('/api/student/events',{method:'POST',body:JSON.stringify({events:[item]})},true);
      else await classAPI('/api/student/attempts',{method:'POST',body:JSON.stringify(item)},true);
      classroom.queue.shift();classUI.lastSynced=Date.now();classUI.error='';classSave();
    }
  }catch(e){classUI.error=classError(e);}finally{syncingClass=false;classRerender();}
}
async function loadClasses(id=null,studentId=''){
  const showStudent=studentId&&studentId!==classUI.selectedStudent;
  classUI.loading=true;classUI.error='';classUI.connectionIssue=false;classRerender();
  try{
    const me=await classAPI('/api/me');classUI.signedIn=me.signedIn;
    if(me.signedIn){const r=await classAPI('/api/classes');classUI.classes=r.classes;if(id)classUI.detail=await classAPI('/api/classes/'+encodeURIComponent(id)+(studentId?'/students/'+encodeURIComponent(studentId):''));}
    if(classUI.selectedStudent!==studentId){classUI.subject='all';classUI.activityFilter='all';}classUI.selectedStudent=studentId;
  }catch(e){classUI.error=classError(e);}finally{classUI.loading=false;classRerender();if(showStudent&&!classUI.error)document.getElementById('class-learning-heading')?.scrollIntoView({behavior:'smooth',block:'start'});}
}
function classroomNotice(){return `<details class="classroom-tracking"><summary>Help</summary><p class="classroom-note">Tracking starts after joining. Study counts completed sets of topic flashcards; opening a topic alone does not count. Quizzes count finished attempts. Pending records retry when connected. Speaking results are saved after an AI check while the student is in the class; listening or recording alone does not count.<br><span lang="vi">Theo dõi từ lúc vào lớp. Study là số lượt hoàn thành hết thẻ từ của bài; mở bài chưa tính hoàn thành. Quizzes là số lượt làm hết câu; bản ghi chờ sẽ gửi lại khi có kết nối. Speaking được ghi nhận sau khi AI kiểm tra lúc học sinh đã vào lớp; chỉ nghe hoặc ghi âm chưa tính là một lượt.</span></p></details>`;}
function classTopicTitle(id){const l=lessonById(id);return l?`${esc(l.en)}<small lang="vi">${esc(l.title)} · ${subj(l.subject).name} · Grade ${l.grade}</small>`:esc(id);}
function renderClassroom(){
  return `${pageHeading('Lớp học của bạn.','Giáo viên theo dõi việc học và kết quả từng bài; học sinh vào bằng mã lớp.','',false)}<div class="class-tabs"><button class="chip ${classUI.role==='student'?'active':''}" data-action="class-role" data-role="student">Student</button><button class="chip ${classUI.role==='teacher'?'active':''}" data-action="class-role" data-role="teacher">Teacher</button></div>${classErrorNotice()}${classUI.role==='teacher'?renderTeacher():renderStudentClass()}${classroomNotice()}${footer()}`;
}
function renderStudentClass(){
  if(!classroom.student||(classUI.joinCode&&classUI.joinCode!==classroom.student.joinCode))return `<section class="class-panel join-panel"><span class="icon-box">${icon('users')}</span><h2>Join class</h2><p class="filter-note">Your teacher can see your learning results.</p><form id="join-class-form"><label class="form-field">Class code<input name="code" maxlength="12" required autocomplete="off" placeholder="ABCDEFGH" value="${esc(classUI.joinCode)}" class="code-input"></label><label class="form-field">Name<input name="name" maxlength="40" autocomplete="nickname" placeholder="Name"></label><details><summary>Use student key</summary><label class="form-field">Student key<input name="studentKey" maxlength="80" autocomplete="off" placeholder="Student key"></label><p class="form-hint">Use your student key to keep the same record.<br><span lang="vi">Dùng mã học sinh để tiếp tục đúng hồ sơ cũ; không cần nhập tên mới.</span></p></details><button type="submit" class="btn primary full-width">${classUI.loading?'Connecting…':'Join class'} ${icon('arrow')}</button></form></section>`;
  const s=classroom.student;
  return `<section class="class-panel student-class"><div class="card-heading"><div><span class="review-eyebrow">YOUR CLASS</span><h2>${esc(s.className)}</h2></div><span class="bilingual-badge">Grade ${s.grade}</span></div><h3>${esc(s.name)}</h3><div class="class-sync-status">${icon(classroom.queue.length?'repeat':'checkcircle')}${classroom.queue.length?`${classroom.queue.length} pending records`:'Synced'}${classUI.lastSynced?` · ${classDate(classUI.lastSynced)}`:''}</div><div class="class-actions"><button class="btn primary" data-action="class-learn">Continue ${icon('arrow')}</button><button class="btn secondary" data-action="class-sync">Sync</button></div><details class="student-key"><summary>Student key</summary><p>Keep this key to return on another device. Anyone with it can use your student profile.<br><span lang="vi">Giữ mã này để vào lại trên thiết bị khác. Người có mã có thể dùng hồ sơ của bạn.</span></p><code>${esc(classroom.token)}</code></details><button class="text-link class-leave" data-action="class-leave">Leave this device</button></section>`;
}
function renderTeacher(){
  if(classUI.signedIn===null&&classUI.connectionIssue)return '';
  if(classUI.signedIn===null)return `<section class="class-panel">${classUI.loading?'Checking sign-in…':'Sign-in could not be checked. / Chưa kiểm tra được đăng nhập.'}<button class="text-link" data-action="class-refresh">Try again</button></section>`;
  if(classUI.signedIn===false)return `<section class="class-panel join-panel"><h2>Teacher sign-in</h2><a class="btn primary" href="/signin-with-chatgpt?return_to=%2F%3Fclassroom%3Dteacher" target="_top">Sign in with ChatGPT ${icon('arrow')}</a></section>`;
  if(classUI.loading&&!classUI.classes)return `<section class="class-panel">Loading…</section>`;
  if(classUI.detail)return renderClassDetail();
  return `<div class="teacher-layout"><section class="class-panel"><div class="card-heading"><h2>Your classes</h2><button class="text-link" data-action="class-refresh">Refresh ${icon('repeat')}</button></div>${classUI.classes?.length?`<div class="class-list">${classUI.classes.map(c=>`<button class="class-list-row" data-action="class-open" data-class="${c.id}"><span class="icon-box">${icon('users')}</span><div><h3>${esc(c.name)}</h3><p>Grade ${c.grade} · ${c.student_count} students</p></div>${icon('arrow')}</button>`).join('')}</div>`:'<div class="class-empty">No classes yet.</div>'}</section><section class="class-panel"><h2>Create class</h2><form id="create-class-form"><label class="form-field">Class name<input name="name" maxlength="60" required value="${esc(classUI.createDraft?.name||'')}" placeholder="e.g. 8A"></label><label class="form-field">Grade<select name="grade">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===(classUI.createDraft?.grade||state.grade)?'selected':''}>Grade ${i+1}</option>`).join('')}</select></label><button class="btn primary full-width" type="submit">Create class ${icon('plus')}</button></form></section></div>`;
}
function renderClassDetail(){
  const d=classUI.detail,c=d.class,selected=d.students.find(s=>s.id===classUI.selectedStudent),last=new Date(d.serverTime).toLocaleTimeString(),speaking=new Map((d.speaking?.summary||[]).map(r=>[r.student_id,r]));
  return `<button class="back-button" data-action="class-back">${icon('back')}All classes</button><section class="class-panel class-header"><div><h2>${esc(c.name)} <span class="english-label">· Grade ${c.grade}</span></h2></div><div class="class-invite"><div class="join-code"><small>CLASS CODE</small><strong>${esc(c.join_code)}</strong></div><div class="class-invite-actions"><button class="text-link" data-action="class-copy-code">Copy code</button><button class="text-link" data-action="class-copy-link">Copy invite link</button></div></div><button class="btn secondary" data-action="class-refresh">Refresh ${icon('repeat')}</button></section><p class="filter-note">Updated: ${last}</p><section class="class-panel"><div class="card-heading"><h2>${d.students.length} ${d.students.length===1?'student':'students'} joined</h2></div>${d.students.length?`<div class="class-table-wrap"><table class="class-table"><thead><tr><th>Student</th><th>Visits</th><th>Topics</th><th>Study</th><th>Quizzes</th><th>Speaking<br><small>Correct / Checks</small></th><th>Last active</th><th></th></tr></thead><tbody>${d.students.map(s=>`<tr class="${selected?.id===s.id?'selected':''}"><td><button class="class-student-name" data-action="class-student" data-student="${s.id}" aria-label="View ${esc(s.name)}">${esc(s.name)}</button><small>#${s.id.slice(0,6)}</small></td><td>${s.visits}</td><td>${s.topics}</td><td>${s.studies||0}</td><td>${s.attempts}</td><td class="class-speaking-column"><strong>${speaking.get(s.id)?.correct||0}/${speaking.get(s.id)?.checks||0}</strong><small>${speaking.get(s.id)?.words||0} ${speaking.get(s.id)?.words===1?'word':'words'}</small></td><td>${classDate(s.last_seen)}</td><td><button class="text-link" data-action="class-student" data-student="${s.id}">Details ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="class-empty">No students yet.</div>'}</section>${selected?renderStudentDetail(selected,d):''}`;
}
function classLearningRows(student,d){
  const records=new Map();
  for(const a of d.activities.filter(x=>x.student_id===student.id))records.set(a.lesson_id,{...a});
  for(const q of d.scores.filter(x=>x.student_id===student.id)){const a=records.get(q.lesson_id)||{};records.set(q.lesson_id,{...a,...q,last_at:Math.max(a.last_at||0,q.last_at||0)});}
  return LESSONS.filter(l=>l.grade===d.class.grade||records.has(l.id)).map(l=>({lesson:l,...records.get(l.id),started:records.has(l.id)}));
}
function classLearningStatus(r){return r.attempts?'Practised':r.studies?'Studied':r.cards?'Studying':r.opens?'Opened':'Not started';}
function renderStudentDetail(s,d){
  const all=classLearningRows(s,d),started=all.filter(r=>r.started).length,filtered=all.filter(r=>(classUI.subject==='all'||r.lesson.subject===classUI.subject)&&(classUI.activityFilter==='all'||(classUI.activityFilter==='started'?r.started:!r.started))),subjects=SUBJECTS.filter(subject=>all.some(r=>r.lesson.subject===subject.id));
  return `<section class="class-panel class-learning-report" aria-labelledby="class-learning-heading"><div class="card-heading"><h2 id="class-learning-heading">${esc(s.name)} · Learning</h2></div><div class="class-learning-stats"><div><strong>${started}/${all.length}</strong><span>Topics started</span></div><div><strong>${s.studies||0}</strong><span>Study sessions</span></div><div><strong>${s.attempts||0}</strong><span>Quizzes</span></div></div><div class="class-report-tools"><label class="form-field">Subject<select data-class-subject><option value="all">All subjects</option>${subjects.map(subject=>`<option value="${subject.id}" ${classUI.subject===subject.id?'selected':''}>${subject.name}</option>`).join('')}</select></label><div class="class-report-filters">${[['all','All'],['started','Started'],['not-started','Not started']].map(([id,label])=>`<button class="chip ${classUI.activityFilter===id?'active':''}" data-action="class-report-filter" data-filter="${id}">${label}</button>`).join('')}</div></div>${filtered.length?`<div class="class-table-wrap"><table class="class-table detail-table"><thead><tr><th>Topic</th><th>Status</th><th>Study</th><th>Quizzes</th><th>Correct / Total</th><th>Full marks</th><th>Best</th><th>Last activity</th></tr></thead><tbody>${filtered.map(r=>`<tr><td>${classTopicTitle(r.lesson.id)}</td><td><span class="class-learning-status ${r.started?'started':'not-started'}">${classLearningStatus(r)}</span></td><td>${r.studies||0}<small>${r.cards||0} cards</small></td><td>${r.attempts||0}</td><td>${r.total?`${r.correct}/${r.total} (${Math.round(r.correct/r.total*100)}%)`:'—'}</td><td>${r.perfect||0}</td><td>${r.total?Math.round(r.best)+'%':'—'}</td><td>${classDate(r.last_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="class-empty">No matching topics.</p>'}<details class="classroom-tracking"><summary>Help</summary><p>Study counts completed topic flashcards. Quiz counts finished attempts. Card ratings are self-assessments. Counts start after joining.</p><p lang="vi">Study: số lượt học hết thẻ từ của bài. Quizzes: số lượt làm hết câu. Chỉ ghi nhận từ lúc vào lớp.</p></details></section>${renderStudentSpeaking(s,d.speaking)}<details class="class-panel class-quiz-history"><summary>Recent quizzes</summary><p class="filter-note">Latest 100 topic results</p>${d.history.length?`<div class="class-table-wrap"><table class="class-table"><thead><tr><th>Completed</th><th>Topic</th><th>Correct</th></tr></thead><tbody>${d.history.map(a=>`<tr><td>${classDate(a.created_at)}<small>${a.kind==='mixed'?'Mixed review':'Topic quiz'}</small></td><td>${classTopicTitle(a.lesson_id)}</td><td><strong>${a.correct}/${a.total}</strong> · ${Math.round(a.correct/a.total*100)}%</td></tr>`).join('')}</tbody></table></div>`:'<p class="class-empty">No quizzes yet.</p>'}</details>`;
}
function classInviteURL(code){const url=new URL(location.href);url.pathname='/';url.search='';url.hash='';url.searchParams.set('join',code);return url.href;}
async function copyClassInvite(link=false){
  const code=classUI.detail?.class.join_code;if(!code)return;const value=link?classInviteURL(code):code;
  try{await navigator.clipboard.writeText(value);toast(link?'Invite link copied':'Class code copied');}
  catch{setModal('<div class="modal-heading"><h2>'+(link?'Invite link':'Class code')+'</h2>'+closeButton()+'</div><input class="class-copy-value" readonly value="'+esc(value)+'" aria-label="Copy manually"><p class="form-hint">Select and copy.</p>');}
}
function classSpeakingWord(id){
  const word=byId(id);return word?`<strong lang="en">${esc(word.en)}</strong><small lang="vi">${esc(word.vi)}</small><small>${subj(word.subject).name} · Grade ${word.grade}</small>`:esc(id);
}
function classSpeakingVerdict(verdict){
  const labels={clear:['Correct (AI)','Đúng (AI)'],nearly:['Almost there','Gần đúng'],practice:['Practise again','Luyện thêm'],unclear:['Record again','Ghi âm lại']},label=labels[verdict]||labels.unclear;
  return `<span class="class-speaking-verdict ${Object.hasOwn(labels,verdict)?verdict:'unclear'}">${label[0]}<small lang="vi">${label[1]}</small></span>`;
}
function renderStudentSpeaking(student,report){
  const summary=report?.summary?.find(r=>r.student_id===student.id)||{},words=report?.words||[],history=report?.history||[];
  return `<section class="class-panel class-speaking-report" data-student="${esc(student.id)}" aria-labelledby="class-speaking-heading"><div class="card-heading"><div><h2 id="class-speaking-heading">${esc(student.name)} · Speaking</h2></div></div><div class="class-speaking-stats"><div><strong>${summary.words||0}</strong><span>Words practised</span></div><div><strong>${summary.checks||0}</strong><span>Checks</span></div><div class="correct"><strong>${summary.correct||0}</strong><span>Correct (AI)</span></div></div><details class="classroom-tracking"><summary>Help</summary><p>Correct counts only clear pronunciation. AI feedback supports practice.</p></details>${words.length?`<div class="class-table-wrap"><table class="class-table class-speaking-table"><thead><tr><th>Word</th><th>Checks</th><th>Correct (AI)</th><th>Last practised</th></tr></thead><tbody>${words.map(r=>`<tr><td>${classSpeakingWord(r.word_id)}</td><td>${r.checks}</td><td><strong class="class-speaking-correct">${r.correct}</strong></td><td>${classDate(r.last_at)}</td></tr>`).join('')}</tbody></table></div><details class="class-speaking-history"><summary>Recent checks</summary><p class="filter-note">Latest ${report.historyLimit||100} checks; totals above include every completed check.<br><span lang="vi">Tối đa ${report.historyLimit||100} lượt gần nhất; bảng trên tính tất cả các lượt đã kiểm tra.</span></p><div class="class-speaking-checks">${history.map(r=>`<article class="class-speaking-check"><div class="class-speaking-check-heading"><div>${classSpeakingWord(r.word_id)}</div>${classSpeakingVerdict(r.verdict)}</div><p class="filter-note">${classDate(r.created_at)}</p>${r.lesson_id?`<div class="class-speaking-topic">${classTopicTitle(r.lesson_id)}</div>`:''}<details class="class-speaking-feedback" data-check="${esc(r.request_id)}"><summary>Feedback</summary>${r.heard?`<p>Heard: <strong lang="en">${esc(r.heard)}</strong></p>`:''}<p lang="en">${esc(r.feedback_en)}</p><p lang="vi">${esc(r.feedback_vi)}</p>${r.tip_en?`<div class="class-speaking-tip"><strong>Try this</strong><p lang="en">${esc(r.tip_en)}</p><p lang="vi">${esc(r.tip_vi)}</p></div>`:''}</details></article>`).join('')}</div></details>`:'<p class="class-empty">No checked recordings yet.</p>'}</section>`;
}
async function joinClass(form){
  if(classUI.loading)return;classUI.loading=true;classUI.error='';const data=new FormData(form);
  try{if(classroom.queue.length){await syncClass();if(classroom.queue.length)throw new Error('Sync pending records before changing classes.');}const r=await classAPI('/api/join',{method:'POST',body:JSON.stringify({code:data.get('code'),name:data.get('name'),studentKey:data.get('studentKey')})});classroom={token:r.token,student:r.student,queue:[]};classUI.joinCode='';classSave();state.grade=r.student.grade;saveState();trackClass('visit');classUI.lastSynced=Date.now();toast('Joined your class. / Đã vào lớp.');}catch(e){classUI.error=classError(e);}finally{classUI.loading=false;classRerender();}
}
async function createClass(form){
  if(classUI.creating||classUI.loading)return;
  const data=new FormData(form),name=String(data.get('name')||'').trim(),grade=Number(data.get('grade'));
  classUI.createDraft={name,grade};if(!classUI.createRequest||classUI.createRequest.name!==name||classUI.createRequest.grade!==grade)classUI.createRequest={name,grade,requestId:crypto.randomUUID()};
  classUI.creating=true;classUI.error='';const submit=form.querySelector('button[type=submit]');submit.disabled=true;submit.textContent='Creating…';
  try{const r=await classAPI('/api/classes',{method:'POST',body:JSON.stringify(classUI.createRequest)});classUI.createRequest=null;classUI.createDraft=null;await loadClasses(r.id);}
  catch(e){classUI.error=classError(e);classRerender();}
  finally{classUI.creating=false;if(submit.isConnected){submit.disabled=false;submit.textContent='Create class';}}
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
  if(a==='nav'&&b.dataset.view==='classroom'&&classUI.role==='teacher'&&classUI.classes===null)loadClasses();
  if(a==='class-role'){classUI.role=b.dataset.role;classRerender();if(classUI.role==='teacher')loadClasses();}
  if(a==='class-copy-code'||a==='class-copy-link')copyClassInvite(a==='class-copy-link');
  if(a==='class-report-filter'){classUI.activityFilter=b.dataset.filter;classRerender();}
  if(a==='class-open')loadClasses(b.dataset.class);
  if(a==='class-student')loadClasses(classUI.detail.class.id,b.dataset.student);
  if(a==='class-refresh')loadClasses(classUI.detail?.class.id,classUI.selectedStudent);
  if(a==='class-back'){classUI.detail=null;classUI.selectedStudent='';loadClasses();}
  if(a==='class-sync')syncClass();
  if(a==='class-learn'){state.grade=classroom.student.grade;saveState();navigate('discover');}
  if(a==='class-leave'){
    if(classroom.queue.length){classUI.error='Sync pending records before leaving. / Hãy đồng bộ bản ghi chờ trước khi rời lớp.';classRerender();return;}
    setModal(`<div class="modal-heading"><h2>Leave this device? / Rời lớp trên thiết bị này?</h2>${closeButton()}</div><p class="info-copy">Keep your student key to return to the same profile. Your teacher keeps the learning record.<br><span lang="vi">Giữ mã học sinh để vào lại đúng hồ sơ. Giáo viên vẫn giữ dữ liệu học của bạn.</span></p><code class="leave-key">${esc(classroom.token)}</code><button class="btn primary full-width" data-action="class-confirm-leave">I have saved my key / Đã giữ mã học sinh</button>`);
  }
  if(a==='class-confirm-leave'){classroom={token:'',student:null,queue:[]};classSave();closeModal();}
});
document.addEventListener('change',e=>{if(e.target.matches('[data-class-subject]')){classUI.subject=e.target.value;classRerender();}});
document.addEventListener('submit',e=>{if(e.target.id==='join-class-form'){e.preventDefault();joinClass(e.target);}if(e.target.id==='create-class-form'){e.preventDefault();createClass(e.target);}});
window.addEventListener('online',syncClass);
setInterval(()=>{if(classroom.token&&!document.hidden){syncClass();classAPI('/api/student/presence',{method:'POST'},true).catch(()=>{});}},60000);
setInterval(()=>{if(view==='classroom'&&classUI.role==='teacher'&&classUI.detail&&!document.hidden&&!classUI.loading)loadClasses(classUI.detail.class.id,classUI.selectedStudent);},30000);
(async()=>{if(classroom.token){try{const r=await classAPI('/api/student/me',{},true);classroom.student=r.student;classSave();trackClass('visit');}catch(e){classUI.error=classError(e);}classRerender();}const params=new URLSearchParams(location.search),join=(params.get('join')||'').toUpperCase().replace(/\s/g,'');if(/^[A-Z0-9]{8}$/.test(join))classUI.joinCode=join;const requestedRole=classUI.joinCode?'student':params.get('classroom');if(['teacher','student'].includes(requestedRole)){classUI.role=requestedRole;view='classroom';render();if(requestedRole==='teacher')loadClasses();}})();
