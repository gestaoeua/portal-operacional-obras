/** RSF API: public GET is metadata only. Data requires an authenticated POST.
 * Legacy password hashes are retained for compatibility, NOT production approval.
 * See docs/backend-security.md before deployment.
 */
var SHEET_NAME = 'Salas';
var SPREADSHEET_ID = '1AZpQKHWns1z4-m7e30vd1CowM4bnqxHuo_aCCLvMizY';
var EXPECTED_HEADERS = ['MARK','Nome','Servico','Status','Observacao','PosicaoX','PosicaoY','Identificada','UltimaAtualizacao'];
var SCHEMAS = {
  Salas: EXPECTED_HEADERS,
  Usuarios: ['Usuario','SenhaHash','Nome','Perfil','Ativo'],
  Registros: ['id','userId','userName','roomMark','roomName','startedAt','endedAt','action','finalStatus']
};
var VALID_ROLES = ['executor','gestor','diretor'];
var VALID_ACTIONS = ['preparacao','primeira_mao','segunda_mao','touch_up','portas','limpeza','inspecao'];
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function getSpreadsheet_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function fail_(message, code) { var e = new Error(message); e.publicMessage = message; e.publicCode = code; throw e; }
function requireText_(value, max, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail_(message);
  return value;
}
function requireToken_(value) { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail_('Sessão inválida. Entre novamente.', 'SESSION_EXPIRED'); return value; }
function doGet() { return jsonResponse_({ok:true, service:'RSF Portal', version:2, authenticationRequired:true}); }
function doPost(e) {
  try {
    var payload = e && e.parameter && e.parameter.payload;
    if (typeof payload !== 'string' || payload.length > 8192) fail_('Requisição inválida.');
    var p;
    try { p = JSON.parse(payload); } catch (_) { fail_('Requisição inválida.'); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail_('Requisição inválida.');
    // ADITIVO (rodada OS operacional): novas ações só de ledger de OS,
    // isoladas por projeto — nunca tocam login_/session_/hash_/safeEqual_.
    var OS_OPERACIONAL_ACOES = ['listOsProjects','listOsMembers','listOsOperacional','detailOsOperacional','createOsOperacional','assignOsOperacional','advanceOsOperacional','reopenOsOperacional'];
    if (['login','logout','listRooms','listVisits','listWorkOrders','enter','exit','quemTrabalhaHoje'].concat(OS_OPERACIONAL_ACOES).indexOf(p.action) < 0) fail_('Operação não reconhecida.');
    if (p.action === 'login') return jsonResponse_({ok:true, session:login_(p.username,p.password)});
    // Logout remains possible even after the user is disabled or their role changes.
    if (p.action === 'logout') { CacheService.getScriptCache().remove('token_' + requireToken_(p.token)); return jsonResponse_({ok:true}); }
    var user = session_(p.token);
    // Somente leitura: ponto do dia no QuickBooks Time, apenas gestor/diretor.
    if (p.action === 'quemTrabalhaHoje') return jsonResponse_({ok:true,hoje:quemTrabalhaHoje_(user,p.periodo)});
    if (p.action === 'listOsProjects') return jsonResponse_({ok:true,projects:projetosOS_(user)});
    if (p.action === 'listOsMembers') return jsonResponse_({ok:true,members:membrosOS_(user,p.projetoId)});
    if (p.action === 'listWorkOrders') {
      if (user.Perfil !== 'gestor' && user.Perfil !== 'diretor') fail_('Perfil sem permissão para esta operação.', 'FORBIDDEN');
      return jsonResponse_({ok:true,workOrders:readWorkOrders_()});
    }
    if (p.action === 'listRooms') {
      var rooms = readSalas_(getSheet_());
      return jsonResponse_({ok:true,salas:rooms.salas,atualizadoEm:rooms.atualizadoEm,totalSalas:rooms.salas.length});
    }
    if (p.action === 'listVisits') {
      var visits = rows_('Registros');
      if (user.Perfil === 'executor') visits = visits.filter(function(v) { return v.userId === user.Usuario; });
      return jsonResponse_({ok:true,visits:visits});
    }
    // Ledger de OS operacional: cada função abaixo já exige grant explícito
    // de projeto (OS_Acessos) para ESTE usuário, mesmo gestor/diretor — ver
    // docs/backend-security.md, seção "OS operacional (ledger)".
    if (p.action === 'listOsOperacional') return jsonResponse_({ok:true,workOrders:listarOsOperacional_(user,p.projetoId)});
    if (p.action === 'detailOsOperacional') return jsonResponse_({ok:true,workOrder:detalheOsOperacional_(user,p.projetoId,p.osId)});
    // As quatro ações abaixo MUTAM o ledger: cada uma reavalia o próprio
    // ator (conta ativa/papel) e o grant de projeto DENTRO do lock, nunca
    // confiando apenas neste `user` anterior — o gate pré-lock é repetido dentro dele.
    if (p.action === 'createOsOperacional') return jsonResponse_({ok:true,workOrder:criarOsOperacional_(user,p)});
    if (p.action === 'assignOsOperacional') return jsonResponse_({ok:true,workOrder:atribuirResponsavelOS_(user,p)});
    if (p.action === 'advanceOsOperacional') return jsonResponse_({ok:true,workOrder:avancarStatusOS_(user,p)});
    if (p.action === 'reopenOsOperacional') return jsonResponse_({ok:true,workOrder:reabrirOsOperacional_(user,p)});
    if (user.Perfil !== 'executor') fail_('Perfil sem permissão para esta operação.', 'FORBIDDEN');
    if (p.action === 'enter') return jsonResponse_({ok:true,visit:enter_(user,p.roomMark)});
    return jsonResponse_({ok:true,visit:exit_(user,p.visitId,p.workAction,p.finalStatus)});
  } catch (err) {
    // Never disclose internal exception messages, sheet IDs or service diagnostics.
    return jsonResponse_({ok:false,code:err.publicCode || 'REQUEST_FAILED',erro:err.publicMessage || 'Não foi possível concluir a operação. Tente novamente ou contate o responsável.'});
  }
}
/** Read-only OS source, independent of the operational room/visit workbook. */
var OS_HEADERS = ['OS','Endereço','Cidade','Status','Escopo','Proteções / Não remover','Dependências / Observações','Evidências','Última atualização'];
function readWorkOrders_() {
  var id = PropertiesService.getScriptProperties().getProperty('OS_SPREADSHEET_ID');
  if (typeof id !== 'string' || !id.trim()) fail_('Fonte de ordens de serviço não configurada.', 'OS_NOT_CONFIGURED');
  var sheet = SpreadsheetApp.openById(id.trim()).getSheetByName('OS');
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() !== OS_HEADERS.length) fail_('Estrutura da fonte de ordens de serviço inválida.', 'OS_SCHEMA_INVALID');
  // Display values preserve source IDs such as leading zeros and formatted text.
  var values = sheet.getDataRange().getDisplayValues(), headers = values[0];
  if (headers.length !== OS_HEADERS.length || OS_HEADERS.some(function(h,i) { return headers[i] !== h; })) fail_('Estrutura da fonte de ordens de serviço inválida.', 'OS_SCHEMA_INVALID');
  var seen = Object.create(null), keys = ['id','address','city','status','scope','protections','dependencies','evidenceNotes','updatedAt'];
  return values.slice(1).filter(function(row) { return row.some(function(v) { return String(v).trim() !== ''; }); }).map(function(row) {
    var sourceId = row[0], canonicalId = sourceId.trim();
    if (!canonicalId) fail_('Ordem de serviço sem identificador.', 'OS_INVALID_ID');
    if (seen[canonicalId]) fail_('Identificador de ordem de serviço duplicado.', 'OS_DUPLICATE_ID');
    seen[canonicalId] = true;
    var result = {}; keys.forEach(function(k,i) { result[k] = row[i]; }); return result;
  });
}
function login_(username,password) {
  username = requireText_(username,128,'Nome ou senha incorretos.').trim().toLowerCase();
  requireText_(password,1024,'Nome ou senha incorretos.');
  var cache = CacheService.getScriptCache(), key = 'attempt_' + hash_(username);
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var count = Number(cache.get(key) || 0);
    if (count >= 8) fail_('Muitas tentativas. Aguarde 10 minutos.');
    var matches = rows_('Usuarios').filter(function(x) { return x.Usuario.trim().toLowerCase() === username; });
    var u = matches.length === 1 ? matches[0] : null;
    var digest = hash_(password);
    if (!u || u.Ativo !== 'Sim' || VALID_ROLES.indexOf(u.Perfil) < 0 || !safeEqual_(u.SenhaHash,digest)) {
      cache.put(key,String(count+1),600); fail_('Nome ou senha incorretos.');
    }
    cache.remove(key);
    var token = Utilities.getUuid();
    cache.put('token_' + token,JSON.stringify({userId:u.Usuario,expiresAt:Date.now()+21600000}),21600);
    return {token:token,userId:u.Usuario,name:u.Nome,role:u.Perfil};
  } finally { lock.releaseLock(); }
}
function session_(token) {
  var cache = CacheService.getScriptCache(), key = 'token_' + requireToken_(token), raw = cache.get(key), saved;
  try { saved = raw && JSON.parse(raw); } catch (_) { saved = null; }
  if (!saved || typeof saved.userId !== 'string' || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now()) {
    cache.remove(key); fail_('Sessão expirada. Entre novamente.', 'SESSION_EXPIRED');
  }
  var users = rows_('Usuarios').filter(function(x) { return x.Usuario === saved.userId; });
  if (users.length !== 1 || users[0].Ativo !== 'Sim' || VALID_ROLES.indexOf(users[0].Perfil) < 0) {
    cache.remove(key); fail_('Sessão inválida. Entre novamente.', 'SESSION_EXPIRED');
  }
  return users[0];
}
/** Exact schema required: missing, duplicate, reordered or unexpected columns fail closed. */
function table_(name, display) {
  var sh = getSpreadsheet_().getSheetByName(name), expected = SCHEMAS[name];
  if (!sh || !expected || sh.getLastRow() < 1 || sh.getLastColumn() !== expected.length) fail_('Estrutura da planilha inválida. Contate o responsável.');
  var range = sh.getDataRange(), values = display ? range.getDisplayValues() : range.getValues(), headers = values[0];
  if (headers.length !== expected.length || expected.some(function(h,i) { return headers[i] !== h; })) fail_('Estrutura da planilha inválida. Contate o responsável.');
  return {sheet:sh,headers:headers,values:values};
}
function rows_(name) {
  var t = table_(name,true);
  return t.values.slice(1).filter(function(r) { return r.some(function(v) { return v !== ''; }); }).map(function(r) {
    var o = {}; t.headers.forEach(function(h,i) { o[h] = r[i]; }); return o;
  });
}
function append_(name,obj) {
  var t = table_(name,false);
  var row = t.headers.map(function(h) {
    var value = obj[h] === undefined ? '' : obj[h];
    // Prevent user-controlled spreadsheet formulas from executing on append.
    if (typeof value === 'string' && /^[=+@-]/.test(value)) value = "'" + value;
    return value;
  });
  t.sheet.appendRow(row);
}
function enter_(user,mark) {
  mark = requireText_(mark,128,'Local inválido.').trim();
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    if (rows_('Registros').some(function(x) { return x.userId === user.Usuario && !x.endedAt; })) fail_('Você já possui um registro aberto.');
    var rooms = readSalas_(getSheet_()).salas.filter(function(x) { return x.MARK === mark; });
    if (rooms.length !== 1) fail_('Local não encontrado ou duplicado.');
    var visit = {id:Utilities.getUuid(),userId:user.Usuario,userName:user.Nome,roomMark:mark,roomName:rooms[0].Nome,startedAt:new Date().toISOString(),endedAt:'',action:'',finalStatus:''};
    try {
      append_('Registros',visit);
      // Commit buffered Sheets changes while the script lock is still held.
      SpreadsheetApp.flush();
    } catch (_) {
      // Append/flush failure can be ambiguous: the row may already exist.
      fail_('Não foi possível confirmar a entrada. Atualize os registros antes de tentar novamente.', 'WRITE_UNCONFIRMED');
    }
    return visit;
  } finally { lock.releaseLock(); }
}
function exit_(user,id,action,status) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) fail_('Registro inválido.');
  if (VALID_ACTIONS.indexOf(action) < 0) fail_('Atividade inválida.');
  if (VALID_STATUSES.indexOf(status) < 0 || status === 'nao_cadastrada') fail_('Status inválido.');
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    // Validate both complete schemas and both targets before the first write.
    var t = table_('Registros',false), rooms = table_(SHEET_NAME,false);
    var indexes = [];
    for (var i=1;i<t.values.length;i++) if (t.values[i][0] === id) indexes.push(i);
    if (indexes.length !== 1) fail_('Registro aberto não encontrado.');
    var index = indexes[0], row = t.values[index];
    if (row[1] !== user.Usuario || row[6]) fail_('Registro aberto não encontrado.');
    var roomIndexes = [];
    for (var j=1;j<rooms.values.length;j++) if (String(rooms.values[j][0]).trim() === String(row[3]).trim()) roomIndexes.push(j);
    if (roomIndexes.length !== 1) fail_('Local não encontrado ou duplicado.');
    var roomIndex = roomIndexes[0], oldStatus = rooms.values[roomIndex][3], oldUpdated = rooms.values[roomIndex][8];
    var end = new Date().toISOString();
    // Sheets does not offer a transaction across these ranges. Roll back best-effort;
    // a storage outage during rollback requires operator reconciliation (see docs).
    try {
      rooms.sheet.getRange(roomIndex+1,4).setValue(status);
      rooms.sheet.getRange(roomIndex+1,9).setValue(new Date());
      t.sheet.getRange(index+1,7,1,3).setValues([[end,action,status]]);
      SpreadsheetApp.flush();
    } catch (err) {
      try {
        rooms.sheet.getRange(roomIndex+1,4).setValue(oldStatus);
        rooms.sheet.getRange(roomIndex+1,9).setValue(oldUpdated);
        t.sheet.getRange(index+1,7,1,3).setValues([[row[6],row[7],row[8]]]);
        SpreadsheetApp.flush();
      } catch (_) { fail_('Falha ao salvar. Contate o responsável para conferir o registro antes de tentar novamente.'); }
      fail_('Falha ao salvar. Confira o registro antes de tentar novamente.');
    }
    return {id:id,userId:user.Usuario,userName:row[2],roomMark:row[3],roomName:row[4],startedAt:row[5],endedAt:end,action:action,finalStatus:status};
  } finally { lock.releaseLock(); }
}
function setupSistema() {
  var ss=getSpreadsheet_(), specs={
    Usuarios:['Usuario','SenhaHash','Nome','Perfil','Ativo'],
    Registros:['id','userId','userName','roomMark','roomName','startedAt','endedAt','action','finalStatus'],
    Projetos:['ProjetoID','ClienteID','Projeto','PlantaURL','Ativo'],
    Clientes:['ClienteID','Cliente','Ativo']
  };
  Object.keys(specs).forEach(function(n){var sh=ss.getSheetByName(n)||ss.insertSheet(n);if(sh.getLastRow()===0)sh.appendRow(specs[n]);sh.setFrozenRows(1)});
}

