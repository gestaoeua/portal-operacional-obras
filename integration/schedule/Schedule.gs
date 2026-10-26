// Additive module; NOT deployed. No automatic sheet creation or authorization changes.
var SCHEDULE_HEADERS = ['RequestId','ProjetoId','AssignmentId','Revision','Actor','CreatedAt','CommandJson','AssignmentJson'];
function scheduleFail_(code) { fail_('Não foi possível concluir a programação. Confira os dados ou recarregue.',code); }
function scheduleText_(v,max) { if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/.test(v))scheduleFail_('SCHEDULE_INVALID');return v; }
function scheduleAssignment_(a,project) {
 if(!a||typeof a!=='object'||Array.isArray(a)||a.projetoId!==project)scheduleFail_('SCHEDULE_INVALID');
 var out={};['assignmentId','projetoId','personId','personName','locationId','locationName','date','timezone','sourceLabel'].forEach(function(k){out[k]=scheduleText_(a[k],k==='sourceLabel'?500:200);});
 if(out.timezone!=='America/New_York'||!/^\d{4}-\d{2}-\d{2}$/.test(out.date))scheduleFail_('SCHEDULE_INVALID');
 var d=new Date(out.date+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==out.date||Number(out.date.slice(0,4))<2000||Number(out.date.slice(0,4))>2100)scheduleFail_('SCHEDULE_INVALID');
 out.startTime=a.startTime===undefined||a.startTime===null?'':a.startTime;out.endTime=a.endTime===undefined||a.endTime===null?'':a.endTime;
 if(typeof out.startTime!=='string'||typeof out.endTime!=='string'||(!out.startTime&&out.endTime))scheduleFail_('SCHEDULE_INVALID');
 if(out.startTime){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.startTime)||(out.endTime&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.endTime)||out.endTime<=out.startTime)))scheduleFail_('SCHEDULE_INVALID');
  // Resolve both possible New York offsets against the timezone database. Reject gaps AND ambiguous wall times.
  [out.startTime,out.endTime].filter(function(t){return !!t;}).forEach(function(t){var base=Date.parse(out.date+'T'+t+':00Z'), matches=0;[4,5].forEach(function(offset){if(Utilities.formatDate(new Date(base+offset*3600000),'America/New_York','yyyy-MM-dd HH:mm')===out.date+' '+t)matches++;});if(matches!==1)scheduleFail_('SCHEDULE_TIME_AMBIGUOUS');});
 }
 return out;
}
function scheduleRows_() {
 var sh=getSpreadsheet_().getSheetByName('Programacao_Eventos');if(!sh)scheduleFail_('SCHEDULE_NOT_CONFIGURED');
 if(sh.getLastRow()<1||sh.getLastColumn()!==SCHEDULE_HEADERS.length)scheduleFail_('SCHEDULE_LEDGER_INVALID');
 var rows=sh.getDataRange().getDisplayValues();if(SCHEDULE_HEADERS.some(function(h,i){return rows[0][i]!==h;}))scheduleFail_('SCHEDULE_LEDGER_INVALID');
 return rows.slice(1).filter(function(r){return r.some(function(v){return v!=='';});}).map(function(r){var e={};SCHEDULE_HEADERS.forEach(function(h,i){e[h]=r[i];});return e;});
}
function scheduleState_(project) {
 var events=scheduleRows_().filter(function(e){return e.ProjetoId===project;}), latest=Object.create(null),requests=Object.create(null),history=[];
 events.forEach(function(e){
  var a,command;try{a=JSON.parse(e.AssignmentJson);command=JSON.parse(e.CommandJson);}catch(_){scheduleFail_('SCHEDULE_LEDGER_INVALID');}
  if(!a||a.revision!==Number(e.Revision)||!command||command.actor!==e.Actor||command.projetoId!==project||command.expectedRevision!==Number(e.Revision)-1)scheduleFail_('SCHEDULE_LEDGER_INVALID');
  a=scheduleAssignment_(a,project);var rev=Number(e.Revision),prev=latest[a.assignmentId];
  if(JSON.stringify(command.assignment)!==JSON.stringify(a))scheduleFail_('SCHEDULE_LEDGER_INVALID');
  if(!UUID_PATTERN.test(e.RequestId)||requests[e.RequestId]||e.AssignmentId!==a.assignmentId||!Number.isSafeInteger(rev)||rev!==(prev?prev.revision+1:1)||!e.Actor||!Number.isFinite(Date.parse(e.CreatedAt)))scheduleFail_('SCHEDULE_LEDGER_INVALID');
  a.revision=rev;latest[a.assignmentId]=a;requests[e.RequestId]=e;
  history.push({requestId:e.RequestId,assignmentId:a.assignmentId,revision:rev,actor:e.Actor,createdAt:e.CreatedAt,assignment:a});
 });
 return {events:events,latest:latest,requests:requests,history:history};
}
function scheduleAccess_(user,project,write) {
 scheduleText_(project,128);if(!temAcessoProjeto_(user.Usuario,project))scheduleFail_('PROJECT_FORBIDDEN');
 if(write&&['gestor','diretor'].indexOf(user.Perfil)<0)scheduleFail_('ROLE_FORBIDDEN');
}
function scheduleConflicts_(a,latest) {
 // Empty result is NOT a conflict-free guarantee when either interval is incomplete.
 return Object.keys(latest).map(function(id){return latest[id];}).filter(function(b){return a.assignmentId!==b.assignmentId&&a.personId===b.personId&&a.date===b.date&&a.startTime&&a.endTime&&b.startTime&&b.endTime&&a.startTime<b.endTime&&b.startTime<a.endTime;}).map(function(b){return b.assignmentId;});
}
function scheduleList_(user,p) {
 scheduleAccess_(user,p.projetoId,false);var s=scheduleState_(p.projetoId);
 return {ok:true,dataset:{projetoId:p.projetoId,assignments:Object.keys(s.latest).map(function(k){return s.latest[k];}),updatedAt:s.events.length?s.events[s.events.length-1].CreatedAt:''},history:s.history};
}
function scheduleSave_(user,p) {
 scheduleAccess_(user,p.projetoId,true);
 if(typeof p.requestId!=='string'||!UUID_PATTERN.test(p.requestId)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0)scheduleFail_('SCHEDULE_INVALID');
 var a=scheduleAssignment_(p.assignment,p.projetoId), canonical=JSON.stringify({actor:user.Usuario,projetoId:p.projetoId,expectedRevision:p.expectedRevision,assignment:a});
 var lock=LockService.getScriptLock();lock.waitLock(5000);
 try {
  scheduleAccess_(user,p.projetoId,true);var s=scheduleState_(p.projetoId),prior=s.requests[p.requestId];
  if(prior){if(prior.CommandJson!==canonical)scheduleFail_('IDEMPOTENCY_CONFLICT');var replay=JSON.parse(prior.AssignmentJson);replay.revision=Number(prior.Revision);return {ok:true,assignment:replay,replayed:true,conflicts:scheduleConflicts_(replay,s.latest)};}
  var old=s.latest[a.assignmentId];if((old?old.revision:0)!==p.expectedRevision)scheduleFail_('REVISION_CONFLICT');
  a.revision=p.expectedRevision+1;var event={RequestId:p.requestId,ProjetoId:p.projetoId,AssignmentId:a.assignmentId,Revision:a.revision,Actor:user.Usuario,CreatedAt:new Date().toISOString(),CommandJson:canonical,AssignmentJson:JSON.stringify(a)};
  // Prefix spreadsheet-sensitive values; JSON cells start with { and are never formulas.
  var row=SCHEDULE_HEADERS.map(function(k){var v=event[k];return typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v;});
  try {getSpreadsheet_().getSheetByName('Programacao_Eventos').appendRow(row);SpreadsheetApp.flush();}
  catch(_){scheduleFail_('WRITE_UNCONFIRMED');}
  return {ok:true,assignment:a,replayed:false,conflicts:scheduleConflicts_(a,s.latest)};
 } finally {lock.releaseLock();}
}
function scheduleRequest_(p) {
 try {
  if(!p||['scheduleList','scheduleSave'].indexOf(p.action)<0)scheduleFail_('SCHEDULE_ACTION_INVALID');
  if(JSON.stringify(p).length>12000)scheduleFail_('SCHEDULE_INVALID');
  var user=osSession_(p.token);return p.action==='scheduleList'?scheduleList_(user,p):scheduleSave_(user,p);
 } catch(e){return {ok:false,code:e.publicCode||'REQUEST_FAILED',erro:e.publicMessage||'Não foi possível concluir a programação.'};}
}
