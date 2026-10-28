const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../apps-script/Code.gs'), 'utf8');

const today = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
function harness({token = 'synthetic-token', status = 200, pages} = {}) {
  const sheets = {}, cache = new Map(), properties = {}, fetches = [];
  if (token) properties.QBTIME_ACCESS_TOKEN = token;
  function sheet(name, data) {
    sheets[name] = {data, getLastRow: () => data.length, getLastColumn: () => data[0].length,
      getDataRange() { return this.getRange(1, 1, data.length, data[0].length); },
      getRange: (r, c, nr = 1, nc = 1) => ({getValues: () => data.slice(r-1, r-1+nr).map(x => x.slice(c-1, c-1+nc)), getDisplayValues: () => data.slice(r-1, r-1+nr).map(x => x.slice(c-1, c-1+nc).map(String))})};
  }
  const context = vm.createContext({
    Date, Number, JSON,
    SpreadsheetApp: {openById: () => ({getSheetByName: n => sheets[n]})},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => properties[k] || null})},
    CacheService: {getScriptCache: () => ({get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k)})},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    Utilities: {getUuid: () => crypto.randomUUID(), computeDigest: (_, s) => [...crypto.createHash('sha256').update(s).digest()], DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.toLocaleDateString('en-CA', {timeZone: tz}) : d.toISOString()},
    Session: {getScriptTimeZone: () => 'UTC'},
    UrlFetchApp: {fetch(url, opts) {
      fetches.push({url, opts});
      const path = url.split('/api/v1/')[1].split('?')[0];
      const page = Number(new URL(url).searchParams.get('page'));
      const body = (pages[path] || [])[page - 1] || {results: {[path]: {}}, more: false};
      return {getResponseCode: () => status, getContentText: () => JSON.stringify(body)};
    }},
    ContentService: {createTextOutput: text => ({text, setMimeType() { return this; }}), MimeType: {JSON: 'application/json'}}
  });
  vm.runInContext(source, context);
  sheet('Usuarios', [Array.from(context.SCHEMAS.Usuarios), ['worker', context.hash_('test-pass'), 'Worker', 'executor', 'Sim'], ['boss', context.hash_('test-pass'), 'Boss', 'gestor', 'Sim']]);
  const post = p => JSON.parse(context.doPost({parameter: {payload: JSON.stringify(p)}}).text);
  const login = u => post({action: 'login', username: u, password: 'test-pass'}).session.token;
  return {post, login, fetches, cache};
}
const synthetic = () => {
  const d = today();
  return {
    timesheets: [
      {results: {timesheets: {
        1: {user_id: 10, jobcode_id: 100, date: d, start: `${d}T08:05:00-04:00`, end: '', duration: 0, on_the_clock: true},
        2: {user_id: 11, jobcode_id: 101, date: d, start: `${d}T07:30:00-04:00`, end: `${d}T11:00:00-04:00`, duration: 12600, on_the_clock: false}
      }}, supplemental_data: {users: {10: {first_name: 'Ana', last_name: 'Teste'}, 11: {first_name: 'Beto', last_name: 'Teste'}},
        jobcodes: {100: {name: 'Obra Fictícia', parent_id: 0}, 101: {name: 'Pintura', parent_id: 100}}}, more: true},
      {results: {timesheets: {3: {user_id: 11, jobcode_id: 100, date: d, start: `${d}T07:00:00-04:00`, end: '', duration: 0, on_the_clock: true}}}, supplemental_data: {}, more: false}
    ],
    users: [{results: {users: {10: {first_name: 'Ana', last_name: 'Teste'}, 11: {first_name: 'Beto', last_name: 'Teste'}, 12: {first_name: 'Caio', last_name: 'Teste'}}}, more: false}]
  };
};

test('gestor gets working, finished and absent people across pages; token stays server-side', () => {
  const h = harness({pages: synthetic()});
  const r = h.post({action: 'quemTrabalhaHoje', token: h.login('boss')});
  assert.equal(r.ok, true);
  assert.deepEqual(r.hoje.trabalhando.map(x => [x.pessoa, x.obra]), [['Beto Teste', 'Obra Fictícia'], ['Ana Teste', 'Obra Fictícia']]);
  assert.deepEqual(r.hoje.encerrados.map(x => [x.pessoa, x.obra, x.duracaoSegundos]), [['Beto Teste', 'Obra Fictícia › Pintura', 12600]]);
  assert.deepEqual(r.hoje.semPonto, [{pessoa: 'Caio Teste'}]);
  assert.equal(r.hoje.data, today());
  assert.ok(h.fetches.every(f => f.opts.headers.Authorization === 'Bearer synthetic-token' && !f.url.includes('synthetic-token')));
  assert.ok(!JSON.stringify(r).includes('synthetic-token'));
});
test('result is cached briefly so repeated refreshes do not hit QuickBooks Time', () => {
  const h = harness({pages: synthetic()}), t = h.login('boss');
  h.post({action: 'quemTrabalhaHoje', token: t}); const n = h.fetches.length;
  assert.equal(h.post({action: 'quemTrabalhaHoje', token: t}).ok, true);
  assert.equal(h.fetches.length, n);
});
test('executor and invalid sessions are refused before any QuickBooks Time call', () => {
  const h = harness({pages: synthetic()});
  assert.equal(h.post({action: 'quemTrabalhaHoje', token: h.login('worker')}).code, 'FORBIDDEN');
  assert.equal(h.post({action: 'quemTrabalhaHoje', token: crypto.randomUUID()}).ok, false);
  assert.equal(h.fetches.length, 0);
});
test('missing or rejected token fails with a clear code', () => {
  const a = harness({token: '', pages: synthetic()});
  assert.equal(a.post({action: 'quemTrabalhaHoje', token: a.login('boss')}).code, 'QBT_NOT_CONFIGURED');
  const b = harness({status: 401, pages: synthetic()});
  assert.equal(b.post({action: 'quemTrabalhaHoje', token: b.login('boss')}).code, 'QBT_UNAUTHORIZED');
});
test('hours by client (top-level job) and by person include the running clock', () => {
  const h = harness({pages: synthetic()});
  const r = h.post({action: 'quemTrabalhaHoje', token: h.login('boss')}).hoje;
  assert.equal(r.periodo, 'hoje');
  assert.deepEqual(r.horasPorCliente.map(x => x.cliente), ['Obra Fictícia']);
  const beto = r.horasPorPessoa.find(x => x.pessoa === 'Beto Teste');
  assert.ok(beto.horas >= 3.5, 'closed 3.5h plus the open entry');
  assert.ok(r.horasPorPessoa.every(x => typeof x.horas === 'number' && x.horas > 0));
});
test('week and month periods widen the query range; unknown period is refused', () => {
  const h = harness({pages: synthetic()}), t = h.login('boss');
  const w = h.post({action: 'quemTrabalhaHoje', token: t, periodo: 'semana'}).hoje;
  assert.equal(new Date(w.inicio + 'T12:00:00Z').getUTCDay(), 1);
  assert.ok(h.fetches.some(f => f.url.includes(`start_date=${w.inicio}`)));
  const m = h.post({action: 'quemTrabalhaHoje', token: t, periodo: 'mes'}).hoje;
  assert.equal(m.inicio.slice(8), '01');
  assert.equal(h.post({action: 'quemTrabalhaHoje', token: t, periodo: 'ano; drop'}).ok, false);
});