/** Execute manualmente para gerar um hash e cadastre-o na aba Usuarios. */
function gerarSenhaHash(senha) { return hash_(senha); }

function hash_(value) {
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,'MP|'+(value||''),Utilities.Charset.UTF_8);
  return bytes.map(function(b){var v=(b+256)%256;return ('0'+v.toString(16)).slice(-2)}).join('');
}
function safeEqual_(a,b){a=(a||'').toString();b=(b||'').toString();if(a.length!==b.length)return false;var d=0;for(var i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}

function getSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Aba "' + SHEET_NAME + '" não encontrada na planilha.');
  }
  return sheet;
}

/**
 * Lê todas as linhas da aba "Salas" e devolve um array de objetos
 * { MARK, Nome, Servico, Status, Observacao, PosicaoX, PosicaoY,
 *   Identificada, UltimaAtualizacao }.
 * Linhas sem MARK preenchido são ignoradas (linhas em branco no fim da
 * planilha, por exemplo).
 */
function readSalas_(sheet) {
  var table = table_(SHEET_NAME, false);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headerIndex = {};
  table.headers.forEach(function(h, i) { headerIndex[h] = i; });
  if (lastRow < 2) return { salas: [], atualizadoEm: '' };

  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var timezone = Session.getScriptTimeZone();
  var salas = [];
  var latestRaw = null; // Date ou string, usado só para achar o mais recente

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var mark = (row[headerIndex['MARK']] || '').toString().trim();
    if (!mark) continue; // ignora linhas em branco

    var rawUpdatedAt = row[headerIndex['UltimaAtualizacao']];
    latestRaw = laterOf_(latestRaw, rawUpdatedAt);

    salas.push({
      MARK: mark,
      Nome: cellToString_(row[headerIndex['Nome']]),
      Servico: cellToString_(row[headerIndex['Servico']]),
      Status: normalizeStatus_(row[headerIndex['Status']]),
      Observacao: cellToString_(row[headerIndex['Observacao']]),
      PosicaoX: cellToNumberOrEmpty_(row[headerIndex['PosicaoX']]),
      PosicaoY: cellToNumberOrEmpty_(row[headerIndex['PosicaoY']]),
      Identificada: cellToBooleanLabel_(row[headerIndex['Identificada']]),
      UltimaAtualizacao: cellToDateLabel_(rawUpdatedAt, timezone),
    });
  }

  return {
    salas: salas,
    atualizadoEm: latestRaw ? cellToDateLabel_(latestRaw, timezone) : '',
  };
}

