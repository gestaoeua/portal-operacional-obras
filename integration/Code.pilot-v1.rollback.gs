/**
 * Apps Script do Painel de Mapa de Progresso
 * ============================================================================
 * Este script é o único "backend" do painel. Ele expõe UM único endpoint
 * HTTP GET que lê a aba "Salas" da planilha e devolve os dados em JSON.
 *
 * IMPORTANTE — segurança:
 *  - Este arquivo NÃO contém nenhuma credencial, token ou senha.
 *  - Só existe a função doGet(). Não há doPost/doPut/doPatch/doDelete que
 *    escrevam na planilha — ou seja, é fisicamente impossível alterar dados
 *    através deste endpoint. A função doPost() abaixo existe apenas para
 *    devolver uma mensagem de erro amigável, caso alguém tente enviar dados;
 *    ela NÃO grava nada na planilha.
 *  - A edição dos dados é feita só por quem tem acesso de edição à própria
 *    planilha no Google Sheets.
 *
 * Como instalar: veja o passo a passo completo no README.md do projeto
 * ("Publicar o Apps Script").
 * ============================================================================
 */

// Nome da aba que contém os dados das salas.
var SHEET_NAME = 'Salas';
var SPREADSHEET_ID = '1AZpQKHWns1z4-m7e30vd1CowM4bnqxHuo_aCCLvMizY';

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// Cabeçalhos esperados na primeira linha da aba (nessa ordem).
var EXPECTED_HEADERS = [
  'MARK',
  'Nome',
  'Servico',
  'Status',
  'Observacao',
  'PosicaoX',
  'PosicaoY',
  'Identificada',
  'UltimaAtualizacao',
];

/**
 * Único ponto de entrada HTTP deste projeto. Responde a requisições GET
 * com a lista de salas em JSON. Não recebe nem processa parâmetros que
 * alterem a planilha.
 */
function doGet(e) {
  try {
    var sheet = getSheet_();
    var result = readSalas_(sheet);

    return jsonResponse_({
      ok: true,
      salas: result.salas,
      atualizadoEm: result.atualizadoEm,
      totalSalas: result.salas.length,
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      erro: 'Não foi possível ler os dados da planilha: ' + err.message,
    });
  }
}

/**
 * Não implementamos escrita. Isto existe apenas para responder de forma
 * clara caso alguém tente fazer POST neste endpoint — nada é gravado.
 */
function doPost(e) {
  var osResponse=routeOsRequest_(e); if(osResponse) return osResponse;
  try {
    var p = JSON.parse((e.parameter && e.parameter.payload) || '{}');
    if (p.action === 'login') return jsonResponse_({ ok: true, session: login_(p.username, p.password) });
    var user = session_(p.token);
    if (p.action === 'enter') return jsonResponse_({ ok: true, visit: enter_(user, p.roomMark) });
    if (p.action === 'exit') return jsonResponse_({ ok: true, visit: exit_(user, p.visitId, p.workAction, p.finalStatus) });
    if (p.action === 'listVisits') {
      var visits = rows_('Registros');
      if (user.Perfil === 'executor') visits = visits.filter(function(v){ return v.userId === user.Usuario; });
      return jsonResponse_({ ok: true, visits: visits });
    }
    throw new Error('Operação não reconhecida.');
  } catch (err) { return jsonResponse_({ ok: false, erro: err.message }); }
}

