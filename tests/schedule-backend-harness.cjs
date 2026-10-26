const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../integration/schedule/Schedule.gs'),'utf8');
function harness(options={}){
 let rows=options.rows||null,missing=!!options.missing,fail=options.fail||'',locks=0;
 const ctx={console,Date,JSON,Number,Object,Array,String,RegExp,
  UUID_PATTERN:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  fail_(m,c){const e=new Error(m);e.publicMessage=m;e.publicCode=c;throw e;},
  osSession_(token){if(!['fixture-manager','fixture-executor','fixture-other'].includes(token))this.fail_('Sessão expirada','SESSION_EXPIRED');return {Usuario:token,Perfil:token==='fixture-executor'?'executor':'gestor'};},
  temAcessoProjeto_(user,project){return project==='PILOTO_FICTICIO_AGENDA'&&user!=='fixture-other';},
  Utilities:{formatDate(d,tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;}},
  LockService:{getScriptLock(){return {waitLock(){locks++;},releaseLock(){locks--;}};}},
  SpreadsheetApp:{flush(){if(fail==='after')throw Error('transport');}},
  getSpreadsheet_(){return {getSheetByName(name){if(missing||name!=='Programacao_Eventos')return null;return {getLastRow(){return rows.length;},getLastColumn(){return rows[0].length;},getDataRange(){return {getDisplayValues(){return rows.map(r=>r.map(String));}};},appendRow(row){if(fail==='before')throw Error('write');rows.push(row);if(options.persist)options.persist(rows);}};}};}
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);if(!rows)rows=[Array.from(ctx.SCHEDULE_HEADERS)];
 // Functions invoked unbound by Apps Script; avoid relying on JavaScript `this`.
 ctx.osSession_=token=>{if(!['fixture-manager','fixture-executor','fixture-other'].includes(token))ctx.fail_('Sessão expirada','SESSION_EXPIRED');return {Usuario:token,Perfil:token==='fixture-executor'?'executor':'gestor'};};
 return {ctx,request:p=>JSON.parse(JSON.stringify(ctx.scheduleRequest_(p))),rows:()=>rows,locks:()=>locks,setFailure:v=>fail=v};
}
module.exports={harness};
