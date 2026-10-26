// NEVER DEPLOY. Synthetic loopback fixture, not real authentication or production storage.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {harness}=require('./schedule-backend-harness.cjs');
const dir=path.resolve(__dirname,'../../test-temp');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'schedule-fictional-events.jsonl');
function load(){const headers=harness().rows()[0];if(!fs.existsSync(file))return [headers];return [headers,...fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x))];}
function route(p){
 if(p.action==='login')return p.username==='fixture'&&p.password==='fixture'?{ok:true,session:{token:'fixture-manager',userId:'fixture',name:'SIMULAÇÃO LOCAL — dados fictícios',role:'gestor'}}:{ok:false,code:'AUTH_REQUIRED',erro:'Prévia local fictícia: usuário fixture, senha fixture. Não use credenciais reais.'};
 if(p.token!=='fixture-manager')return {ok:false,code:'SESSION_EXPIRED',erro:'Sessão de fixture ausente.'};
 if(p.action==='logout')return {ok:true};
 if(p.action==='listRooms')return {ok:true,salas:[],atualizadoEm:''};
 if(p.action==='listVisits')return {ok:true,visits:[]};
 if(p.action==='listOsProjects')return {ok:true,projects:[{id:'PILOTO_FICTICIO_AGENDA',name:'Agenda fictícia — persistência local, sem planilha real'}]};
 if(p.action==='listOsOperacional')return {ok:true,workOrders:[]};
 if(p.action==='listOsMembers')return {ok:true,members:[]};
 if(!['scheduleList','scheduleSave'].includes(p.action))return {ok:false,code:'FIXTURE_MODULE_NOT_ENABLED',erro:'Módulo indisponível nesta fixture de teste. Nenhuma OS real foi gravada.'};
 const h=harness({rows:load(),persist(rows){fs.appendFileSync(file,JSON.stringify(rows[rows.length-1])+'\n',{encoding:'utf8',flush:true});}});
 return h.request(p);
}
const server=http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5174');res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-RSF-Source','fictional-local-disk');
 if(req.method!=='POST'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5174')){res.writeHead(403);res.end('{"ok":false}');return;}
 let body='';req.on('data',chunk=>{body+=chunk;if(body.length>16000)req.destroy();});req.on('end',()=>{try{res.end(JSON.stringify(route(JSON.parse(new URLSearchParams(body).get('payload')))));}catch{res.writeHead(400);res.end('{"ok":false,"code":"FIXTURE_FAILED","erro":"Falha na fixture local; nenhum resultado confirmado."}');}});
});
if(require.main===module)server.listen(8795,'127.0.0.1',()=>console.log('FICTIONAL LOCAL DISK FIXTURE ONLY: http://127.0.0.1:8795; login fixture / fixture'));
module.exports={route,server,file};
