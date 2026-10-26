// Generate a reviewable additive candidate, never deploy it.
const fs=require('node:fs'),cp=require('node:child_process');
const current=fs.readFileSync('apps-script/Code.gs','utf8');
const base=cp.execFileSync('git',['show','c0f3833d529602621ce07035e7a831e4b6639ae6:apps-script/Code.gs'],{encoding:'utf8'});
const constants=current.slice(current.indexOf('var SCHEMAS ='),current.indexOf('var VALID_ACTIONS'));
const helpers=current.slice(current.indexOf('function fail_('),current.indexOf('function doGet('));
const ledger=current.slice(current.indexOf('var OS_EVENTOS_HEADERS =')).replace('var currentUser = session_(p.token);','var currentUser = osSession_(p.token);');
const routes=`
// OS-only adapter. Existing login/session/hash functions above are unchanged.
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function osSession_(token) {
  requireToken_(token);
  var saved;
  try { saved = session_(token); } catch (_) { fail_('Sessão expirada. Entre novamente.','SESSION_EXPIRED'); }
  var matches=rows_('Usuarios').filter(function(u){return u.Usuario===saved.Usuario;});
  if(matches.length!==1 || matches[0].Ativo!=='Sim' || VALID_ROLES.indexOf(matches[0].Perfil)<0) fail_('Sessão inválida. Entre novamente.','SESSION_EXPIRED');
  return matches[0];
}
function routeOsRequest_(e) {
  var raw=e && e.parameter && e.parameter.payload,p;
  try { p=JSON.parse(raw); } catch (_) { return null; }
  var actions=['listOsProjects','listOsMembers','listOsOperacional','detailOsOperacional','createOsOperacional','assignOsOperacional','advanceOsOperacional','reopenOsOperacional','listRooms','logout','listWorkOrders'];
  if(!p || actions.indexOf(p.action)<0) return null;
  try {
    if(typeof raw!=='string' || raw.length>8192) fail_('Requisição inválida.');
    if(p.action==='logout') {CacheService.getScriptCache().remove('token_'+requireToken_(p.token));return jsonResponse_({ok:true});}
    var user=osSession_(p.token);
    if(p.action==='listWorkOrders') fail_('Importação da fonte legada não configurada neste piloto.','OS_NOT_CONFIGURED');
    if(p.action==='listRooms') {var rooms=readSalas_(getSheet_());return jsonResponse_({ok:true,salas:rooms.salas,atualizadoEm:rooms.atualizadoEm,totalSalas:rooms.salas.length});}
    if(p.action==='listOsProjects') return jsonResponse_({ok:true,projects:projetosOS_(user)});
    if(p.action==='listOsMembers') return jsonResponse_({ok:true,members:membrosOS_(user,p.projetoId)});
    if(p.action==='listOsOperacional') return jsonResponse_({ok:true,workOrders:listarOsOperacional_(user,p.projetoId)});
    if(p.action==='detailOsOperacional') return jsonResponse_({ok:true,workOrder:detalheOsOperacional_(user,p.projetoId,p.osId)});
    var result;
    if(p.action==='createOsOperacional') result=criarOsOperacional_(user,p);
    if(p.action==='assignOsOperacional') result=atribuirResponsavelOS_(user,p);
    if(p.action==='advanceOsOperacional') result=avancarStatusOS_(user,p);
    if(p.action==='reopenOsOperacional') result=reabrirOsOperacional_(user,p);
    return jsonResponse_({ok:true,workOrder:result});
  } catch(err) {return jsonResponse_({ok:false,code:err.publicCode||'REQUEST_FAILED',erro:err.publicMessage||'Não foi possível concluir a operação.'});}
}
`;
const pilotHtml=fs.readFileSync('integration/private-pilot.html','utf8').replace('<!--PILOT_STYLES-->','<style>'+fs.readFileSync('src/central/App.css','utf8')+'\n'+fs.readFileSync('integration/private-pilot.css','utf8')+'</style>').replace('<!--PILOT_LOGO-->','data:image/jpeg;base64,'+fs.readFileSync('src/central/rsf-logo.jpeg').toString('base64'));
const pilotBridge=fs.readFileSync('integration/private-pilot-bridge.gs','utf8');
const result=base.replace('function doGet(e) {','function doGet(e) {\n  if(e && e.parameter && e.parameter.pilot === "1") return HtmlService.createHtmlOutput(privatePilotHtml_()).setTitle("RSF - teste privado OS");').replace('function doPost(e) {','function doPost(e) {\n  var osResponse=routeOsRequest_(e); if(osResponse) return osResponse;')+'\n'+constants+'\n'+helpers+'\n'+routes+'\n'+ledger+'\n'+pilotBridge+'\nfunction privatePilotHtml_(){return '+JSON.stringify(pilotHtml)+';}\n';
fs.mkdirSync('integration',{recursive:true});fs.writeFileSync('integration/Code.production-compatible.gs',result);
function extract(source,name) { const start=source.indexOf('function '+name+'(');const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?undefined:end).replace(/\r/g,'').trim(); }
for(const name of ['login_','session_','hash_','safeEqual_','enter_','exit_']) {
  if(extract(base,name)!==extract(result,name)) throw Error('Original function changed: '+name);
}
console.log('Generated integration/Code.production-compatible.gs; original authentication and field write functions unchanged. No deployment.');
