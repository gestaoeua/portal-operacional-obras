const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const {fixturePresentation, fixtureSuccess} = require('./fixture-presentation.cjs');

test('fixture success explicitly states memory-only simulation, without changing the private UI source', async () => {
  const original = fs.readFileSync('integration/private-pilot.html','utf8');
  const dom = new JSDOM(fixturePresentation(original), {runScripts:'dangerously',url:'https://fixture.test'});
  const w = dom.window;
  w.google = {script:{run:{withSuccessHandler(ok){return {withFailureHandler(){return {privatePilotRequest(){ok({ok:true});}};}};}}}};
  w.document.getElementById('login').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.document.getElementById('status').textContent,fixtureSuccess);
  assert(!dom.serialize().includes('Resposta confirmada pelo backend privado.'));
  assert.equal(fs.readFileSync('integration/private-pilot.html','utf8'),original);
  dom.window.close();
});

test('fixture copy fails explicitly if the upstream success text changes',()=>{
  assert.throws(()=>fixturePresentation('<html>changed</html>'),/target changed/);
});
