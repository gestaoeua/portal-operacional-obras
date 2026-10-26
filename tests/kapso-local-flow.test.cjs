const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createLocalServer,PROJECT}=require('./kapso-local-server.cjs');
const {localTestStore}=require('../integration/kapso/local-test-store.cjs');
function file(){return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rsf-kapso-test-')),'synthetic.sqlite');}
test('HTTP synthetic ingress → durable draft → human review → existing OS API; replay and independent process reread',async()=>{
 const dbfile=file(),app=createLocalServer(dbfile);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+app.server.address().port;
 const call=async(p)=>{const r=await fetch(url,{method:'POST',body:new URLSearchParams({payload:JSON.stringify({token:'fixture-kapso',projetoId:PROJECT,...p})})});return r.json();};
 try{
  assert.equal((await call({action:'listKapsoDrafts',token:'invalid'})).code,'SESSION_EXPIRED');
  assert.equal((await call({action:'simulateKapsoMessage',projetoId:'other'})).code,'PROJECT_FORBIDDEN');
  assert.equal((await call({action:'simulateKapsoMessage'})).ok,true);
  await call({action:'simulateKapsoMessage'});
  const drafts=(await call({action:'listKapsoDrafts'})).drafts;assert.equal(drafts.length,1);assert.equal(drafts[0].osId,null);
  assert.equal((await call({action:'listOsOperacional'})).workOrders.length,0);
  const cmd={action:'approveKapsoDraft',draftKey:drafts[0].dedupeKey,requestId:'fixture-request-1',escopo:'FIXTURE escopo revisado'};
  const a=await call(cmd),replay=await call(cmd);assert.deepEqual(replay,a);assert.equal(a.workOrder.status,'Recebida');assert.equal(a.workOrder.responsavel,'');assert.equal(a.workOrder.historico.length,1);
  assert.equal((await call({...cmd,escopo:'FIXTURE different'})).code,'REQUEST_ID_CONFLICT');
  assert.equal((await call({...cmd,requestId:'fixture-request-2'})).code,'DRAFT_ALREADY_REVIEWED');
  assert.equal((await call({action:'listKapsoDrafts'})).drafts[0].osId,a.workOrder.osId);
  assert.equal((await call({action:'detailOsOperacional',osId:a.workOrder.osId})).workOrder.historico.length,1);
  const foreign=await fetch(url,{method:'POST',headers:{Origin:'https://external.invalid'},body:'payload={}'});assert.equal(foreign.status,403);
  const noWebhook=await fetch(url+'/webhook',{method:'POST',body:'{}'});assert.equal(noWebhook.status,403);
 }finally{await new Promise(r=>app.server.close(r));app.store.close();}
 const code=`const {localTestStore,PROJECT}=require(${JSON.stringify(path.resolve(__dirname,'../integration/kapso/local-test-store.cjs'))});const s=localTestStore(process.argv[1]);console.log(JSON.stringify({drafts:s.list(PROJECT).length,orders:s.orders(PROJECT).length,history:s.orders(PROJECT)[0].historico.length}));s.close();`;
 assert.deepEqual(JSON.parse(execFileSync(process.execPath,['-e',code,dbfile],{encoding:'utf8'})),{drafts:1,orders:1,history:1});
});
test('SQLite shares dedupe across instances, preserves conflicts and refuses cross-project reads/writes',async()=>{
 const f=file(),a=localTestStore(f),b=localTestStore(f),draft={projetoId:PROJECT,textoBruto:'FIXTURE'};
 try{await a.enqueueRascunho('fixed-key',draft,'hash1');assert.equal((await b.enqueueRascunho('fixed-key',draft,'hash1')).novo,false);await b.enqueueRascunho('fixed-key',draft,'changed');assert.equal(a.quarantineCount(),1);assert.equal(a.list(PROJECT).length,1);assert.throws(()=>a.list('other'),/PROJECT_FORBIDDEN/);await assert.rejects(()=>a.enqueueRascunho('other',{projetoId:'other'},'hash'),/PROJECT_FORBIDDEN/);assert.throws(()=>a.approve(PROJECT,'absent','request-1','FIXTURE scope'),/DRAFT_NOT_FOUND/);assert.equal(a.orders(PROJECT).length,0);}finally{a.close();b.close();}
});
test('unavailable SQLite never acknowledges synthetic receipt',async()=>{
 const app=createLocalServer(file());app.store.close();
 const result=await app.route({action:'simulateKapsoMessage',token:'fixture-kapso',projetoId:PROJECT});
 assert.equal(result.ok,false);assert.equal(result.result.status,'falha_armazenamento');
});