/**
 * Compara dois valores de UltimaAtualizacao (Date, string ou vazio) e
 * devolve o mais recente. Datas reais sempre vencem strings; entre duas
 * datas, a maior vence; entre duas strings, a comparação é textual (só
 * como último recurso, caso a coluna não esteja formatada como data).
 */
function laterOf_(a, b) {
  if (!b) return a;
  if (!a) return b;
  var aIsDate = a instanceof Date;
  var bIsDate = b instanceof Date;
  if (aIsDate && bIsDate) return b > a ? b : a;
  if (aIsDate) return a;
  if (bIsDate) return b;
  return b.toString() > a.toString() ? b : a;
}

var VALID_STATUSES = [
  'finalizado',
  'em_andamento',
  'touch_up',
  'pendente',
  'nao_cadastrada',
];

function normalizeStatus_(value) {
  var v = (value || '').toString().trim().toLowerCase();
  if (VALID_STATUSES.indexOf(v) === -1) return 'nao_cadastrada';
  return v;
}

function cellToString_(value) {
  if (value === null || value === undefined) return '';
  return value.toString().trim();
}

function cellToNumberOrEmpty_(value) {
  if (value === null || value === undefined || value === '') return '';
  var n = Number(value);
  return isNaN(n) ? '' : n;
}

