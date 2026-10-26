const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../apps-script/Code.gs'), 'utf8');
function harness() {
  const sheets = {}, osSheets = {}, cache = new Map(), properties = {}, openedIds = [], events = []; let failFlush = false; let writes = 0, readCalls = 0, failWriteAt = 0;
  function sheet(name, data) {
    const sh = {
      data,
      getLastRow: () => data.length,
      getLastColumn: () => data[0]?.length || 0,
      getDataRange: () => sh.getRange(1,1,data.length,data[0]?.length || 0),
      getRange(r,c,nr=1,nc=1) {
        return {
          getValues: () => data.slice(r-1,r-1+nr).map(row => row.slice(c-1,c-1+nc)),
          getDisplayValues: () => data.slice(r-1,r-1+nr).map(row => row.slice(c-1,c-1+nc).map(String)),
          setValue(v) { return this.setValues([[v]]); },
          setValues(rows) { writes++; if (writes===failWriteAt) throw Error('private service error'); rows.forEach((row,i)=>row.forEach((v,j)=>data[r-1+i][c-1+j]=v)); }
        };
      },
      appendRow(row) { events.push("append"); writes++; data.push(row); }
    };
    sheets[name] = sh; return sh;
  }
  const context = vm.createContext({
    Date, Number,
    SpreadsheetApp: {openById:id=>{readCalls++;openedIds.push(id);return {getSheetByName:n=>(id==='synthetic-os-source'?osSheets:sheets)[n]};},flush(){events.push('flush');if(failFlush)throw Error('private flush error');}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties[k]||null})},
    CacheService: {getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
    LockService: {getScriptLock:()=>({waitLock(){events.push('lock');},releaseLock(){events.push('release');}})},
    Utilities: {getUuid:()=>crypto.randomUUID(),computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},formatDate:d=>d.toISOString()},
    Session:{getScriptTimeZone:()=> 'UTC'},
    ContentService:{createTextOutput:text=>({text,setMimeType(){return this;}}),MimeType:{JSON:'application/json'}}
  });
  vm.runInContext(source,context);
  sheet('Usuarios',[Array.from(context.SCHEMAS.Usuarios),['worker',context.hash_('test-pass'),'Worker','executor','Sim'],['boss',context.hash_('test-pass'),'Boss','gestor','Sim']]);
  sheet('Salas',[Array.from(context.EXPECTED_HEADERS),['R1','Room','Paint','pendente','',10,20,'Sim','']]);
  sheet('Registros',[Array.from(context.SCHEMAS.Registros)]);
  const os = sheet('OS',[Array.from(context.OS_HEADERS),['0007','Synthetic address','Test city','Aberta','Paint','Keep fixtures','Await access','No uploads','01/10/2026']]);
  delete sheets.OS; osSheets.OS = os;
  const post=p=>JSON.parse(context.doPost({parameter:{payload:JSON.stringify(p)}}).text);
  const login=(username='worker')=>post({action:'login',username,password:'test-pass'}).session;
  return {context,sheets,osSheets,properties,openedIds,events,cache,post,login,failFlush(){failFlush=true;},get writes(){return writes;},get readCalls(){return readCalls;},failNextWrite(offset=1){failWriteAt=writes+offset;}};
}
test('public GET contains no operational data and never reads the spreadsheet',()=>{
  const h=harness(), result=JSON.parse(h.context.doGet().text);
  assert.equal(result.authenticationRequired,true); assert.equal(result.salas,undefined); assert.equal(h.readCalls,0);
});
test('malformed payloads, unknown actions and malformed tokens fail without writes',()=>{
  const h=harness();
  for(const e of [undefined,{}, {parameter:{payload:'{' }},{parameter:{payload:'null'}},{parameter:{payload:'[]'}}]) assert.equal(JSON.parse(h.context.doPost(e).text).ok,false);
  for(const p of [{action:'delete'}, {action:'listRooms'}, {action:'enter',token:{}}, {action:'login',username:{},password:'x'}]) assert.equal(h.post(p).ok,false);
  assert.equal(h.writes,0);
});
test('rooms and history require valid sessions; session cache contains no hash or role',()=>{
  const h=harness(); assert.equal(h.post({action:'listRooms',token:crypto.randomUUID()}).ok,false);
  const s=h.login(), cached=JSON.parse(h.cache.get('token_'+s.token));
  assert.deepEqual(Object.keys(cached).sort(),['expiresAt','userId']);
  assert.equal(h.post({action:'listRooms',token:s.token}).salas.length,1);
  assert.equal(h.post({action:'listVisits',token:s.token}).visits.length,0);
});
test('disabled accounts, expired sessions, unknown roles and logout revoke access',()=>{
  for(const mode of ['disabled','expired','role','logout']){
    const h=harness(),s=h.login();
    if(mode==='disabled') h.sheets.Usuarios.data[1][4]='Não';
    if(mode==='role') h.sheets.Usuarios.data[1][3]='admin';
    if(mode==='expired') h.cache.set('token_'+s.token,JSON.stringify({userId:'worker',expiresAt:1}));
    if(mode==='logout') assert.equal(h.post({action:'logout',token:s.token}).ok,true);
    assert.equal(h.post({action:'listRooms',token:s.token}).ok,false,mode);
    assert.equal(h.cache.has('token_'+s.token),false);
  }
});
test('role changes take effect immediately; nonexecutors cannot mutate visits',()=>{
  const h=harness(),s=h.login(); h.sheets.Usuarios.data[1][3]='gestor';
  assert.equal(h.post({action:'enter',token:s.token,roomMark:'R1'}).ok,false);
  assert.equal(h.post({action:'listVisits',token:s.token}).ok,true); assert.equal(h.writes,0);
});
test('invalid and duplicate user identities cannot login; failed login throttles',()=>{
  const h=harness(); h.sheets.Usuarios.data[1][3]='root'; assert.equal(h.post({action:'login',username:'worker',password:'test-pass'}).ok,false);
  h.sheets.Usuarios.data[1][3]='executor';h.sheets.Usuarios.data.push([...h.sheets.Usuarios.data[1]]);
  assert.equal(h.post({action:'login',username:'worker',password:'test-pass'}).ok,false);
  for(let i=0;i<8;i++) h.post({action:'login',username:'unknown',password:'bad'});
  assert.match(h.post({action:'login',username:'unknown',password:'bad'}).erro,/Muitas tentativas/);
});
test('single open visit and executor-owned history are enforced',()=>{
  const h=harness(),s=h.login(), visit=h.post({action:'enter',token:s.token,roomMark:'R1'}).visit;
  assert.ok(visit.id); assert.equal(h.post({action:'enter',token:s.token,roomMark:'R1'}).ok,false);
  h.sheets.Registros.data.push([crypto.randomUUID(),'boss','Boss','R1','Room','today','','','']);
  assert.equal(h.post({action:'listVisits',token:s.token}).visits.length,1);
  assert.equal(h.post({action:'listVisits',token:h.login('boss').token}).visits.length,2);
});
test('closed checkouts cannot be replayed or overwrite status/history',()=>{
  const h=harness(),s=h.login(),visit=h.post({action:'enter',token:s.token,roomMark:'R1'}).visit;
  const exit={action:'exit',token:s.token,visitId:visit.id,workAction:'limpeza',finalStatus:'finalizado'};
  assert.equal(h.post(exit).ok,true);const before=JSON.stringify(h.sheets.Registros.data),writes=h.writes;
  assert.equal(h.post({...exit,finalStatus:'pendente'}).ok,false);
  assert.equal(JSON.stringify(h.sheets.Registros.data),before); assert.equal(h.sheets.Salas.data[1][3],'finalizado'); assert.equal(h.writes,writes);
});
test('checkout rejects foreign ownership, bad action and missing room without writes',()=>{
  for(const mode of ['owner','action','room','duplicate']) {
    const h=harness(),s=h.login(),visit=h.post({action:'enter',token:s.token,roomMark:'R1'}).visit;
    if(mode==='owner')h.sheets.Registros.data[1][1]='other';
    if(mode==='room')h.sheets.Salas.data.pop();
    if(mode==='duplicate')h.sheets.Registros.data.push([...h.sheets.Registros.data[1]]);
    const writes=h.writes;
    assert.equal(h.post({action:'exit',token:s.token,visitId:visit.id,workAction:mode==='action'?'=BAD()':'limpeza',finalStatus:'finalizado'}).ok,false);
    assert.equal(h.writes,writes);
  }
});
test('missing, duplicated, reordered or extra headers reject checkout before any write',()=>{
  for(const name of ['Salas','Registros']) for(const mode of ['missing','duplicate','reorder','extra']) {
    const h=harness(),s=h.login(),visit=h.post({action:'enter',token:s.token,roomMark:'R1'}).visit,header=h.sheets[name].data[0];
    if(mode==='missing')header.pop();if(mode==='duplicate')header[1]=header[0];if(mode==='reorder')[header[0],header[1]]=[header[1],header[0]];if(mode==='extra')header.push('Extra');
    const writes=h.writes;
    assert.equal(h.post({action:'exit',token:s.token,visitId:visit.id,workAction:'limpeza',finalStatus:'finalizado'}).ok,false);
    assert.equal(h.writes,writes,`${name} ${mode}`);
  }
});
test('transient mid-checkout write failure rolls state back and hides internals',()=>{
  const h=harness(),s=h.login(),visit=h.post({action:'enter',token:s.token,roomMark:'R1'}).visit;
  const before=JSON.stringify([h.sheets.Salas.data,h.sheets.Registros.data]);h.failNextWrite(3);
  const result=h.post({action:'exit',token:s.token,visitId:visit.id,workAction:'limpeza',finalStatus:'finalizado'});
  assert.equal(result.ok,false); assert.doesNotMatch(result.erro,/private/);
  assert.equal(JSON.stringify([h.sheets.Salas.data,h.sheets.Registros.data]),before);
});
test('header-only room sheet returns a consistent empty response',()=>{
  const h=harness(),s=h.login();h.sheets.Salas.data.pop();
  const result=h.post({action:'listRooms',token:s.token}); assert.equal(result.ok,true);assert.deepEqual(result.salas,[]);assert.equal(result.totalSalas,0);
});

