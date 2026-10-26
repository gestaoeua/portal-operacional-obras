'use strict';
// NEVER DEPLOY: loopback-only, fixed synthetic message, no real webhook endpoint.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {localTestStore,PROJECT}=require('../integration/kapso/local-test-store.cjs');
const {processarEntregaWebhook}=require('../integration/kapso/webhook.cjs');
const SECRET='PUBLIC_SYNTHETIC_FIXTURE_ONLY_NOT_A_CREDENTIAL';
const payload={phone_number_id:'fixture-phone',message:{id:'fixture-message-001',from:'fixture-sender',timestamp:'1792713600',type:'text',text:{body:'FIXTURE: revisar pintura do local fictício. Endereço, equipe e horário ainda não informados.'},kapso:{direction:'inbound',origin:'cloud_api'}},conversation:{id:'fixture-conversation'}};
function createLocalServer(file){
 const store=localTestStore(file);
 async function route(p){
  if(p.action==='login')return p.username==='fixture'&&p.password==='fixture'?{ok:true,session:{token:'fixture-kapso',userId:'fixture',name:'SIMULAÇÃO KAPSO LOCAL',role:'gestor'}}:{ok:false,code:'AUTH_REQUIRED'};
  if(p.token!=='fixture-kapso')return {ok:false,code:'SESSION_EXPIRED'};
  if(p.action==='logout')return {ok:true};
  if(p.action==='listRooms')return {ok:true,salas:[]};
  if(p.action==='listVisits')return {ok:true,visits:[]};
  if(p.action==='listOsProjects')return {ok:true,projects:[{id:PROJECT,name:'Kapso — projeto fictício local'}]};
  if(p.projetoId!==PROJECT)return {ok:false,code:'PROJECT_FORBIDDEN'};
  if(p.action==='listOsMembers')return {ok:true,members:[]};
  if(p.action==='listKapsoDrafts')return {ok:true,projetoId:PROJECT,drafts:store.list(PROJECT),source:'synthetic-local-sqlite'};
  if(p.action==='simulateKapsoMessage'){
   const rawBody=Buffer.from(JSON.stringify(payload));
   const result=await processarEntregaWebhook({headers:{'X-Webhook-Event':'whatsapp.message.received','X-Webhook-Signature':crypto.createHmac('sha256',SECRET).update(rawBody).digest('hex')},rawBody},{webhookSecret:SECRET,vinculosPermitidos:[{phoneNumberId:'fixture-phone',senderField:'from',senderValue:'fixture-sender',projetoId:PROJECT}]},store);
   return {ok:result.status==='ok',result};
  }
  if(p.action==='approveKapsoDraft')return {ok:true,workOrder:store.approve(PROJECT,p.draftKey,p.requestId,p.escopo)};
  if(p.action==='listOsOperacional')return {ok:true,readOnly:true,workOrders:store.orders(PROJECT)};
  if(p.action==='detailOsOperacional'){const workOrder=store.orders(PROJECT).find(o=>o.osId===p.osId);return workOrder?{ok:true,workOrder}:{ok:false,code:'NOT_FOUND'};}
  return {ok:false,code:'FIXTURE_MODULE_NOT_ENABLED'};
 }
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5175');res.setHeader('Vary','Origin');
  if(req.method!=='POST'||req.url!=='/'||req.headers.host!==`127.0.0.1:${server.address().port}`||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5175')){res.writeHead(403);res.end('{"ok":false}');return;}
  let body='';req.on('data',b=>{body+=b;if(body.length>12000)req.destroy();});req.on('end',async()=>{try{res.end(JSON.stringify(await route(JSON.parse(new URLSearchParams(body).get('payload')))));}catch(e){const known=['REQUEST_ID_CONFLICT','DRAFT_ALREADY_REVIEWED','INVALID_COMMAND','DRAFT_NOT_FOUND','PROJECT_FORBIDDEN'];res.end(JSON.stringify({ok:false,code:known.includes(e.message)?e.message:'WRITE_UNCONFIRMED',erro:'Resultado não confirmado. Releia antes de repetir.'}));}});
 });
 return {server,store,route};
}
if(require.main===module){const dir=path.resolve(__dirname,'../../test-temp');fs.mkdirSync(dir,{recursive:true});createLocalServer(path.join(dir,'kapso-synthetic.sqlite')).server.listen(8796,'127.0.0.1',()=>console.log('SYNTHETIC ONLY http://127.0.0.1:8796; fixture / fixture; no external webhook'));}
module.exports={createLocalServer,PROJECT,payload};
