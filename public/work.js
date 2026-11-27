// Department Work Plan app: heads tick Daily/Weekly/Monthly tasks and send reports,
// MD dashboard, monthly summary with charts, task editor, LINE alerts, installable (PWA).
(function(){
const $=s=>document.querySelector(s),CFG=window.APP_CONFIG||{};
const RN={D:'วันนี้ · Daily',W:'สัปดาห์นี้ · Weekly',M:'เดือนนี้ · Monthly'},RP={D:'Daily Report',W:'Weekly Report',M:'Monthly Performance Report'};
const MON=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const MONL=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d||1)};
const th=d=>d.getDate()+' '+MON[d.getMonth()]+' '+String(d.getFullYear()+543).slice(2);
const thM=mk=>MONL[+mk.slice(5)-1]+' '+(+mk.slice(0,4)+543);
const monday=d=>{const x=new Date(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
// one record per department per month; a week lives in the month of its Monday
const keys=d=>{const mo=monday(d),mk=ymd(d).slice(0,7);return {D:{doc:mk,p:ymd(d)},W:{doc:ymd(mo).slice(0,7),p:'W'+ymd(mo)},M:{doc:mk,p:'M'+mk}}};
const docKey=(dept,mk)=>'dwp:'+dept+':'+mk;
const PLAN_KEY='dwp:plan';
let sb=null,cache={},planSaved=false;
function toast(t,err){const e=$('#toast');e.textContent=t;e.className='on'+(err?' err':'');clearTimeout(toast.t);toast.t=setTimeout(()=>e.className='',err?5000:1600)}
async function load(k){const {data,error}=await sb.from('shared_state').select('v').eq('key',k).maybeSingle();if(error)throw error;return cache[k]=(data&&data.v)||{}}
// read, change, write the latest copy so two people in one department do not overwrite each other
async function save(k,fn,quiet){try{const v=await load(k);fn(v);const {error}=await sb.from('shared_state').upsert({key:k,v,at:Date.now()});if(error)throw error;cache[k]=v;if(!quiet)toast('บันทึกแล้ว');return v}
 catch(e){toast('บันทึกไม่สำเร็จ: '+(e.message||e),1);throw e}}
const entry=(v,p)=>(v[p]=v[p]||{t:{},rep:{}});

// ---------- plan: the task list. Each task has a stable id so editing/reordering never moves ticks to another task.
// Tasks of the original document get id = their original position, which is how ticks were stored before.
let PLAN=[],DEPT={};
const norm=p=>p.map(u=>({unit:u.unit,name:u.name,start:u.start||'',depts:u.depts.map(d=>({id:d.id,name:d.name,to:d.to||'MD',
 tasks:d.tasks.map((t,i)=>Array.isArray(t)?{id:String(i),r:t[0],t:t[1],e:t[2]||''}:{id:t.id,r:t.r,t:t.t,e:t.e||''})}))}));
const DEFAULT=norm(window.DWP_PLAN);
function setPlan(p){PLAN=norm(p);DEPT={};PLAN.forEach(u=>u.depts.forEach(d=>{d.unit=u;DEPT[d.id]=d}))}
const tasksOf=(dp,r)=>dp.tasks.filter(t=>t.r===r);
const isLive=(u,mk)=>!u.start||mk>=u.start;
setPlan(DEFAULT);

// ---------- LINE (Supabase Edge Function "line-notify"; on when config.js has lineNotify: true)
async function line(body,loud){if(!CFG.lineNotify)return false;
 try{const {data,error}=await sb.functions.invoke('line-notify',{body});if(error)throw error;if(loud)toast('ส่งเข้า LINE แล้ว');return data}
 catch(e){console.warn('LINE',e);if(loud)toast('ส่ง LINE ไม่สำเร็จ: '+(e.message||e),1);return false}}

// ---------- head view
const LS={get:k=>localStorage.getItem('dwp.'+k)||'',set:(k,v)=>localStorage.setItem('dwp.'+k,v)};
const unitOpts=all=>(all?'<option value="">ทุกหน่วย</option>':'')+PLAN.map(u=>'<option value="'+u.unit+'">'+esc(u.name)+'</option>').join('');
function fillDepts(){const u=PLAN.find(x=>x.unit===$('#selU').value)||PLAN[0];$('#selD').innerHTML=u.depts.map(d=>'<option value="'+d.id+'">'+esc(d.name)+'</option>').join('');
 if(DEPT[LS.get('dept')]&&DEPT[LS.get('dept')].unit===u)$('#selD').value=LS.get('dept')}
function fillSelects(){
 const keep=[$('#mdU').value,$('#sumU').value];
 $('#selU').innerHTML=unitOpts();$('#mdU').innerHTML=unitOpts(1);$('#sumU').innerHTML=unitOpts(1);$('#mdU').value=keep[0]||'';$('#sumU').value=keep[1]||'';
 const d0=DEPT[LS.get('dept')];$('#selU').value=d0?d0.unit.unit:(PLAN[1]||PLAN[0]).unit;fillDepts()}
const today=ymd(new Date());
$('#selN').value=LS.get('name');$('#selDate').value=today;$('#mdDate').value=today;$('#sumM').value=today.slice(0,7);
$('#selU').onchange=()=>{fillDepts();LS.set('dept',$('#selD').value);drawMe()};
$('#selD').onchange=()=>{LS.set('dept',$('#selD').value);drawMe()};
$('#selN').onchange=()=>LS.set('name',$('#selN').value.trim());
$('#selDate').onchange=drawMe;
async function drawMe(){const dept=DEPT[$('#selD').value],d=parse($('#selDate').value||today),K=keys(d),body=$('#meBody');
 if(!dept)return;
 body.innerHTML='<p class="empty">กำลังโหลด…</p>';
 const docs={};for(const r of 'DWM'){const k=docKey(dept.id,K[r].doc);if(!docs[k])docs[k]=await load(k).catch(()=>({}))}
 const mk=ymd(d).slice(0,7);let h='';
 if(!isLive(dept.unit,mk))h+='<div class="banner">หน่วยนี้เริ่มใช้จริง '+MON[+dept.unit.start.slice(5)-1]+' '+String(+dept.unit.start.slice(0,4)+543).slice(2)+' (เมื่อเปิดบริการ) · ตอนนี้ทดลองกรอกได้</div>';
 h+='<p class="note" style="margin:0 0 10px">รายงานถึง <b>'+esc(dept.to)+'</b> · Daily ก่อนส่งเวร / 17.00 น. · Weekly วันศุกร์ · Monthly ภายในวันที่ 5 ของเดือนถัดไป</p>';
 const labs={};
 for(const r of 'DWM'){const tasks=tasksOf(dept,r);if(!tasks.length)continue;
  const k=docKey(dept.id,K[r].doc),e=(docs[k][K[r].p])||{t:{},rep:{}},done=tasks.filter(t=>e.t[t.id]&&e.t[t.id].s).length;
  const lab=labs[r]=r==='D'?th(d):r==='W'?th(monday(d))+' – '+th(new Date(monday(d).getTime()+6*864e5)):MON[d.getMonth()]+' '+(d.getFullYear()+543);
  h+='<div class="pcard" data-r="'+r+'"><div class="phead"><h2>'+RN[r]+'</h2><span class="pk">'+lab+'</span><span class="prog'+(done===tasks.length?' full':'')+'">'+done+'/'+tasks.length+'</span></div>'
   +tasks.map(t=>{const s=(e.t[t.id]||{});return '<div class="task s-'+(s.s||'')+'" data-i="'+esc(t.id)+'"><div><div class="tt">'+esc(t.t)+'</div>'+(t.e?'<div class="te"><b>ผลลัพธ์ที่ต้องได้:</b> '+esc(t.e)+'</div>':'')+'</div>'
    +'<div class="btns"><button class="ok'+(s.s==='ok'?' on':'')+'" data-s="ok">✓ ทำแล้ว</button><button class="no'+(s.s==='no'?' on':'')+'" data-s="no">✗ ทำไม่ได้</button></div>'
    +'<div class="tn"><input value="'+esc(s.n)+'" placeholder="'+(s.s==='no'?'เหตุผลที่ทำไม่ได้ (ต้องกรอก)':'ผลที่ได้ / หมายเหตุ (ถ้ามี)')+'"></div></div>'}).join('')
   +'<div class="rep"><label>ปัญหาที่พบ<textarea data-f="issue">'+esc(e.rep.issue)+'</textarea></label><label>งานที่ยังไม่เสร็จ / แผนแก้<textarea data-f="pending">'+esc(e.rep.pending)+'</textarea></label><label>เรื่องที่ต้องรายงานหัวหน้า<textarea data-f="report">'+esc(e.rep.report)+'</textarea></label>'
   +'<div class="rfoot"><label class="esc"><input type="checkbox" data-f="esc"'+(e.rep.esc?' checked':'')+'> ด่วน ต้องให้ผู้บังคับบัญชา / MD ตัดสิน'+(CFG.lineNotify?' (แจ้ง LINE)':'')+'</label>'
   +'<button class="send">'+(e.sub?'ส่ง '+RP[r]+' อีกครั้ง':'ส่ง '+RP[r])+'</button>'
   +(e.sub?'<span class="sent">✓ ส่งแล้ว '+new Date(e.sub).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' โดย '+esc(e.by)+'</span>':'')
   +(e.rep.ack?'<span class="ack">MD: '+esc(e.rep.ack.n||'รับทราบ')+'</span>':'')+'</div></div></div>'}
 body.innerHTML=h||'<p class="empty">แผนกนี้ยังไม่มีรายการงาน</p>';
 body.querySelectorAll('.pcard').forEach(card=>{const r=card.dataset.r,k=docKey(dept.id,K[r].doc),p=K[r].p;
  const by=()=>$('#selN').value.trim()||'(ไม่ระบุชื่อ)';
  card.querySelectorAll('.task').forEach(row=>{const i=row.dataset.i,inp=row.querySelector('.tn input');
   row.querySelectorAll('.btns button').forEach(b=>b.onclick=async()=>{const on=b.classList.contains('on');
    await save(k,v=>{const e=entry(v,p);e.t[i]=Object.assign({},e.t[i],{s:on?'':b.dataset.s,by:by(),at:Date.now()})});drawMe()});
   inp.onchange=()=>save(k,v=>{const e=entry(v,p);e.t[i]=Object.assign({},e.t[i],{n:inp.value.trim(),by:by(),at:Date.now()})})});
  card.querySelectorAll('.rep [data-f]').forEach(f=>f.onchange=()=>save(k,v=>{const e=entry(v,p);e.rep[f.dataset.f]=f.type==='checkbox'?f.checked:f.value.trim()}));
  card.querySelector('.send').onclick=async()=>{if(!$('#selN').value.trim()){toast('กรอกชื่อผู้บันทึกก่อนส่ง',1);$('#selN').focus();return}
   const miss=[...card.querySelectorAll('.task')].filter(x=>x.classList.contains('s-no')&&!x.querySelector('.tn input').value.trim());
   if(miss.length){toast('งานที่ทำไม่ได้ ต้องกรอกเหตุผลก่อนส่ง',1);miss[0].querySelector('input').focus();return}
   const vals={};card.querySelectorAll('.rep [data-f]').forEach(f=>vals[f.dataset.f]=f.type==='checkbox'?f.checked:f.value.trim());
   let alert=false;
   const v=await save(k,v=>{const e=entry(v,p);Object.assign(e.rep,vals);e.sub=Date.now();e.by=by();
    // an urgent report goes to LINE once per report (re-sending the same report does not alert again)
    if(vals.esc&&CFG.lineNotify&&!e.rep.lineAt){alert=true;e.rep.lineAt=Date.now()}});
   if(alert){const e=v[p],no=tasksOf(dept,r).filter(t=>(e.t[t.id]||{}).s==='no').map(t=>t.t+' — '+e.t[t.id].n);
    line({type:'escalation',unit:dept.unit.name,dept:dept.name,to:dept.to,round:RP[r],label:labs[r],by:e.by,issue:vals.issue,pending:vals.pending,report:vals.report,no},true)}
   drawMe()}})}

// ---------- MD dashboard
$('#mdDate').onchange=drawMd;$('#mdU').onchange=drawMd;
async function rows(months){const out={};for(const m of [...new Set(months)]){const {data,error}=await sb.from('shared_state').select('key,v').like('key','dwp:%:'+m);if(error)throw error;
 (data||[]).forEach(r=>{const [,dept,mk]=r.key.split(':');(out[dept]=out[dept]||{})[mk]=r.v||{}})}return out}
async function drawMd(){const d=parse($('#mdDate').value||today),K=keys(d),uf=$('#mdU').value;
 const past=new Date(d.getTime()-6*864e5);let R;
 try{R=await rows([K.D.doc,K.W.doc,ymd(past).slice(0,7)])}catch(e){$('#mdTab').innerHTML='<tr><td class="empty">โหลดไม่สำเร็จ: '+esc(e.message)+'</td></tr>';return}
 const get=(id,r)=>((R[id]||{})[K[r].doc]||{})[K[r].p];
 const after5=ymd(d)<today||new Date().getHours()>=17;
 let sentD=0,act=0,escN=0,noN=0,h='<tr><th>แผนก</th><th class="c">วันนี้</th><th class="c">สัปดาห์นี้</th><th class="c">เดือนนี้</th><th class="c">ส่ง Daily เดือนนี้</th><th class="c">ต้องตัดสิน</th></tr>';
 const pill=(dp,r)=>{const ts=tasksOf(dp,r);if(!ts.length)return '<span class="note">–</span>';
  const e=get(dp.id,r)||{t:{}},ok=ts.filter(t=>(e.t[t.id]||{}).s==='ok').length,no=ts.filter(t=>(e.t[t.id]||{}).s==='no').length,n=ts.length;
  const c=no?'r':e.sub&&ok===n?'g':e.sub||ok?'a':(r==='D'&&after5?'r':'');
  return '<span class="pill '+c+'" title="ทำแล้ว '+ok+' · ทำไม่ได้ '+no+' · '+(e.sub?'ส่งรายงานแล้ว':'ยังไม่ส่ง')+'">'+(e.sub?'✓ ':'')+ok+'/'+n+'</span>'};
 const iss=[];
 PLAN.forEach(u=>{if(uf&&u.unit!==uf)return;const live=isLive(u,ymd(d).slice(0,7));
  h+='<tr class="uh"><td colspan="6">'+esc(u.name)+(live?'':' <span class="note">(เริ่มใช้เมื่อเปิดบริการ)</span>')+'</td></tr>';
  u.depts.forEach(dp=>{const eD=get(dp.id,'D')||{};if(live){act++;if(eD.sub)sentD++}
   // monthly submission rate of Daily Reports up to the selected day
   const mdoc=(R[dp.id]||{})[K.D.doc]||{};let s=0;for(let i=1;i<=d.getDate();i++){const p=K.D.doc+'-'+pad(i);if(mdoc[p]&&mdoc[p].sub)s++}
   const rate=Math.round(s/d.getDate()*100),rc=rate>=90?'g':rate>=60?'a':s?'r':'';
   // escalations and "could not do" in the last 7 days (+ this week's and month's reports)
   let open=0;const docs=R[dp.id]||{};Object.entries(docs).forEach(([mk,v])=>Object.entries(v).forEach(([p,e])=>{if(!e||!e.rep)return;
    const dt=p.startsWith('W')?parse(p.slice(1)):p.startsWith('M')?parse(p.slice(1)+'-01'):parse(p);
    const inWin=p.startsWith('W')?p===K.W.p:p.startsWith('M')?p===K.M.p:(dt>=past&&dt<=d);if(!inWin)return;
    if(e.rep.esc&&!e.rep.ack){open++}
    if(e.rep.esc||e.rep.report)iss.push({kind:'esc',dt,p,mk,dept:dp,txt:e.rep.report||e.rep.issue||'(ไม่ได้ระบุรายละเอียด)',by:e.by,ack:e.rep.ack,urgent:!!e.rep.esc});
    Object.entries(e.t||{}).forEach(([i,t])=>{if(t.s==='no'){const task=dp.tasks.find(x=>x.id===i);noN++;iss.push({kind:'no',dt,p,mk,dept:dp,txt:(task?task.t:'(งานที่ถูกลบแล้ว)')+' — '+(t.n||'ไม่ได้ระบุเหตุผล'),by:t.by})}})}));
   escN+=open;
   h+='<tr><td><span class="dlink" data-id="'+dp.id+'">'+esc(dp.name)+'</span></td><td class="c">'+pill(dp,'D')+'</td><td class="c">'+pill(dp,'W')+'</td><td class="c">'+pill(dp,'M')+'</td><td class="c"><span class="pill '+rc+'">'+s+'/'+d.getDate()+' วัน</span></td><td class="c">'+(open?'<span class="pill r">⚠ '+open+'</span>':'<span class="note">–</span>')+'</td></tr>'})});
 $('#mdTab').innerHTML=h;
 $('#mdStats').innerHTML='<div class="stat"><b>'+sentD+'/'+act+'</b><span>แผนกที่ส่ง Daily Report '+th(d)+'</span></div><div class="stat"><b style="color:'+(escN?'var(--bad)':'inherit')+'">'+escN+'</b><span>เรื่องด่วนรอตัดสิน</span></div><div class="stat"><b>'+noN+'</b><span>งานที่ทำไม่ได้ (7 วัน)</span></div><div class="stat"><b>'+(act?Math.round(sentD/act*100):0)+'%</b><span>อัตราส่งรายงานวันนี้</span></div>';
 $('#mdTab').querySelectorAll('.dlink').forEach(a=>a.onclick=()=>{const dp=DEPT[a.dataset.id];$('#selU').value=dp.unit.unit;fillDepts();$('#selD').value=dp.id;$('#selDate').value=ymd(d);show('me');drawMe()});
 iss.sort((a,b)=>(b.urgent&&!b.ack)-(a.urgent&&!a.ack)||b.dt-a.dt);
 $('#mdIss').innerHTML=iss.length?iss.map((x,j)=>'<div class="iss"><span class="ik '+x.kind+'">'+(x.kind==='esc'?(x.urgent?'⚠ ด่วน':'รายงาน'):'ทำไม่ได้')+'</span><div><div>'+esc(x.txt)+'</div><div class="im">'+esc(x.dept.name)+' · '+(x.p.startsWith('W')?'สัปดาห์ '+th(x.dt):x.p.startsWith('M')?'เดือน '+MON[x.dt.getMonth()]:th(x.dt))+(x.by?' · '+esc(x.by):'')+'</div></div>'
   +'<span class="im">'+(x.ack?'✓ '+esc(x.ack.n||'รับทราบ'):'')+'</span>'
   +(x.kind==='esc'&&x.urgent&&!x.ack?'<div class="iack"><input placeholder="คำตัดสิน / คำสั่ง" data-j="'+j+'"><button data-j="'+j+'">บันทึกคำตัดสิน</button></div>':'')+'</div>').join(''):'<p class="empty">ไม่มีเรื่องค้างใน 7 วันล่าสุด</p>';
 $('#mdIss').querySelectorAll('button[data-j]').forEach(b=>b.onclick=async()=>{const x=iss[+b.dataset.j],n=$('#mdIss').querySelector('input[data-j="'+b.dataset.j+'"]').value.trim()||'รับทราบ';
  await save(docKey(x.dept.id,x.mk),v=>{const e=entry(v,x.p);e.rep.ack={n,at:Date.now()}});drawMd()})}

// ---------- monthly summary
$('#sumM').onchange=drawSum;$('#sumU').onchange=drawSum;
function monthStat(dp,doc,mk,upto){
 const D=tasksOf(dp,'D'),W=tasksOf(dp,'W'),M=tasksOf(dp,'M');
 const s={exp:0,ok:0,no:0,dSent:0,days:[],wN:0,wSent:0,mSent:false,esc:0,escOpen:0,hasD:D.length,hasW:W.length,hasM:M.length};
 const cnt=(e,ts)=>{s.exp+=ts.length;if(!e)return;ts.forEach(t=>{const x=(e.t&&e.t[t.id]||{}).s;if(x==='ok')s.ok++;else if(x==='no')s.no++});if(e.rep&&e.rep.esc){s.esc++;if(!e.rep.ack)s.escOpen++}};
 for(let i=1;i<=upto;i++){const e=doc[mk+'-'+pad(i)];cnt(e,D);const ok=!!(e&&e.sub);s.days.push(ok);if(ok)s.dSent++;
  if(parse(mk+'-'+pad(i)).getDay()===1){s.wN++;const w=doc['W'+mk+'-'+pad(i)];cnt(w,W);if(w&&w.sub)s.wSent++}}
 if(upto){const m=doc['M'+mk];cnt(m,M);s.mSent=!!(m&&m.sub)}
 s.pct=s.exp?Math.round(s.ok/s.exp*100):null;return s}
let SUM=null;
async function drawSum(){const mk=$('#sumM').value||today.slice(0,7),uf=$('#sumU').value;
 const last=new Date(+mk.slice(0,4),+mk.slice(5),0).getDate(),upto=mk<today.slice(0,7)?last:mk===today.slice(0,7)?+today.slice(8):0;
 $('#sumTitle').textContent='สรุปผลงานแผนก '+thM(mk)+(uf?' · '+PLAN.find(u=>u.unit===uf).name:'');
 let R;try{R=await rows([mk])}catch(e){$('#sumTab').innerHTML='<tr><td class="empty">โหลดไม่สำเร็จ: '+esc(e.message)+'</td></tr>';return}
 const list=[];PLAN.forEach(u=>{if(uf&&u.unit!==uf)return;if(!isLive(u,mk))return;u.depts.forEach(dp=>list.push({dp,u,s:monthStat(dp,(R[dp.id]||{})[mk]||{},mk,upto)}))});
 SUM={mk,upto,list,uf};
 if(!upto){$('#sumStats').innerHTML='';$('#sumCharts').innerHTML='';$('#sumTab').innerHTML='<tr><td class="empty">เดือนนี้ยังไม่เริ่ม</td></tr>';return}
 const T=list.reduce((a,x)=>{a.exp+=x.s.exp;a.ok+=x.s.ok;a.no+=x.s.no;a.dS+=x.s.dSent;a.dN+=x.s.hasD?upto:0;a.esc+=x.s.esc;a.open+=x.s.escOpen;return a},{exp:0,ok:0,no:0,dS:0,dN:0,esc:0,open:0});
 $('#sumStats').innerHTML='<div class="stat"><b>'+(T.exp?Math.round(T.ok/T.exp*100):0)+'%</b><span>งานที่ทำแล้ว ('+T.ok.toLocaleString()+' จาก '+T.exp.toLocaleString()+')</span></div>'
  +'<div class="stat"><b>'+(T.dN?Math.round(T.dS/T.dN*100):0)+'%</b><span>อัตราส่ง Daily Report ('+list.length+' แผนก · '+upto+' วัน)</span></div>'
  +'<div class="stat"><b>'+T.no+'</b><span>ครั้งที่ทำงานไม่ได้</span></div>'
  +'<div class="stat"><b style="color:'+(T.open?'var(--bad)':'inherit')+'">'+T.esc+'</b><span>เรื่องด่วน'+(T.open?' · ยังไม่ตัดสิน '+T.open:' · ตัดสินครบ')+'</span></div>';
 $('#sumCharts').innerHTML=list.length?'<div class="chart"><h4>% งานที่ทำแล้ว รายแผนก</h4><p>'+thM(mk)+(upto<last?' · ถึงวันที่ '+upto:'')+'</p>'+barsH(list)+'</div>'
  +'<div class="chart"><h4>จำนวนแผนกที่ส่ง Daily Report รายวัน</h4><p>จาก '+list.filter(x=>x.s.hasD).length+' แผนกที่มีงานรายวัน</p>'+cols(list,mk,upto)+'</div>':'';
 let h='<tr><th>แผนก</th><th class="c">งานที่ทำแล้ว</th><th class="c">ส่ง Daily</th><th class="c">ส่ง Weekly</th><th class="c">ส่ง Monthly</th><th class="c">ทำไม่ได้</th><th class="c">เรื่องด่วน</th></tr>',cu='';
 const pc=(a,b)=>{if(!b)return '<span class="note">–</span>';const r=a/b;return '<span class="pill '+(r>=.9?'g':r>=.6?'a':'r')+'">'+a+'/'+b+'</span>'};
 list.forEach(({dp,u,s})=>{if(u!==cu){cu=u;h+='<tr class="uh"><td colspan="7">'+esc(u.name)+'</td></tr>'}
  h+='<tr><td>'+esc(dp.name)+'</td><td class="c">'+(s.pct==null?'<span class="note">–</span>':'<span class="pill '+(s.pct>=90?'g':s.pct>=60?'a':'r')+'">'+s.pct+'%</span>')+'</td><td class="c">'+(s.hasD?pc(s.dSent,upto):'<span class="note">–</span>')+'</td><td class="c">'+(s.hasW?pc(s.wSent,s.wN):'<span class="note">–</span>')+'</td><td class="c">'+(s.hasM?(s.mSent?'<span class="pill g">✓ ส่งแล้ว</span>':'<span class="pill'+(upto===last?' r':'')+'">ยังไม่ส่ง</span>'):'<span class="note">–</span>')+'</td><td class="c">'+(s.no||'<span class="note">0</span>')+'</td><td class="c">'+(s.esc?(s.escOpen?'<span class="pill r">'+s.esc+' · ค้าง '+s.escOpen+'</span>':'<span class="pill g">'+s.esc+' · ตัดสินแล้ว</span>'):'<span class="note">0</span>')+'</td></tr>'});
 $('#sumTab').innerHTML=list.length?h:'<tr><td class="empty">ไม่มีแผนกที่เปิดใช้ในเดือนนี้</td></tr>';
 tips($('#sumCharts'))}
// horizontal bars: one series (brand green), value labels in text ink, hover tooltip per row
function chartW(){const cw=$('#sumCharts').clientWidth||520;return Math.round(Math.max(280,innerWidth>800?(cw-14)/2-30:cw-30))}
function barsH(list){const W=chartW(),L=W<420?118:170,RW=44,rh=22,H=list.length*rh+22,x=v=>L+(W-L-RW)*v/100;
 let g='';[0,50,100].forEach(v=>g+='<line x1="'+x(v)+'" x2="'+x(v)+'" y1="0" y2="'+(H-18)+'" stroke="#E6DCC6"/><text x="'+x(v)+'" y="'+(H-4)+'" text-anchor="middle">'+v+'%</text>');
 list.forEach(({dp,s},i)=>{const y=i*rh,p=s.pct||0,mx=L<150?17:26,nm=dp.name.length>mx?dp.name.slice(0,mx-1)+'…':dp.name;
  const tip=dp.name+'\nทำแล้ว '+s.ok+' จาก '+s.exp+' งาน ('+(s.pct==null?'–':s.pct+'%')+')\nทำไม่ได้ '+s.no+' ครั้ง';
  g+='<g class="row" data-tip="'+esc(tip)+'"><rect class="hit" x="0" y="'+y+'" width="'+W+'" height="'+rh+'"/><text x="'+(L-8)+'" y="'+(y+15)+'" text-anchor="end">'+esc(nm)+'</text>'
   +(p>0?'<rect class="bar" x="'+L+'" y="'+(y+5)+'" width="'+Math.max(2,x(p)-L)+'" height="'+(rh-10)+'" rx="3" fill="#2F6B57"/>':'')
   +'<text class="v" x="'+(x(p)+5)+'" y="'+(y+15)+'">'+(s.pct==null?'–':s.pct+'%')+'</text></g>'});
 return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="% งานที่ทำแล้วรายแผนก">'+g+'</svg>'}
// columns: departments that sent the Daily Report on each day
function cols(list,mk,upto){const last=new Date(+mk.slice(0,4),+mk.slice(5),0).getDate(),n=list.filter(x=>x.s.hasD).length||1,W=chartW(),H=200,L=28,B=22,cw=(W-L)/last,y=v=>(H-B)-(H-B-8)*v/n;
 let g='';const ticks=[0,Math.round(n/2),n];[...new Set(ticks)].forEach(v=>g+='<line x1="'+L+'" x2="'+W+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#E6DCC6"/><text x="'+(L-6)+'" y="'+(y(v)+4)+'" text-anchor="end">'+v+'</text>');
 for(let i=1;i<=last;i++){const x0=L+(i-1)*cw,c=i<=upto?list.filter(x=>x.s.hasD&&x.s.days[i-1]).length:null,dt=parse(mk+'-'+pad(i));
  const miss=c==null?'':list.filter(x=>x.s.hasD&&!x.s.days[i-1]).map(x=>'• '+x.dp.name);
  const tip=th(dt)+(c==null?'\nยังไม่ถึงวัน':'\nส่งแล้ว '+c+' จาก '+n+' แผนก'+(miss.length?'\nยังไม่ส่ง:\n'+miss.slice(0,8).join('\n')+(miss.length>8?'\n… อีก '+(miss.length-8):''):''));
  g+='<g class="row" data-tip="'+esc(tip)+'"><rect class="hit" x="'+x0+'" y="0" width="'+cw+'" height="'+H+'"/>'
   +(c?'<rect class="bar" x="'+(x0+1)+'" y="'+y(c)+'" width="'+Math.max(1,cw-2)+'" height="'+(H-B-y(c))+'" rx="2" fill="#2F6B57"/>':'')
   +((i===1||i%5===0||i===last)?'<text x="'+(x0+cw/2)+'" y="'+(H-6)+'" text-anchor="middle">'+i+'</text>':'')+'</g>'}
 return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="จำนวนแผนกที่ส่ง Daily Report รายวัน">'+g+'</svg>'}
function tips(root){const tip=$('#tip');root.querySelectorAll('[data-tip]').forEach(el=>{
 el.onmousemove=e=>{tip.textContent=el.dataset.tip;tip.className='on';const r=tip.getBoundingClientRect();tip.style.left=Math.min(innerWidth-r.width-8,e.clientX+12)+'px';tip.style.top=Math.max(8,e.clientY-r.height-10)+'px'};
 el.onmouseleave=()=>tip.className='';el.onclick=el.onmousemove})}
function sumText(){if(!SUM||!SUM.upto)return '';const {mk,upto,list}=SUM;
 const T=list.reduce((a,x)=>(a.exp+=x.s.exp,a.ok+=x.s.ok,a.no+=x.s.no,a.open+=x.s.escOpen,a),{exp:0,ok:0,no:0,open:0});
 return '📊 สรุปผลงานแผนก '+thM(mk)+(SUM.uf?' · '+PLAN.find(u=>u.unit===SUM.uf).name:'')+(upto<new Date(+mk.slice(0,4),+mk.slice(5),0).getDate()?' (ถึงวันที่ '+upto+')':'')
  +'\nงานที่ทำแล้ว '+(T.exp?Math.round(T.ok/T.exp*100):0)+'% · ทำไม่ได้ '+T.no+' ครั้ง · เรื่องด่วนค้าง '+T.open
  +'\n\n'+list.map(({dp,s})=>(s.pct==null?'–':s.pct+'%')+'  '+dp.name+(s.hasD?' · Daily '+s.dSent+'/'+upto:'')+(s.escOpen?' · ⚠ค้าง '+s.escOpen:'')).join('\n')}
$('#sumPrint').onclick=()=>window.print();
$('#sumCopy').onclick=async()=>{try{await navigator.clipboard.writeText(sumText());toast('คัดลอกแล้ว')}catch(e){toast('คัดลอกไม่ได้',1)}};
$('#sumLine').hidden=!CFG.lineNotify;
$('#sumLine').onclick=()=>{const t=sumText();if(t&&confirm('ส่งสรุปนี้เข้า LINE?\n\n'+t.slice(0,400)+(t.length>400?'…':'')))line({type:'summary',text:t},true)};

// ---------- task editor (executive account only; the database also blocks staff from saving the plan)
let ED=null,edDirty=false;
const clone=o=>JSON.parse(JSON.stringify(o,(k,v)=>k==='unit'&&typeof v==='object'?undefined:v));
const nid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
function dirty(on){edDirty=on;$('#edDirty').textContent=on?'มีการแก้ไขที่ยังไม่บันทึก':''}
function edUnit(){return ED.find(u=>u.unit===$('#edU').value)||ED[0]}
function edDept(){const u=edUnit();return u.depts.find(d=>d.id===$('#edD').value)||u.depts[0]}
function openEdit(){if(!ED){ED=clone(PLAN);dirty(false)}const uv=$('#edU').value;
 $('#edU').innerHTML=ED.map(u=>'<option value="'+u.unit+'">'+esc(u.name)+'</option>').join('');$('#edU').value=uv&&ED.some(u=>u.unit===uv)?uv:($('#selU').value||ED[0].unit);edDepts()}
function edDepts(keep){const u=edUnit(),dv=keep||$('#edD').value;$('#edD').innerHTML=u.depts.map(d=>'<option value="'+d.id+'">'+esc(d.name||'(แผนกใหม่)')+'</option>').join('');
 if(u.depts.some(d=>d.id===dv))$('#edD').value=dv;$('#edStart').value=u.start||'';drawEdit()}
function drawEdit(){const d=edDept(),box=$('#edRows');$('#edDelD').disabled=!d;
 if(!d){$('#edName').value='';$('#edTo').value='';box.innerHTML='<p class="empty" style="padding:12px 14px">หน่วยนี้ยังไม่มีแผนก</p>';return}
 $('#edName').value=d.name;$('#edTo').value=d.to;
 const order={D:0,W:1,M:2};d.tasks.sort((a,b)=>order[a.r]-order[b.r]);
 box.innerHTML=d.tasks.map((t,i)=>'<div class="edrow" data-i="'+i+'"><select data-k="r">'+['D','W','M'].map(r=>'<option value="'+r+'"'+(t.r===r?' selected':'')+'>'+RP[r].replace(' Performance','').replace(' Report','')+'</option>').join('')+'</select>'
  +'<textarea data-k="t" rows="2" placeholder="งานที่ต้องทำ">'+esc(t.t)+'</textarea><textarea data-k="e" rows="2" placeholder="ผลลัพธ์ที่ต้องได้">'+esc(t.e)+'</textarea>'
  +'<span class="mv"><button data-m="-1" title="เลื่อนขึ้น">↑</button><button data-m="1" title="เลื่อนลง">↓</button><button class="del" data-m="x" title="ลบงาน">✕</button></span></div>').join('')||'<p class="empty" style="padding:12px 14px">ยังไม่มีงาน กด “+ เพิ่มงาน”</p>';
 box.querySelectorAll('.edrow').forEach(row=>{const t=d.tasks[+row.dataset.i];
  row.querySelectorAll('[data-k]').forEach(f=>f.oninput=()=>{t[f.dataset.k]=f.value;dirty(true);if(f.dataset.k==='r')drawEdit()});
  row.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{const i=+row.dataset.i,m=b.dataset.m;
   if(m==='x'){if(t.t&&!confirm('ลบงาน “'+t.t+'” ?'))return;d.tasks.splice(i,1)}
   else{const j=i+ +m;if(j<0||j>=d.tasks.length||d.tasks[j].r!==t.r)return;[d.tasks[i],d.tasks[j]]=[d.tasks[j],d.tasks[i]]}
   dirty(true);drawEdit()})})}
$('#edU').onchange=()=>edDepts();$('#edD').onchange=drawEdit;
$('#edName').oninput=()=>{const d=edDept();if(d){d.name=$('#edName').value;dirty(true);$('#edD').selectedOptions[0].textContent=d.name||'(แผนกใหม่)'}};
$('#edTo').oninput=()=>{const d=edDept();if(d){d.to=$('#edTo').value;dirty(true)}};
$('#edStart').onchange=()=>{edUnit().start=$('#edStart').value;dirty(true)};
$('#edAddT').onclick=()=>{const d=edDept();if(!d)return;d.tasks.push({id:nid('t'),r:'D',t:'',e:''});dirty(true);drawEdit();const ta=$('#edRows').querySelectorAll('textarea[data-k="t"]');(ta[ta.length-1]||{focus(){}}).focus()};
$('#edAddD').onclick=()=>{const nm=prompt('ชื่อแผนกใหม่');if(!nm)return;const d={id:nid('d'),name:nm.trim(),to:'MD',tasks:[]};edUnit().depts.push(d);dirty(true);edDepts(d.id)};
$('#edDelD').onclick=()=>{const u=edUnit(),d=edDept();if(!d||!confirm('ลบแผนก “'+d.name+'” และงานทั้งหมดของแผนกนี้?\n(ข้อมูลที่ติ๊กไว้ยังเก็บอยู่ในฐานข้อมูล แต่จะไม่แสดง)'))return;u.depts.splice(u.depts.indexOf(d),1);dirty(true);edDepts()};
$('#edReset').onclick=()=>{if(!confirm('คืนรายการงานทั้งหมดตามเอกสาร Master Department Work Plan ต้นฉบับ?\nงานที่เพิ่มเองจะหายหลังกดบันทึก'))return;ED=clone(DEFAULT);dirty(true);openEdit()};
$('#edSave').onclick=async()=>{
 for(const u of ED)for(const d of u.depts){if(!d.name.trim()){toast('กรอกชื่อแผนกให้ครบ',1);$('#edU').value=u.unit;edDepts(d.id);return}
  d.name=d.name.trim();d.to=(d.to||'').trim()||'MD';d.tasks=d.tasks.filter(t=>(t.t||'').trim()).map(t=>({id:t.id,r:t.r,t:t.t.trim(),e:(t.e||'').trim()}))}
 try{await save(PLAN_KEY,v=>{v.plan=ED;v.by=$('#selN').value.trim()||'';v.at=Date.now()})}catch(e){return}
 planSaved=true;setPlan(ED);ED=clone(PLAN);dirty(false);fillSelects();drawEdit();drawMe()};
window.addEventListener('beforeunload',e=>{if(edDirty){e.preventDefault();e.returnValue=''}});

// ---------- navigation
function show(v){if(v==='edit'&&!document.documentElement.classList.contains('lvl-exec'))v='me';
 if(v!=='edit'&&edDirty&&$('#edit').classList.contains('on')&&!confirm('ยังไม่ได้บันทึกรายการงาน ออกจากหน้านี้?'))return;
 if(v!=='edit'&&edDirty){ED=null;dirty(false)}
 document.querySelectorAll('section').forEach(s=>s.classList.toggle('on',s.id===v));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
 history.replaceState(null,'',v==='me'?location.pathname:'#'+v);
 if(v==='md')drawMd();if(v==='sum')drawSum();if(v==='edit')openEdit()}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>show(b.dataset.v));
setInterval(()=>{if(!document.hidden&&$('#md').classList.contains('on'))drawMd()},60000);
let rsz;addEventListener('resize',()=>{clearTimeout(rsz);rsz=setTimeout(()=>{if($('#sum').classList.contains('on'))drawSum()},300)});
function level(){document.documentElement.classList.toggle('lvl-exec',!!window.__fin);
 // the LINE reminder reads the task list from the database, so the executive account stores it once
 if(window.__fin&&!planSaved&&sb&&CFG.lineNotify)save(PLAN_KEY,v=>{if(!v.plan){v.plan=PLAN.map(u=>clone(u));v.at=Date.now()}},1).then(()=>planSaved=true).catch(()=>{});
 if(location.hash==='#edit')show('edit')}
document.addEventListener('levelready',level);
window.claude.use('db').then(async()=>{sb=window.__sb;
 try{const v=await load(PLAN_KEY);if(v&&Array.isArray(v.plan)&&v.plan.length){setPlan(v.plan);planSaved=true}}catch(e){console.warn('plan',e)}
 fillSelects();drawMe();const h=location.hash.slice(1);if(['md','sum','edit'].includes(h))show(h);if(window.__fin!==undefined)level()});

// ---------- installable app (PWA)
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('sw',e)));
let deferred=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#install').classList.add('on')});
$('#install').onclick=async()=>{if(!deferred)return;deferred.prompt();await deferred.userChoice;deferred=null;$('#install').classList.remove('on')};
window.addEventListener('appinstalled',()=>{$('#install').classList.remove('on');toast('ติดตั้งแอปแล้ว')});
const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
if(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!standalone&&!LS.get('iosHint')){$('#iosHint').classList.add('on');$('#iosHint button').onclick=()=>{$('#iosHint').classList.remove('on');LS.set('iosHint','1')}}
const net=()=>document.documentElement.classList.toggle('off',!navigator.onLine);addEventListener('online',net);addEventListener('offline',net);net();

window.DWP_APP={show,drawMe,drawMd,drawSum};
})();