test('work orders deny anonymous and executor access before opening the OS source',()=>{
  const h=harness();h.properties.OS_SPREADSHEET_ID='synthetic-os-source';
  assert.equal(h.post({action:'listWorkOrders'}).code,'SESSION_EXPIRED');
  assert.equal(h.post({action:'listWorkOrders',token:crypto.randomUUID()}).code,'SESSION_EXPIRED');
  assert.equal(h.post({action:'listWorkOrders',token:h.login().token}).code,'FORBIDDEN');
  assert.equal(h.openedIds.includes('synthetic-os-source'),false);assert.equal(h.writes,0);
});
test('work order source configuration is explicit, never a fabricated empty success',()=>{
  const h=harness();const result=h.post({action:'listWorkOrders',token:h.login('boss').token});
  assert.equal(result.ok,false);assert.equal(result.code,'OS_NOT_CONFIGURED');assert.equal(result.workOrders,undefined);
});
test('gestor and diretor read isolated OS source, preserving source IDs and fields without writes',()=>{
  for(const role of ['gestor','diretor']){
    const h=harness();h.properties.OS_SPREADSHEET_ID='synthetic-os-source';h.sheets.Usuarios.data[2][3]=role;
    // A malformed room workbook cannot affect independent OS reads.
    h.sheets.Salas.data[0]=['bad room schema'];h.sheets.Registros.data[0]=['bad visits schema'];
    const result=h.post({action:'listWorkOrders',token:h.login('boss').token});
    assert.equal(result.ok,true);assert.equal(result.workOrders.length,1);
    assert.deepEqual(result.workOrders[0],{id:'0007',address:'Synthetic address',city:'Test city',status:'Aberta',scope:'Paint',protections:'Keep fixtures',dependencies:'Await access',evidenceNotes:'No uploads',updatedAt:'01/10/2026'});
    assert.equal(result.salas,undefined);assert.equal(h.openedIds.filter(id=>id==='synthetic-os-source').length,1);assert.equal(h.writes,0);
  }
});
test('room reads never touch configured OS source',()=>{
  const h=harness();h.properties.OS_SPREADSHEET_ID='synthetic-os-source';h.osSheets.OS.data[0]=['bad OS schema'];
  assert.equal(h.post({action:'listRooms',token:h.login('boss').token}).ok,true);
  assert.equal(h.openedIds.includes('synthetic-os-source'),false);
});
test('OS duplicate IDs, missing IDs and malformed headers fail closed',()=>{
  for(const mode of ['duplicate','missing','schema']){
    const h=harness();h.properties.OS_SPREADSHEET_ID='synthetic-os-source';
    if(mode==='duplicate') h.osSheets.OS.data.push([...h.osSheets.OS.data[1]]);
    if(mode==='missing') h.osSheets.OS.data[1][0]='';
    if(mode==='schema') h.osSheets.OS.data[0][1]='Unexpected';
    const result=h.post({action:'listWorkOrders',token:h.login('boss').token});
    assert.equal(result.ok,false);assert.equal(result.code,{duplicate:'OS_DUPLICATE_ID',missing:'OS_INVALID_ID',schema:'OS_SCHEMA_INVALID'}[mode]);assert.equal(h.writes,0);
  }
});
test('disabled work order reader loses access immediately',()=>{
  const h=harness();h.properties.OS_SPREADSHEET_ID='synthetic-os-source';const s=h.login('boss');h.sheets.Usuarios.data[2][4]='Não';
  assert.equal(h.post({action:'listWorkOrders',token:s.token}).code,'SESSION_EXPIRED');assert.equal(h.openedIds.includes('synthetic-os-source'),false);
});

test('enter flushes the appended row before releasing its script lock',()=>{
  const h=harness(),s=h.login();h.events.length=0;
  assert.equal(h.post({action:'enter',token:s.token,roomMark:'R1'}).ok,true);
  assert.deepEqual(h.events,['lock','append','flush','release']);
});
test('unconfirmed append flush releases lock, returns reconciliation error and does not repeat append',()=>{
  const h=harness(),s=h.login();h.events.length=0;h.failFlush();
  const result=h.post({action:'enter',token:s.token,roomMark:'R1'});
  assert.equal(result.ok,false);assert.equal(result.code,'WRITE_UNCONFIRMED');assert.doesNotMatch(result.erro,/private/);
  assert.deepEqual(h.events,['lock','append','flush','release']);assert.equal(h.sheets.Registros.data.length,2);
  const writes=h.writes;assert.equal(h.post({action:'enter',token:s.token,roomMark:'R1'}).ok,false);assert.equal(h.writes,writes);
});