function login_(username, password) {
  username = (username || '').toString().trim().toLowerCase();
  var attempts = CacheService.getScriptCache();
  var attemptKey = 'attempt_' + username;
  var count = Number(attempts.get(attemptKey) || 0);
  if (count >= 8) throw new Error('Muitas tentativas. Aguarde 10 minutos.');
  var users = rows_('Usuarios');
  var u = users.filter(function(x){ return x.Usuario.toLowerCase() === username && safeEqual_(x.SenhaHash, hash_(password)) && x.Ativo === 'Sim'; })[0];
  if (!u) { attempts.put(attemptKey, String(count + 1), 600); throw new Error('Nome ou senha incorretos.'); }
  attempts.remove(attemptKey);
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('token_' + token, JSON.stringify(u), 21600);
  return { token: token, userId: u.Usuario, name: u.Nome, role: u.Perfil };
}
function session_(token) {
  var raw = CacheService.getScriptCache().get('token_' + token);
  if (!raw) throw new Error('Sessão expirada. Entre novamente.');
  return JSON.parse(raw);
}
function enter_(user, mark) {
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
  var open = rows_('Registros').filter(function(x){ return x.userId === user.Usuario && !x.endedAt; })[0];
  if (open) throw new Error('Você já está trabalhando em ' + open.roomMark + '.');
  var room = readSalas_(getSheet_()).salas.filter(function(x){ return x.MARK === mark; })[0];
  if (!room) throw new Error('Local não encontrado.');
  var visit = { id: Utilities.getUuid(), userId:user.Usuario, userName:user.Nome, roomMark:mark, roomName:room.Nome, startedAt:new Date().toISOString(), endedAt:'', action:'', finalStatus:'' };
  append_('Registros', visit); return visit;
  } finally { lock.releaseLock(); }
}
function exit_(user, id, action, status) {
  if (VALID_ACTIONS.indexOf(action) === -1) throw new Error('Atividade inválida.');
  if (VALID_STATUSES.indexOf(status) === -1 || status === 'nao_cadastrada') throw new Error('Status inválido.');
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
  var sh = getSpreadsheet_().getSheetByName('Registros'), data = sh.getDataRange().getValues(), h = data[0];
  for (var i=1;i<data.length;i++) if(data[i][h.indexOf('id')]===id && data[i][h.indexOf('userId')]===user.Usuario) {
    var end = new Date().toISOString();
    sh.getRange(i+1,h.indexOf('endedAt')+1).setValue(end); sh.getRange(i+1,h.indexOf('action')+1).setValue(action); sh.getRange(i+1,h.indexOf('finalStatus')+1).setValue(status);
    updateRoomStatus_(data[i][h.indexOf('roomMark')], status);
    return {id:id,userId:user.Usuario,userName:user.Nome,roomMark:data[i][h.indexOf('roomMark')],roomName:data[i][h.indexOf('roomName')],startedAt:data[i][h.indexOf('startedAt')],endedAt:end,action:action,finalStatus:status};
  } throw new Error('Registro aberto não encontrado.');
  } finally { lock.releaseLock(); }
}
var VALID_ACTIONS=['preparacao','primeira_mao','segunda_mao','touch_up','portas','limpeza','inspecao'];
function updateRoomStatus_(mark,status){var sh=getSheet_(),v=sh.getDataRange().getValues(),h=v[0],mi=h.indexOf('MARK'),si=h.indexOf('Status'),ui=h.indexOf('UltimaAtualizacao');for(var i=1;i<v.length;i++)if(String(v[i][mi]).trim()===String(mark).trim()){sh.getRange(i+1,si+1).setValue(status);if(ui>=0)sh.getRange(i+1,ui+1).setValue(new Date());return}}
function rows_(name) {
  var sh=getSpreadsheet_().getSheetByName(name); if(!sh||sh.getLastRow()<2)return[];
  var v=sh.getDataRange().getDisplayValues(),h=v.shift(); return v.map(function(r){var o={};h.forEach(function(k,i){o[k]=r[i]});return o});
}
function append_(name,obj){var sh=getSpreadsheet_().getSheetByName(name),h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];sh.appendRow(h.map(function(k){return obj[k]||''}))}
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
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headerIndex = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = (headerRow[i] || '').toString().trim();
    if (h) headerIndex[h] = i;
  }

  var missing = EXPECTED_HEADERS.filter(function (h) {
    return !(h in headerIndex);
  });
  if (missing.length) {
    throw new Error(
      'Colunas ausentes na aba "' + SHEET_NAME + '": ' + missing.join(', ')
    );
  }

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


var SCHEMAS = {
  Salas: EXPECTED_HEADERS,
  Usuarios: ['Usuario','SenhaHash','Nome','Perfil','Ativo'],
  Registros: ['id','userId','userName','roomMark','roomName','startedAt','endedAt','action','finalStatus']
};
var VALID_ROLES = ['executor','gestor','diretor'];

function fail_(message, code) { var e = new Error(message); e.publicMessage = message; e.publicCode = code; throw e; }
function requireText_(value, max, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail_(message);
  return value;
}
function requireToken_(value) { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail_('Sessão inválida. Entre novamente.', 'SESSION_EXPIRED'); return value; }


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
    var currentUser = osSession_(p.token);
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
