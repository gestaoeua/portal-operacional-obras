// Independent regression checks against the same synthetic Apps Script harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = fs.readFileSync(__dirname + '/os-ledger.test.cjs', 'utf8');
const harness = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf("test('")) + '\nreturn harness;')(require, __dirname);
function setup() {
  const h = harness(), g = h.login('gestora');
  const base = {token:g.token, projetoId:'ProjetoA'};
  const create = { ...base, action:'createOsOperacional', requestId:h.rid(), escopo:'FICTICIO: revisão independente' };
  const result = h.post(create); assert.equal(result.ok,true,JSON.stringify(result));
  return {h,base,create,osId:result.workOrder.osId};
}
test('independent: replay after later state changes never appends again', () => {
  const {h,base,create,osId}=setup();
  const change={...base,action:'advanceOsOperacional',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1};
  assert.equal(h.post(change).ok,true);
  const count=h.sheets.OS_Eventos.data.length;
  assert.equal(h.post(create).workOrder.osId,osId);
  assert.equal(h.post(change).ok,true);
  assert.equal(h.sheets.OS_Eventos.data.length,count);
});
test('independent: missing, string and fractional revisions cannot mutate', () => {
  for (const expectedRevision of [undefined,'1',1.5,-1,null]) {
    const {h,base,osId}=setup(); const count=h.sheets.OS_Eventos.data.length;
    assert.equal(h.post({...base,action:'advanceOsOperacional',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision}).ok,false);
    assert.equal(h.sheets.OS_Eventos.data.length,count);
  }
});
test('independent: revoked grant while waiting for lock denies mutation', () => {
  const {h,base,osId}=setup(); const count=h.sheets.OS_Eventos.data.length;
  h.context.LockService.getScriptLock=()=>({waitLock(){
    const rows=h.sheets.OS_Acessos.data;
    for(let i=rows.length-1;i>0;i--) if(rows[i][0]==='ProjetoA'&&rows[i][1]==='gestora') rows.splice(i,1);
  },releaseLock(){}});
  const r=h.post({...base,action:'advanceOsOperacional',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1});
  assert.equal(r.ok,false); assert.equal(r.code,'PROJECT_FORBIDDEN');
  assert.equal(h.sheets.OS_Eventos.data.length,count);
});
test('independent: ambiguous flush failure reconciles via same request id', () => {
  const {h,base,osId}=setup(); let fail=true;
  h.context.SpreadsheetApp.flush=()=>{if(fail) throw new Error('synthetic outage');};
  const command={...base,action:'advanceOsOperacional',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1};
  assert.equal(h.post(command).code,'WRITE_UNCONFIRMED'); fail=false;
  const count=h.sheets.OS_Eventos.data.length;
  assert.equal(h.post(command).ok,true);
  assert.equal(h.sheets.OS_Eventos.data.length,count);
});
test('independent: actor disabled while waiting for lock cannot write', () => {
  const {h,base,osId}=setup(); const count=h.sheets.OS_Eventos.data.length;
  h.context.LockService.getScriptLock=()=>({waitLock(){
    h.sheets.Usuarios.data.find(r=>r[0]==='gestora')[4]='Nao';
  },releaseLock(){}});
  assert.equal(h.post({...base,action:'advanceOsOperacional',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1}).ok,false);
  assert.equal(h.sheets.OS_Eventos.data.length,count);
});
test('independent: corrupt duplicate journal revisions fail closed', () => {
  const {h,base,osId}=setup();
  h.sheets.OS_Eventos.data.push([...h.sheets.OS_Eventos.data[1]]);
  assert.equal(h.post({...base,action:'detailOsOperacional',osId}).ok,false);
});
test('independent: project/member discovery exposes only explicit grants and no credential columns', () => {
  const h=harness(), u=h.login('exec1');
  const projects=h.post({action:'listOsProjects',token:u.token});
  assert.deepEqual(projects.projects,[{id:'ProjetoA',name:'ProjetoA'}]);
  assert.equal(h.post({action:'listOsMembers',token:u.token,projetoId:'ProjetoB'}).code,'PROJECT_FORBIDDEN');
  const members=h.post({action:'listOsMembers',token:u.token,projetoId:'ProjetoA'}).members;
  assert.ok(members.every(m=>Object.keys(m).sort().join(',')==='name,role,userId'));
  assert.ok(!members.some(m=>['inativo','foraDoGrant'].includes(m.userId)));
});
test('independent: role downgrade while waiting for lock prevents manager mutation', () => {
  const {h,base,osId}=setup(), count=h.sheets.OS_Eventos.data.length;
  h.context.LockService.getScriptLock=()=>({waitLock(){h.sheets.Usuarios.data.find(r=>r[0]==='gestora')[3]='executor';},releaseLock(){}});
  const response=h.post({...base,action:'assignOsOperacional',osId,requestId:h.rid(),responsavel:'exec1',expectedRevision:1});
  assert.equal(response.code,'FORBIDDEN');assert.equal(h.sheets.OS_Eventos.data.length,count);
});
test('independent: append failure before persistence retries once with original id', () => {
  const {h,base,osId}=setup(), append=h.sheets.OS_Eventos.appendRow;
  const command={...base,action:'advanceOsOperacional',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1};
  h.sheets.OS_Eventos.appendRow=()=>{throw Error('synthetic append failure');};
  assert.equal(h.post(command).code,'WRITE_UNCONFIRMED');assert.equal(h.sheets.OS_Eventos.data.length,2);
  h.sheets.OS_Eventos.appendRow=append;
  assert.equal(h.post(command).ok,true);assert.equal(h.post(command).ok,true);assert.equal(h.sheets.OS_Eventos.data.length,3);
});
test('independent: revoked project denies even an exact replay', () => {
  const {h,create}=setup();const rows=h.sheets.OS_Acessos.data;
  for(let i=rows.length-1;i>0;i--)if(rows[i][0]==='ProjetoA'&&rows[i][1]==='gestora')rows.splice(i,1);
  const result=h.post(create);assert.equal(result.code,'PROJECT_FORBIDDEN');assert.equal(result.workOrder,undefined);
});
test('independent: reopening completed order rejects completed and unknown destinations', () => {
  const {h,base,osId}=setup();let revision=1;
  assert.equal(h.post({...base,action:'assignOsOperacional',osId,requestId:h.rid(),responsavel:'exec1',expectedRevision:revision++}).ok,true);
  for(const statusNovo of ['Em conferência','Programada','Em execução','Aguardando validação','Concluída'])assert.equal(h.post({...base,action:'advanceOsOperacional',osId,requestId:h.rid(),statusNovo,expectedRevision:revision++,motivo:'FICTICIO'}).ok,true);
  const count=h.sheets.OS_Eventos.data.length;
  for(const statusNovo of ['Concluída','desconhecida'])assert.equal(h.post({...base,action:'reopenOsOperacional',osId,requestId:h.rid(),statusNovo,expectedRevision:revision,motivo:'FICTICIO'}).code,'OS_INVALID_STATUS');
  assert.equal(h.sheets.OS_Eventos.data.length,count);
});