function cellToBooleanLabel_(value) {
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  var v = (value || '').toString().trim().toLowerCase();
  return v === 'sim' || v === 'true' || v === '1' ? 'Sim' : 'Não';
}

function cellToDateLabel_(value, timezone) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, timezone, 'dd/MM/yyyy HH:mm');
  }
  return cellToString_(value);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// =============================================================================
// OS OPERACIONAL (ledger) — PREPARADO NESTA RODADA, NÃO MIGRADO.
// Nenhuma destas abas (OS_Eventos/OS_Acessos) existe na planilha real ainda.
// `setupOsOperacional()` abaixo é só o código que as CRIARIA, do mesmo jeito
// que `setupSistema()` já faz para Usuarios/Registros/Projetos/Clientes —
// nunca é chamado automaticamente por este arquivo, só manualmente pelo
// administrador, depois de decidir ONDE essas abas devem viver e aprovar a
// migração. Nada é escrito numa planilha real por este arquivo sozinho.
//
// DESENHO (journal autoritativo, sem projeção separada): cada ação grava
// EXATAMENTE UMA linha em `OS_Eventos` — nunca uma segunda gravação numa
// tabela de "estado atual". O estado de uma OS é sempre DERIVADO (a linha de
// maior Revisao para aquele OsId). Custo aceito: ler todas as linhas daquela
// OS para derivar o estado — aceitável na escala deste piloto, documentado
// como limite, nunca escondido.
//
// ISOLAMENTO: toda leitura/escrita deste ledger exige grant EXPLÍCITO em
// `OS_Acessos` (Usuario×ProjetoId) — SEM EXCEÇÃO DE PAPEL, inclusive
// gestor/diretor. Diferente, por desenho, do adaptador legado
// `listWorkOrders`/`OS_HEADERS` acima (restrito só por papel, sem isolamento
// por projeto — risco já aceito e documentado em docs/backend-security.md
// antes desta rodada). OS legadas daquela aba NUNCA entram neste ledger nem
// são atribuídas a um projeto por inferência; os dois sistemas são
// independentes nesta rodada.
//
// SEÇÃO CRÍTICA ÚNICA (correção de revisão incremental desta rodada): toda
// leitura de estado atual, toda regra de transição/campo obrigatório e toda
// checagem de responsável/grant de uma MUTAÇÃO acontecem DENTRO do mesmo
// lock que protege a gravação — nunca antes de adquiri-lo. A checagem de
// IDEMPOTÊNCIA (dedup por RequestId) é a PRIMEIRA coisa feita sob lock,
// antes de qualquer leitura de estado: repetir um comando já aplicado nunca
// é avaliado contra um estado que já avançou (o que o rejeitaria
// incorretamente como transição ilegal). A comparação de replay usa um
// `ComandoCanonico` persistido (JSON do comando pedido, já incluindo o ator
// resolvido pela sessão) — nunca um valor gerado pelo servidor como um OsId
// novo, e nunca uma comparação solta de parâmetros não normalizados.
// =============================================================================

var OS_EVENTOS_HEADERS = ['RequestId','OsId','ProjetoId','TipoEvento','StatusAnterior','StatusNovo','ResponsavelAnterior','ResponsavelNovo','UsuarioId','PapelUsuario','CriadoEm','Revisao','Origem','OrigemDetalhe','Motivo','Escopo','ComandoCanonico'];
var OS_ACESSOS_HEADERS = ['ProjetoId','Usuario'];
var OS_STATUS_ORDEM = ['Recebida','Em conferência','Programada','Em execução','Aguardando validação','Concluída'];
var OS_ORIGENS_VALIDAS = ['manual','whatsapp_prep'];

// Campos exigidos pelo SERVIDOR antes de aceitar a transição PARA o status
// indicado — nunca inventados a partir de um valor ausente.
var OS_CAMPOS_EXIGIDOS_POR_TRANSICAO = {
  'Em execução': ['responsavelNovo'],
  'Concluída': ['motivo']
};

/** Mesma política de schema exato das demais abas, mas distingue "ledger nunca configurado" de "estrutura corrompida". */
function linhasComSchema_(name, expected) {
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) fail_('Fonte de ordens de serviço (ledger) não configurada.', 'OS_LEDGER_NOT_CONFIGURED');
  if (sh.getLastRow() < 1 || sh.getLastColumn() !== expected.length) fail_('Estrutura do ledger de OS inválida.', 'OS_LEDGER_SCHEMA_INVALID');
  var values = sh.getDataRange().getDisplayValues(), headers = values[0];
  if (expected.some(function(h,i) { return headers[i] !== h; })) fail_('Estrutura do ledger de OS inválida.', 'OS_LEDGER_SCHEMA_INVALID');
  return values.slice(1).filter(function(r) { return r.some(function(v) { return v !== ''; }); }).map(function(r) {
    var o = {}; expected.forEach(function(h,i) { o[h] = r[i]; }); return o;
  });
}

function temAcessoProjeto_(usuario, projetoId) {
  return linhasComSchema_('OS_Acessos', OS_ACESSOS_HEADERS).some(function(r) { return r.Usuario === usuario && r.ProjetoId === projetoId; });
}

function projetosOS_(user) {
  var ids = [];
  linhasComSchema_('OS_Acessos', OS_ACESSOS_HEADERS).forEach(function(r) {
    if (r.Usuario === user.Usuario && r.ProjetoId && ids.indexOf(r.ProjetoId) < 0) ids.push(r.ProjetoId);
  });
  return ids.map(function(id) { return {id:id,name:id}; });
}

function membrosOS_(user, projetoId) {
  projetoId = requireText_(projetoId,128,'Projeto inválido.');
  if (!temAcessoProjeto_(user.Usuario,projetoId)) fail_('Sem acesso a este projeto.','PROJECT_FORBIDDEN');
  var grants = linhasComSchema_('OS_Acessos',OS_ACESSOS_HEADERS).filter(function(r) { return r.ProjetoId === projetoId; });
  return rows_('Usuarios').filter(function(u) {
    return u.Ativo === 'Sim' && VALID_ROLES.indexOf(u.Perfil) >= 0 && grants.some(function(g) { return g.Usuario === u.Usuario; });
  }).map(function(u) { return {userId:u.Usuario,name:u.Nome,role:u.Perfil}; });
}

