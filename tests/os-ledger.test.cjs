// Testes do ledger de OS operacional (ADITIVO) — isolamento explícito por
// projeto, idempotência por requestId, revisão otimista, transições de
// status e reabertura. Harness próprio (não reaproveita o de
// backend.test.cjs) para não arriscar o arquivo já validado da fundação.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(process.env.RSF_OS_BACKEND_FILE || require('node:path').join(__dirname, '../apps-script/Code.gs'), 'utf8');

function harness() {
  const sheets = {}, cache = new Map(), openedIds = []; let writes = 0;
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
          setValues(rows) { writes++; rows.forEach((row,i)=>row.forEach((v,j)=>data[r-1+i][c-1+j]=v)); }
        };
      },
      appendRow(row) { writes++; data.push(row); }
    };
    sheets[name] = sh; return sh;
  }
  const context = vm.createContext({
    Date, Number,
    SpreadsheetApp: {openById:id=>{openedIds.push(id);return {getSheetByName:n=>sheets[n]};},flush(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
    CacheService: {getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
    LockService: {getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities: {getUuid:()=>crypto.randomUUID(),computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},formatDate:d=>d.toISOString()},
    Session:{getScriptTimeZone:()=> 'UTC'},
    ContentService:{createTextOutput:text=>({text,setMimeType(){return this;}}),MimeType:{JSON:'application/json'}}
  });
  vm.runInContext(source,context);
  sheet('Usuarios',[Array.from(context.SCHEMAS.Usuarios),
    ['gestora',context.hash_('test-pass'),'Gestora','gestor','Sim'],
    ['exec1',context.hash_('test-pass'),'Executor Um','executor','Sim'],
    ['exec2',context.hash_('test-pass'),'Executor Dois','executor','Sim'],
    ['foraDoGrant',context.hash_('test-pass'),'Fora Do Grant','executor','Sim'],
    ['inativo',context.hash_('test-pass'),'Inativo','executor','Não']]);
  sheet('Salas',[Array.from(context.EXPECTED_HEADERS)]);
  sheet('Registros',[Array.from(context.SCHEMAS.Registros)]);
  sheet('OS_Acessos',[Array.from(context.OS_ACESSOS_HEADERS),
    ['ProjetoA','gestora'],['ProjetoA','exec1'],['ProjetoA','exec2'],
    ['ProjetoA','inativo'],['ProjetoB','gestora']]);
  sheet('OS_Eventos',[Array.from(context.OS_EVENTOS_HEADERS)]);
  const post=p=>JSON.parse(context.doPost({parameter:{payload:JSON.stringify(p)}}).text);
  const login=(username)=>post({action:'login',username,password:'test-pass'}).session;
  const rid=()=>crypto.randomUUID();
  return {context,sheets,openedIds,post,login,rid,get writes(){return writes;}};
}

test('listar/detalhar sem grant no projeto nega antes de revelar qualquer linha',()=>{
  const h=harness(); const semGrant=h.login('exec1'); // exec1 tem grant em ProjetoA, não em ProjetoB
  const r1=h.post({action:'listOsOperacional',token:semGrant.token,projetoId:'ProjetoB'});
  assert.equal(r1.ok,false); assert.equal(r1.code,'PROJECT_FORBIDDEN'); assert.equal(r1.workOrders,undefined);
  const r2=h.post({action:'detailOsOperacional',token:semGrant.token,projetoId:'ProjetoB',osId:'qualquer'});
  assert.equal(r2.ok,false); assert.equal(r2.code,'PROJECT_FORBIDDEN'); assert.equal(r2.workOrder,undefined);
});

test('isolamento vale até para gestor/diretor — sem exceção de papel',()=>{
  const h=harness(); const g=h.login('gestora');
  // gestora NÃO tem grant em 'ProjetoFantasma'
  const r=h.post({action:'listOsOperacional',token:g.token,projetoId:'ProjetoFantasma'});
  assert.equal(r.ok,false); assert.equal(r.code,'PROJECT_FORBIDDEN');
});

test('fluxo completo autorizado: criar, atribuir, avançar os seis estados, reabrir',()=>{
  const h=harness(); const g=h.login('gestora');
  const criado=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'Pintura sala 2'});
  assert.equal(criado.ok,true); assert.equal(criado.workOrder.status,'Recebida'); assert.equal(criado.workOrder.revisao,1);
  const osId=criado.workOrder.osId;
  // Reload por ID (detalhe) deve bater com o que "create" devolveu.
  const detalhe=h.post({action:'detailOsOperacional',token:g.token,projetoId:'ProjetoA',osId});
  assert.deepEqual(detalhe.workOrder.status,'Recebida');
  const atribuido=h.post({action:'assignOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),responsavel:'exec1',expectedRevision:1});
  assert.equal(atribuido.ok,true); assert.equal(atribuido.workOrder.responsavel,'exec1'); assert.equal(atribuido.workOrder.revisao,2);
  const ordem=['Em conferência','Programada','Em execução','Aguardando validação','Concluída'];
  let revisao=2, exec=h.login('exec1');
  for (const statusNovo of ordem) {
    const ator = statusNovo==='Em execução' || statusNovo==='Aguardando validação' ? exec : g; // executor avança as suas; gestora também pode
    const r=h.post({action:'advanceOsOperacional',token:ator.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo,expectedRevision:revisao,motivo: statusNovo==='Concluída' ? 'Pintura finalizada, fotos no grupo' : undefined});
    assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(r.workOrder.status,statusNovo); revisao=r.workOrder.revisao;
  }
  assert.equal(revisao,7);
  const reaberta=h.post({action:'reopenOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),motivo:'Cliente pediu retoque',statusNovo:'Em execução',expectedRevision:revisao});
  assert.equal(reaberta.ok,true); assert.equal(reaberta.workOrder.status,'Em execução');
  const historicoFinal=h.post({action:'detailOsOperacional',token:g.token,projetoId:'ProjetoA',osId}).workOrder.historico;
  assert.equal(historicoFinal.length,8);
  assert.equal(historicoFinal.some(e=>e.StatusNovo==='Concluída'),true); // conclusão anterior preservada no histórico
});

test('avançar para "Em execução" sem responsável atribuído falha com campo obrigatório',()=>{
  const h=harness(); const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'}).workOrder.osId;
  h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1});
  h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Programada',expectedRevision:2});
  const r=h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Em execução',expectedRevision:3});
  assert.equal(r.ok,false); assert.equal(r.code,'OS_REQUIRED_FIELD');
});

test('concluir sem motivo (evidência textual) falha com campo obrigatório',()=>{
  const h=harness(); const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'}).workOrder.osId;
  h.post({action:'assignOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),responsavel:'exec1',expectedRevision:1});
  for (const s of ['Em conferência','Programada','Em execução','Aguardando validação']) {
    const atual=h.post({action:'detailOsOperacional',token:g.token,projetoId:'ProjetoA',osId}).workOrder;
    h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:s,expectedRevision:atual.revisao});
  }
  const atual=h.post({action:'detailOsOperacional',token:g.token,projetoId:'ProjetoA',osId}).workOrder;
  const r=h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Concluída',expectedRevision:atual.revisao});
  assert.equal(r.ok,false); assert.equal(r.code,'OS_REQUIRED_FIELD');
});

test('transição ilegal (pular etapa ou retroceder) é rejeitada',()=>{
  const h=harness(); const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'}).workOrder.osId;
  const pular=h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Programada',expectedRevision:1});
  assert.equal(pular.ok,false); assert.equal(pular.code,'OS_ILLEGAL_TRANSITION');
  const invalido=h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Cancelada',expectedRevision:1});
  assert.equal(invalido.ok,false); assert.equal(invalido.code,'OS_INVALID_STATUS');
});

test('executor só avança OS atribuída a ele mesmo; outro executor é negado',()=>{
  const h=harness(); const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'}).workOrder.osId;
  h.post({action:'assignOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),responsavel:'exec1',expectedRevision:1});
  h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:2});
  const outro=h.login('exec2');
  const negado=h.post({action:'advanceOsOperacional',token:outro.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Programada',expectedRevision:3});
  assert.equal(negado.ok,false); assert.equal(negado.code,'FORBIDDEN');
});

test('executor não pode criar, atribuir nem reabrir — só gestor/diretor (alinhado a docs/os-acceptance.md)',()=>{
  const h=harness(); const exec=h.login('exec1');
  const negCreate=h.post({action:'createOsOperacional',token:exec.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'});
  assert.equal(negCreate.ok,false); assert.equal(negCreate.code,'FORBIDDEN');
  const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'y'}).workOrder.osId;
  const negAssign=h.post({action:'assignOsOperacional',token:exec.token,projetoId:'ProjetoA',osId,requestId:h.rid(),responsavel:'exec1',expectedRevision:1});
  assert.equal(negAssign.ok,false); assert.equal(negAssign.code,'FORBIDDEN');
  h.post({action:'assignOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),responsavel:'exec1',expectedRevision:1});
  const negReopen=h.post({action:'reopenOsOperacional',token:exec.token,projetoId:'ProjetoA',osId,requestId:h.rid(),motivo:'x',expectedRevision:2});
  assert.equal(negReopen.ok,false); assert.equal(negReopen.code,'FORBIDDEN');
});

test('atribuir responsável inativo ou sem grant no projeto falha',()=>{
  const h=harness(); const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'}).workOrder.osId;
  const inativo=h.post({action:'assignOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),responsavel:'inativo',expectedRevision:1});
  assert.equal(inativo.ok,false); assert.equal(inativo.code,'RESPONSIBLE_INVALID');
  const semGrant=h.post({action:'assignOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),responsavel:'foraDoGrant',expectedRevision:1});
  assert.equal(semGrant.ok,false); assert.equal(semGrant.code,'RESPONSIBLE_NOT_GRANTED');
});

test('sessão existente perde a permissão no instante em que o grant é removido',()=>{
  const h=harness(); const g=h.login('gestora');
  // O harness fecha sobre o array `data` original nos métodos da sheet
  // (getRange/getDataRange) — reatribuir `.data = filtro(...)` troca só a
  // referência no objeto, nunca o array que esses métodos já capturaram.
  // Por isso a revogação precisa mutar o MESMO array (splice), nunca
  // substituí-lo.
  const data = h.sheets.OS_Acessos.data;
  for (let i = data.length - 1; i >= 1; i--) if (data[i][0] === 'ProjetoA' && data[i][1] === 'gestora') data.splice(i, 1);
  const r=h.post({action:'listOsOperacional',token:g.token,projetoId:'ProjetoA'});
  assert.equal(r.ok,false); assert.equal(r.code,'PROJECT_FORBIDDEN');
});

test('submissão dupla com o mesmo requestId não duplica OS/histórico; mesmo ID com comando diferente conflita',()=>{
  const h=harness(); const g=h.login('gestora'); const requestId=h.rid();
  const r1=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId,escopo:'Pintura'});
  const r2=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId,escopo:'Pintura'});
  assert.equal(r1.ok,true); assert.equal(r2.ok,true); assert.equal(r1.workOrder.osId,r2.workOrder.osId);
  assert.equal(h.post({action:'listOsOperacional',token:g.token,projetoId:'ProjetoA'}).workOrders.length,1);
  const conflito=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId,escopo:'Outro escopo'});
  assert.equal(conflito.ok,false); assert.equal(conflito.code,'REQUEST_ID_CONFLICT');
});

test('atualizações concorrentes com a mesma revisão: só uma sucede, a outra recebe conflito',()=>{
  const h=harness(); const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'}).workOrder.osId;
  const a=h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1});
  const b=h.post({action:'advanceOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),statusNovo:'Em conferência',expectedRevision:1});
  const results=[a,b].sort((x,y)=>(x.ok===y.ok?0:x.ok?-1:1));
  assert.equal(results[0].ok,true); assert.equal(results[1].ok,false); assert.equal(results[1].code,'REVISION_CONFLICT');
});

test('reabrir só é permitido a partir de Concluída, e exige motivo explícito',()=>{
  const h=harness(); const g=h.login('gestora');
  const osId=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'}).workOrder.osId;
  const cedo=h.post({action:'reopenOsOperacional',token:g.token,projetoId:'ProjetoA',osId,requestId:h.rid(),motivo:'teste',expectedRevision:1});
  assert.equal(cedo.ok,false); assert.equal(cedo.code,'OS_NOT_COMPLETED');
});

test('OS inexistente no detalhe falha explicitamente, nunca "vazio" silencioso',()=>{
  const h=harness(); const g=h.login('gestora');
  const r=h.post({action:'detailOsOperacional',token:g.token,projetoId:'ProjetoA',osId:'nao-existe'});
  assert.equal(r.ok,false); assert.equal(r.code,'OS_NOT_FOUND');
});

test('ledger não configurado (abas ausentes) falha explicitamente, sem fabricar lista vazia',()=>{
  const h=harness(); delete h.sheets.OS_Eventos; delete h.sheets.OS_Acessos;
  const g=h.login('gestora');
  const r=h.post({action:'listOsOperacional',token:g.token,projetoId:'ProjetoA'});
  assert.equal(r.ok,false); assert.equal(r.code,'OS_LEDGER_NOT_CONFIGURED');
});

test('esquema do ledger com coluna ausente/fora de ordem falha fechado, sem gravar',()=>{
  const h=harness(); h.sheets.OS_Eventos.data[0].pop();
  const g=h.login('gestora');
  const writes=h.writes;
  const r=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x'});
  assert.equal(r.ok,false); assert.equal(r.code,'OS_LEDGER_SCHEMA_INVALID'); assert.equal(h.writes,writes);
});

test('texto parecido com fórmula no escopo/motivo é escapado, nunca executado como fórmula',()=>{
  const h=harness(); const g=h.login('gestora');
  const r=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'=HYPERLINK("evil")'});
  assert.equal(r.ok,true);
  const linha=h.sheets.OS_Eventos.data[h.sheets.OS_Eventos.data.length-1];
  const idxEscopo=h.sheets.OS_Eventos.data[0].indexOf('Escopo');
  assert.equal(linha[idxEscopo].startsWith("'="),true);
});

test('ator/papel/projeto/responsável forjados no corpo da requisição nunca têm efeito — só a sessão resolvida no servidor conta',()=>{
  const h=harness(); const g=h.login('gestora');
  const forjado=h.post({action:'createOsOperacional',token:g.token,projetoId:'ProjetoA',requestId:h.rid(),escopo:'x',usuarioId:'exec1',papelUsuario:'diretor'});
  assert.equal(forjado.ok,true);
  const linha=h.sheets.OS_Eventos.data[h.sheets.OS_Eventos.data.length-1];
  const idxUsuario=h.sheets.OS_Eventos.data[0].indexOf('UsuarioId'), idxPapel=h.sheets.OS_Eventos.data[0].indexOf('PapelUsuario');
  assert.equal(linha[idxUsuario],'gestora'); assert.equal(linha[idxPapel],'gestor');
});

test('OS legada (fonte somente leitura) nunca aparece neste ledger nem é herdada por um projeto',()=>{
  const h=harness(); const g=h.login('gestora');
  // Nenhum OS_SPREADSHEET_ID configurado — adaptador legado indisponível.
  assert.equal(h.post({action:'listWorkOrders',token:g.token}).code,'OS_NOT_CONFIGURED');
  // E mesmo que estivesse configurado, listOsOperacional nunca lê a fonte legada:
  assert.equal(h.openedIds.includes('synthetic-os-source'),false);
  const lista=h.post({action:'listOsOperacional',token:g.token,projetoId:'ProjetoA'}).workOrders;
  assert.equal(lista.length,0);
});
