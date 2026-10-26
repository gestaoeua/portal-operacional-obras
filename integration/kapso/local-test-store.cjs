'use strict';
// LOCAL SYNTHETIC TEST STORAGE ONLY. Not a production authentication boundary.
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const PROJECT='PILOTO_FICTICIO_KAPSO';
function localTestStore(file){
 const db=new DatabaseSync(file);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS drafts(key TEXT PRIMARY KEY, project TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quarantine(id INTEGER PRIMARY KEY, reason TEXT NOT NULL, detail TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS approvals(request TEXT PRIMARY KEY, draft TEXT UNIQUE NOT NULL, command TEXT NOT NULL, body TEXT NOT NULL);`);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function permit(project){if(project!==PROJECT)throw Error('PROJECT_FORBIDDEN');}
 return {
  async enqueueRascunho(key,draft,hash){permit(draft.projetoId);return transaction(()=>{
   const old=db.prepare('SELECT * FROM drafts WHERE key=?').get(key);
   if(old){if(old.hash!==hash)db.prepare('INSERT INTO quarantine(reason,detail) VALUES(?,?)').run('conflito_dedup_conteudo_diferente',JSON.stringify({key}));return {novo:false,rascunho:JSON.parse(old.body)};}
   db.prepare('INSERT INTO drafts VALUES(?,?,?,?)').run(key,draft.projetoId,hash,JSON.stringify(draft));return {novo:true,rascunho:structuredClone(draft)};
  });},
  async quarentenar(reason,detail){db.prepare('INSERT INTO quarantine(reason,detail) VALUES(?,?)').run(reason,JSON.stringify(detail));},
  list(project){permit(project);return db.prepare('SELECT d.body,a.body AS approval FROM drafts d LEFT JOIN approvals a ON d.key=a.draft WHERE d.project=? ORDER BY d.rowid').all(project).map(r=>({...JSON.parse(r.body),osId:r.approval?JSON.parse(r.approval).osId:null}));},
  approve(project,key,request,scope){permit(project);if(typeof request!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(request)||typeof scope!=='string'||scope.trim().length<3||scope.length>2048)throw Error('INVALID_COMMAND');
   const command=JSON.stringify({project,key,scope:scope.trim()});
   return transaction(()=>{
    const replay=db.prepare('SELECT * FROM approvals WHERE request=?').get(request);
    if(replay){if(replay.command!==command)throw Error('REQUEST_ID_CONFLICT');return JSON.parse(replay.body);}
    const draft=db.prepare('SELECT * FROM drafts WHERE key=? AND project=?').get(key,project);if(!draft)throw Error('DRAFT_NOT_FOUND');
    const existing=db.prepare('SELECT body FROM approvals WHERE draft=?').get(key);if(existing)throw Error('DRAFT_ALREADY_REVIEWED');
    const stamp=new Date().toISOString(),osId='LOCAL-KAPSO-'+createHash('sha256').update(key).digest('hex').slice(0,16);
    const order={osId,projetoId:project,escopo:scope.trim(),status:'Recebida',responsavel:'',revisao:1,atualizadoEm:stamp,sourceDraftKey:key,historico:[{RequestId:request,TipoEvento:'CRIADA_DE_RASCUNHO_SINTETICO',StatusNovo:'Recebida',UsuarioId:'fixture',CriadoEm:stamp,Motivo:'Revisão humana local; não despachada',ResponsavelNovo:'',Revisao:'1'}]};
    db.prepare('INSERT INTO approvals VALUES(?,?,?,?)').run(request,key,command,JSON.stringify(order));return order;
   });
  },
  orders(project){permit(project);return db.prepare('SELECT body FROM approvals ORDER BY rowid').all().map(r=>JSON.parse(r.body)).filter(o=>o.projetoId===project);},
  quarantineCount(){return db.prepare('SELECT count(*) n FROM quarantine').get().n;},
  close(){db.close();}
 };
}
module.exports={localTestStore,PROJECT};