function eventosOS_(projetoId) {
  var events = linhasComSchema_('OS_Eventos', OS_EVENTOS_HEADERS).filter(function(e) { return e.ProjetoId === projetoId; });
  var requests = Object.create(null), groups = Object.create(null);
  function invalid() { fail_('Histórico de OS inconsistente. Contate o responsável.', 'OS_LEDGER_CORRUPT'); }
  events.forEach(function(e) {
    if (!UUID_PATTERN.test(e.RequestId) || !UUID_PATTERN.test(e.OsId) || requests[e.RequestId] ||
        !/^[1-9][0-9]*$/.test(e.Revisao) || !Number.isSafeInteger(Number(e.Revisao)) ||
        OS_STATUS_ORDEM.indexOf(e.StatusNovo) < 0 || !e.UsuarioId || !e.Escopo ||
        !Number.isFinite(Date.parse(e.CriadoEm))) invalid();
    requests[e.RequestId] = true;
    (groups[e.OsId] || (groups[e.OsId] = [])).push(e);
  });
  Object.keys(groups).forEach(function(id) {
    var history = groups[id].sort(function(a,b) { return Number(a.Revisao)-Number(b.Revisao); });
    history.forEach(function(e,i) {
      if (Number(e.Revisao) !== i+1) invalid();
      if (!i) {
        if (e.TipoEvento !== 'criada' || e.StatusNovo !== OS_STATUS_ORDEM[0] || e.StatusAnterior || e.ResponsavelAnterior || e.ResponsavelNovo) invalid();
        return;
      }
      var previous = history[i-1];
      if (e.StatusAnterior !== previous.StatusNovo || e.ResponsavelAnterior !== previous.ResponsavelNovo || e.Escopo !== previous.Escopo) invalid();
      if (e.TipoEvento === 'atribuida') {
        if (e.StatusNovo !== e.StatusAnterior || !e.ResponsavelNovo) invalid();
      } else if (e.TipoEvento === 'status_alterado') {
        if (OS_STATUS_ORDEM.indexOf(e.StatusNovo) !== OS_STATUS_ORDEM.indexOf(e.StatusAnterior)+1 || e.ResponsavelNovo !== e.ResponsavelAnterior) invalid();
      } else if (e.TipoEvento === 'reaberta') {
        if (e.StatusAnterior !== 'Concluída' || e.StatusNovo === 'Concluída' || !e.Motivo || e.ResponsavelNovo !== e.ResponsavelAnterior) invalid();
      } else invalid();
    });
  });
  return events;
}

/** Deriva o estado atual de UMA OsId a partir do evento de maior Revisao. Nunca lê/infere de outra fonte. */
function estadoAtualOS_(projetoId, osId) {
  var eventos = eventosOS_(projetoId).filter(function(e) { return e.OsId === osId; });
  if (!eventos.length) return null;
  var atual = eventos[0];
  eventos.forEach(function(e) { if (Number(e.Revisao) > Number(atual.Revisao)) atual = e; });
  return {
    osId: osId, projetoId: projetoId, status: atual.StatusNovo, escopo: atual.Escopo,
    responsavel: atual.ResponsavelNovo, revisao: Number(atual.Revisao), atualizadoEm: atual.CriadoEm,
    historico: eventos.slice().sort(function(a,b) { return Number(a.Revisao) - Number(b.Revisao); })
  };
}

function eventoPorRequestId_(projetoId, requestId) {
  return eventosOS_(projetoId).filter(function(e) { return e.RequestId === requestId; })[0] || null;
}

function listarOsOperacional_(user, projetoId) {
  projetoId = requireText_(projetoId, 128, 'Projeto inválido.');
  if (!temAcessoProjeto_(user.Usuario, projetoId)) fail_('Sem acesso a este projeto.', 'PROJECT_FORBIDDEN');
  var ids = [];
  eventosOS_(projetoId).forEach(function(e) { if (ids.indexOf(e.OsId) < 0) ids.push(e.OsId); });
  return ids.map(function(id) { return estadoAtualOS_(projetoId, id); });
}

function detalheOsOperacional_(user, projetoId, osId) {
  projetoId = requireText_(projetoId, 128, 'Projeto inválido.');
  osId = requireText_(osId, 128, 'OS inválida.');
  if (!temAcessoProjeto_(user.Usuario, projetoId)) fail_('Sem acesso a este projeto.', 'PROJECT_FORBIDDEN');
  var estado = estadoAtualOS_(projetoId, osId);
  if (!estado) fail_('OS não encontrada.', 'OS_NOT_FOUND');
  return estado;
}

function requireRequestId_(value) { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail_('Identificador de requisição inválido.'); return value; }

/** String opcional-mas-tipada: ausente/undefined -> '', presente precisa ser string dentro do tamanho — nunca objeto/array/número aceitos e coagidos em silêncio. */
function requireCanonicalText_(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail_('Campo de texto inválido.');
  if (value.length > max) fail_('Campo de texto excede o tamanho permitido.');
  return value.trim();
}

/** Revisão esperada é OBRIGATÓRIA em toda mutação sobre uma OS existente — nunca Number(undefined) nem coerção de string; só inteiro seguro >= 0 aceito. */
function requireRevisaoEsperada_(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail_('Revisão esperada inválida ou ausente. Recarregue antes de tentar novamente.', 'REVISION_REQUIRED');
  return value;
}

function requireOrigem_(value) {
  if (value === undefined) return 'manual';
  if (OS_ORIGENS_VALIDAS.indexOf(value) < 0) fail_('Origem inválida.');
  return value;
}

function appendLedger_(name, expected, obj) {
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) fail_('Fonte de ordens de serviço (ledger) não configurada.', 'OS_LEDGER_NOT_CONFIGURED');
  if (sh.getLastColumn() !== expected.length) fail_('Estrutura do ledger de OS inválida.', 'OS_LEDGER_SCHEMA_INVALID');
  var row = expected.map(function(h) {
    var value = obj[h] === undefined ? '' : obj[h];
    if (typeof value === 'string' && /^[=+@-]/.test(value)) value = "'" + value;
    return value;
  });
  sh.appendRow(row);
}

