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
  return jsonResponse_({
    ok: false,
    erro: 'Este endpoint é somente leitura (GET). Edições devem ser feitas diretamente na planilha.',
  });
}

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
