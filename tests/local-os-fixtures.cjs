// LOOPBACK-ONLY browser test adapter. Entirely synthetic, volatile data.
// Never deploy this file. This is not a substitute for Apps Script staging.
const fs = require('node:fs');
const http = require('node:http');
const fixture = fs.readFileSync(__dirname + '/os-ledger.test.cjs', 'utf8');
const harness = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf("test('")) + '\nreturn harness;')(require, __dirname);
const h = harness();
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.writeHead(405); res.end('{"ok":false}'); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 8192) req.destroy(); });
  req.on('end', () => {
    try { res.end(JSON.stringify(h.post(JSON.parse(new URLSearchParams(body).get('payload'))))); }
    catch { res.writeHead(400); res.end('{"ok":false,"erro":"Fixture request invalid"}'); }
  });
});
server.listen(8789, '127.0.0.1', () => console.log('SYNTHETIC VOLATILE FIXTURES ONLY: http://127.0.0.1:8789'));