/**
 * Executa um comando sobre o ledger inteiramente dentro de UMA seção
 * crítica: dedup por RequestId é a PRIMEIRA checagem sob lock, antes de
 * qualquer leitura de estado ou regra de transição. `comando.osId` é
 * `undefined` para criação (o ID é gerado só depois da dedup, dentro de
 * `comando.aplicar`) e o OsId informado pelo cliente para as demais ações.
 * `comando.chaveCanonica()` devolve o comando PEDIDO PELO CLIENTE (nunca um
 * valor gerado pelo servidor) — persistido como `ComandoCanonico` e
 * comparado literalmente em um replay, já incluindo o usuário resolvido
 * pela sessão (nunca um ator/papel vindo do corpo da requisição).
 * `comando.aplicar(estadoAtual)` faz toda leitura/validação/decisão de
 * negócio (responsável, grants, transição, campos obrigatórios) e só então
 * devolve os campos do evento a gravar — tudo isto acontece sob o MESMO
 * lock que protege a gravação em si.
 */
function executarComandoOS_(user, p, comando) {
  var projetoId = requireText_(p.projetoId, 128, 'Projeto inválido.');
  var requestId = requireRequestId_(p.requestId);
  if (!temAcessoProjeto_(user.Usuario, projetoId)) fail_('Sem acesso a este projeto.', 'PROJECT_FORBIDDEN');
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    // Re-resolve the existing session after waiting. Never modify auth itself.
    var currentUser = session_(p.token);
    user.Usuario = currentUser.Usuario;
    user.Perfil = currentUser.Perfil;
    if (!temAcessoProjeto_(user.Usuario, projetoId)) fail_('Sem acesso a este projeto.', 'PROJECT_FORBIDDEN');
    if (p.action !== 'advanceOsOperacional' && user.Perfil === 'executor') fail_('Perfil sem permissão para esta operação.', 'FORBIDDEN');
    var comandoCanonico = JSON.stringify([user.Usuario, comando.chaveCanonica()]);
    var existente = eventoPorRequestId_(projetoId, requestId);
    if (existente) {
      if (existente.ComandoCanonico !== comandoCanonico) fail_('Identificador de requisição já usado para uma operação diferente.', 'REQUEST_ID_CONFLICT');
      return estadoAtualOS_(projetoId, existente.OsId);
    }
    var osId = comando.osId;
    var estadoAtual = osId ? estadoAtualOS_(projetoId, osId) : null;
    if (osId && !estadoAtual) fail_('OS não encontrada.', 'OS_NOT_FOUND');
    var decisao = comando.aplicar(estadoAtual); // valida tudo sob lock; lança fail_ se inválido
    var revisaoAtual = estadoAtual ? estadoAtual.revisao : 0;
    var linha = {
      RequestId: requestId, OsId: decisao.osId, ProjetoId: projetoId, TipoEvento: decisao.tipoEvento,
      StatusAnterior: decisao.statusAnterior || '', StatusNovo: decisao.statusNovo || '',
      ResponsavelAnterior: decisao.responsavelAnterior || '', ResponsavelNovo: decisao.responsavelNovo || '',
      UsuarioId: user.Usuario, PapelUsuario: user.Perfil, CriadoEm: new Date().toISOString(),
      Revisao: revisaoAtual + 1, Origem: decisao.origem || 'manual', OrigemDetalhe: decisao.origemDetalhe || '',
      Motivo: decisao.motivo || '', Escopo: decisao.escopo || '', ComandoCanonico: comandoCanonico
    };
    try {
      appendLedger_('OS_Eventos', OS_EVENTOS_HEADERS, linha);
      SpreadsheetApp.flush();
    } catch (_) {
      fail_('Não foi possível confirmar a gravação. Recarregue e repita com o mesmo identificador de requisição antes de tentar de novo.', 'WRITE_UNCONFIRMED');
    }
    return estadoAtualOS_(projetoId, decisao.osId);
  } finally { lock.releaseLock(); }
}

function validarCamposExigidos_(statusNovo, params) {
  (OS_CAMPOS_EXIGIDOS_POR_TRANSICAO[statusNovo] || []).forEach(function(campo) {
    if (!params[campo] || !String(params[campo]).trim()) fail_('Campo obrigatório ausente para esta transição: ' + campo + '.', 'OS_REQUIRED_FIELD');
  });
}

function criarOsOperacional_(user, p) {
  // Política (alinhada a docs/os-acceptance.md, fluxo exigido passo 1-2):
  // criação é ação de gestor/diretor, como atribuir/reabrir — executor só
  // avança uma OS já atribuída a ele (ver avancarStatusOS_).
  if (user.Perfil === 'executor') fail_('Perfil sem permissão para esta operação.', 'FORBIDDEN');
  var escopo = requireText_(p.escopo, 2048, 'Escopo obrigatório.');
  var origem = requireOrigem_(p.origem);
  var origemDetalhe = requireCanonicalText_(p.origemDetalhe, 256);
  // 'whatsapp_prep' é só um RÓTULO de proveniência para uma OS criada
  // manualmente, por uma sessão autenticada com grant no projeto, a partir
  // de uma mensagem que um humano leu e transcreveu — NUNCA um caminho de
  // importação automática nem uma marca de "verificado". Exigir referência
  // rastreável aqui impede que o rótulo seja usado sem nenhum vínculo.
  if (origem === 'whatsapp_prep' && !origemDetalhe) fail_('origemDetalhe (referência da mensagem de origem) é obrigatório para origem whatsapp_prep.');
  return executarComandoOS_(user, p, {
    osId: undefined,
    chaveCanonica: function() { return ['criar', escopo, origem, origemDetalhe]; },
    aplicar: function() {
      return { osId: Utilities.getUuid(), tipoEvento: 'criada', statusNovo: OS_STATUS_ORDEM[0], escopo: escopo, origem: origem, origemDetalhe: origemDetalhe };
    }
  });
}

function atribuirResponsavelOS_(user, p) {
  if (user.Perfil === 'executor') fail_('Perfil sem permissão para esta operação.', 'FORBIDDEN');
  var osId = requireText_(p.osId, 128, 'OS inválida.');
  var responsavel = requireText_(p.responsavel, 128, 'Responsável obrigatório.').trim();
  var expectedRevision = requireRevisaoEsperada_(p.expectedRevision);
  return executarComandoOS_(user, p, {
    osId: osId,
    chaveCanonica: function() { return ['atribuir', osId, responsavel, expectedRevision]; },
    aplicar: function(estadoAtual) {
      if (estadoAtual.revisao !== expectedRevision) fail_('A OS foi alterada por outra pessoa. Recarregue antes de tentar novamente.', 'REVISION_CONFLICT');
      var candidatos = rows_('Usuarios').filter(function(x) { return x.Usuario === responsavel; });
      if (candidatos.length !== 1 || candidatos[0].Ativo !== 'Sim' || VALID_ROLES.indexOf(candidatos[0].Perfil) < 0) fail_('Responsável inválido ou inativo.', 'RESPONSIBLE_INVALID');
      if (!temAcessoProjeto_(responsavel, estadoAtual.projetoId)) fail_('Responsável sem acesso a este projeto.', 'RESPONSIBLE_NOT_GRANTED');
      return { osId: osId, tipoEvento: 'atribuida', statusAnterior: estadoAtual.status, statusNovo: estadoAtual.status, escopo: estadoAtual.escopo, responsavelAnterior: estadoAtual.responsavel, responsavelNovo: responsavel };
    }
  });
}

