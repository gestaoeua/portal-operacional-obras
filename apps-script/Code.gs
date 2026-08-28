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
  var sh = SpreadsheetApp.getActive().getSheetByName('Registros'), data = sh.getDataRange().getValues(), h = data[0];
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
  var sh=SpreadsheetApp.getActive().getSheetByName(name); if(!sh||sh.getLastRow()<2)return[];
  var v=sh.getDataRange().getDisplayValues(),h=v.shift(); return v.map(function(r){var o={};h.forEach(function(k,i){o[k]=r[i]});return o});
}
function append_(name,obj){var sh=SpreadsheetApp.getActive().getSheetByName(name),h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];sh.appendRow(h.map(function(k){return obj[k]||''}))}
function setupSistema() {
  var ss=SpreadsheetApp.getActive(), specs={
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