function avancarStatusOS_(user, p) {
  var osId = requireText_(p.osId, 128, 'OS inválida.');
  var statusNovo = requireText_(p.statusNovo, 64, 'Status inválido.');
  var expectedRevision = requireRevisaoEsperada_(p.expectedRevision);
  var motivo = requireCanonicalText_(p.motivo, 2048);
  return executarComandoOS_(user, p, {
    osId: osId,
    chaveCanonica: function() { return ['avancar', osId, statusNovo, expectedRevision, motivo]; },
    aplicar: function(estadoAtual) {
      if (estadoAtual.revisao !== expectedRevision) fail_('A OS foi alterada por outra pessoa. Recarregue antes de tentar novamente.', 'REVISION_CONFLICT');
      var indiceAtual = OS_STATUS_ORDEM.indexOf(estadoAtual.status);
      var indiceNovo = OS_STATUS_ORDEM.indexOf(statusNovo);
      if (indiceNovo < 0) fail_('Status inválido.', 'OS_INVALID_STATUS');
      if (indiceNovo !== indiceAtual + 1) fail_('Transição de status não permitida a partir do estado atual.', 'OS_ILLEGAL_TRANSITION');
      if (user.Perfil === 'executor' && estadoAtual.responsavel !== user.Usuario) fail_('Apenas o responsável designado pode avançar esta OS.', 'FORBIDDEN');
      validarCamposExigidos_(statusNovo, { responsavelNovo: estadoAtual.responsavel, motivo: motivo });
      return { osId: osId, tipoEvento: 'status_alterado', statusAnterior: estadoAtual.status, statusNovo: statusNovo, escopo: estadoAtual.escopo, responsavelAnterior: estadoAtual.responsavel, responsavelNovo: estadoAtual.responsavel, motivo: motivo };
    }
  });
}

function reabrirOsOperacional_(user, p) {
  if (user.Perfil === 'executor') fail_('Perfil sem permissão para esta operação.', 'FORBIDDEN');
  var osId = requireText_(p.osId, 128, 'OS inválida.');
  var expectedRevision = requireRevisaoEsperada_(p.expectedRevision);
  var motivo = requireText_(p.motivo, 2048, 'Motivo obrigatório para reabrir.');
  var statusNovoPedido = requireCanonicalText_(p.statusNovo, 64);
  return executarComandoOS_(user, p, {
    osId: osId,
    chaveCanonica: function() { return ['reabrir', osId, expectedRevision, motivo, statusNovoPedido]; },
    aplicar: function(estadoAtual) {
      if (estadoAtual.revisao !== expectedRevision) fail_('A OS foi alterada por outra pessoa. Recarregue antes de tentar novamente.', 'REVISION_CONFLICT');
      if (estadoAtual.status !== 'Concluída') fail_('Só é possível reabrir uma OS concluída.', 'OS_NOT_COMPLETED');
      var statusNovo = statusNovoPedido || 'Em execução';
      if (OS_STATUS_ORDEM.indexOf(statusNovo) < 0 || statusNovo === 'Concluída') fail_('Etapa de reabertura inválida.', 'OS_INVALID_STATUS');
      validarCamposExigidos_(statusNovo, {responsavelNovo:estadoAtual.responsavel,motivo:motivo});
      return { osId: osId, tipoEvento: 'reaberta', statusAnterior: estadoAtual.status, statusNovo: statusNovo, escopo: estadoAtual.escopo, responsavelAnterior: estadoAtual.responsavel, responsavelNovo: estadoAtual.responsavel, motivo: motivo };
    }
  });
}

/** NUNCA chamado automaticamente — rodar manualmente no editor do Apps Script depois de decidir onde este ledger vive e aprovar a migração. */
function setupOsOperacional() {
  var ss = getSpreadsheet_(), specs = { OS_Eventos: OS_EVENTOS_HEADERS, OS_Acessos: OS_ACESSOS_HEADERS };
  Object.keys(specs).forEach(function(n) {
    var sh = ss.getSheetByName(n) || ss.insertSheet(n);
    if (sh.getLastRow() === 0) sh.appendRow(specs[n]);
    sh.setFrozenRows(1);
  });
}

// =============================================================================
// QUEM ESTÁ TRABALHANDO HOJE — leitura do QuickBooks Time (somente leitura).
// O token fica APENAS em Script Properties (QBTIME_ACCESS_TOKEN), nunca no
// repositório nem no navegador. Somente gestor/diretor recebem nomes e horários.
// Ver docs/quickbooks-time-setup.md.
// =============================================================================
var QBT_API_BASE = 'https://rest.tsheets.com/api/v1/';
var QBT_TIMEZONE = 'America/New_York';
var QBT_CACHE_SECONDS = 60;
function qbtGet_(path, params) {
  var token = PropertiesService.getScriptProperties().getProperty('QBTIME_ACCESS_TOKEN');
  if (typeof token !== 'string' || !token.trim()) fail_('Conexão com o QuickBooks Time ainda não configurada.', 'QBT_NOT_CONFIGURED');
  var query = Object.keys(params).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var res;
  try {
    res = UrlFetchApp.fetch(QBT_API_BASE + path + '?' + query, {method:'get', headers:{Authorization:'Bearer ' + token.trim()}, muteHttpExceptions:true});
  } catch (_) { fail_('QuickBooks Time indisponível no momento. Tente atualizar.', 'QBT_UNAVAILABLE'); }
  var code = res.getResponseCode();
  if (code === 401 || code === 403) fail_('O acesso ao QuickBooks Time expirou ou foi revogado. Gere um novo token.', 'QBT_UNAUTHORIZED');
  if (code !== 200) fail_('QuickBooks Time indisponível no momento. Tente atualizar.', 'QBT_UNAVAILABLE');
  try { return JSON.parse(res.getContentText()); } catch (_) { fail_('Resposta inválida do QuickBooks Time.', 'QBT_UNAVAILABLE'); }
}
/** Lê todas as páginas (limite de segurança: 10 páginas de 200). */
function qbtAll_(path, params, key) {
  var items = {}, supplemental = {users:{}, jobcodes:{}};
  for (var page = 1; page <= 10; page++) {
    var q = {}; Object.keys(params).forEach(function(k) { q[k] = params[k]; });
    q.limit = 200; q.page = page;
    var body = qbtGet_(path, q);
    var found = body && body.results && body.results[key];
    if (found && typeof found === 'object') Object.keys(found).forEach(function(id) { items[id] = found[id]; });
    var sup = body && body.supplemental_data;
    if (sup && sup.users) Object.keys(sup.users).forEach(function(id) { supplemental.users[id] = sup.users[id]; });
    if (sup && sup.jobcodes) Object.keys(sup.jobcodes).forEach(function(id) { supplemental.jobcodes[id] = sup.jobcodes[id]; });
    if (!body || body.more !== true) break;
  }
  return {items:items, supplemental:supplemental};
}
function qbtNome_(u) {
  if (!u) return 'Pessoa não identificada';
  var n = [u.first_name, u.last_name].filter(function(x) { return typeof x === 'string' && x.trim(); }).join(' ').trim();
  return n || 'Pessoa não identificada';
}
function qbtObra_(jobcodes, id) {
  var j = jobcodes[String(id)];
  if (!j || typeof j.name !== 'string') return '';
  var parent = j.parent_id && jobcodes[String(j.parent_id)];
  return parent && typeof parent.name === 'string' ? parent.name + ' › ' + j.name : j.name;
}
var QBT_PERIODOS = ['hoje','semana','mes'];
/** Início do período no fuso da operação: hoje, segunda-feira desta semana ou dia 1 do mês. */
function qbtInicio_(hoje, periodo) {
  if (periodo === 'mes') return hoje.slice(0, 8) + '01';
  if (periodo !== 'semana') return hoje;
  var d = new Date(hoje + 'T12:00:00Z'), back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
function qbtCliente_(jobcodes, id) {
  var j = jobcodes[String(id)], guard = 0;
  while (j && j.parent_id && jobcodes[String(j.parent_id)] && guard++ < 10) j = jobcodes[String(j.parent_id)];
  return j && typeof j.name === 'string' && j.name.trim() ? j.name : 'Sem cliente informado';
}
function qbtTotais_(map, key) {
  return Object.keys(map).map(function(k) { var o = {}; o[key] = k; o.horas = Math.round(map[k] / 36) / 100; return o; })
    .filter(function(o) { return o.horas > 0; })
    .sort(function(a, b) { return b.horas - a.horas; });
}
function quemTrabalhaHoje_(user, periodo) {
  if (user.Perfil !== 'gestor' && user.Perfil !== 'diretor') fail_('Perfil sem permissão para esta operação.', 'FORBIDDEN');
  periodo = periodo === undefined ? 'hoje' : periodo;
  if (QBT_PERIODOS.indexOf(periodo) < 0) fail_('Período inválido.');
  var cache = CacheService.getScriptCache(), cached = cache.get('qbt_' + periodo);
  if (cached) { try { return JSON.parse(cached); } catch (_) { /* consulta de novo */ } }
  var agora = Date.now();
  var hoje = Utilities.formatDate(new Date(agora), QBT_TIMEZONE, 'yyyy-MM-dd');
  var inicio = qbtInicio_(hoje, periodo);
  var ts = qbtAll_('timesheets', {start_date:inicio, end_date:hoje, on_the_clock:'both', supplemental_data:'yes'}, 'timesheets');
  var us = qbtAll_('users', {active:'yes', supplemental_data:'no'}, 'users');
  var users = us.items, jobcodes = ts.supplemental.jobcodes;
  Object.keys(ts.supplemental.users).forEach(function(id) { if (!users[id]) users[id] = ts.supplemental.users[id]; });
  var trabalhando = [], encerrados = [], comPonto = {}, porCliente = {}, porPessoa = {};
  Object.keys(ts.items).forEach(function(id) {
    var t = ts.items[id];
    if (!t || typeof t.date !== 'string' || t.date < inicio || t.date > hoje) return;
    var segundos = Number(t.duration) > 0 ? Number(t.duration) : 0;
    if (t.on_the_clock === true && typeof t.start === 'string' && Number.isFinite(Date.parse(t.start))) segundos = Math.max(0, (agora - Date.parse(t.start)) / 1000);
    var nome = qbtNome_(users[String(t.user_id)]), cliente = qbtCliente_(jobcodes, t.jobcode_id);
    porCliente[cliente] = (porCliente[cliente] || 0) + segundos;
    porPessoa[nome] = (porPessoa[nome] || 0) + segundos;
    if (t.date !== hoje) return;
    comPonto[String(t.user_id)] = true;
    var item = {pessoa:qbtNome_(users[String(t.user_id)]), obra:qbtObra_(jobcodes, t.jobcode_id), entrada:typeof t.start === 'string' ? t.start : ''};
    if (t.on_the_clock === true) trabalhando.push(item);
    else { item.saida = typeof t.end === 'string' ? t.end : ''; item.duracaoSegundos = Number(t.duration) > 0 ? Math.round(Number(t.duration)) : 0; encerrados.push(item); }
  });
  var semPonto = Object.keys(us.items).filter(function(id) { return !comPonto[id]; })
    .map(function(id) { return {pessoa:qbtNome_(us.items[id])}; });
  var porEntrada = function(a, b) { return a.entrada < b.entrada ? -1 : a.entrada > b.entrada ? 1 : 0; };
  trabalhando.sort(porEntrada); encerrados.sort(porEntrada);
  semPonto.sort(function(a, b) { return a.pessoa.localeCompare(b.pessoa); });
  var result = {data:hoje, consultadoEm:new Date(agora).toISOString(), fonte:'QuickBooks Time', periodo:periodo, inicio:inicio, fim:hoje,
    trabalhando:trabalhando, encerrados:encerrados, semPonto:semPonto,
    horasPorCliente:qbtTotais_(porCliente, 'cliente'), horasPorPessoa:qbtTotais_(porPessoa, 'pessoa')};
  cache.put('qbt_' + periodo, JSON.stringify(result), QBT_CACHE_SECONDS);
  return result;
}
