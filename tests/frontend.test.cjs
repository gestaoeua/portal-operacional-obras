const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildSync}=require('esbuild');
const {JSDOM}=require('jsdom');
const output=path.join(__dirname,'.central-flow.cjs');
buildSync({entryPoints:[path.join(__dirname,'../src/central/App.tsx')],bundle:true,platform:'node',format:'cjs',outfile:output,external:['react','react-dom'],loader:{'.css':'empty','.jpeg':'dataurl'},define:{'import.meta.env.VITE_RSF_CENTRAL_API_URL':'"https://fixture.invalid/api"','import.meta.env.VITE_RSF_FIXTURE_MODE':'"true"'},jsx:'automatic'});
const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/central/'});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const App=require(output).default;fs.unlinkSync(output);
const fixture=fs.readFileSync(__dirname+'/os-ledger.test.cjs','utf8');
const harness=new Function('require','__dirname',fixture.slice(0,fixture.indexOf("test('"))+'\nreturn harness;')(require,__dirname);
const tick=()=>new Promise(r=>setTimeout(r,0));
const text=()=>document.body.textContent;
async function click(label){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(label));assert.ok(b,label);assert.equal(b.disabled,false,label+' enabled');await act(async()=>{b.click();await tick();await tick();});}
async function fill(el,value){assert.ok(el);await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,value);el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await tick();});}
let h,root;
async function start(){
  h=harness();global.fetch=async(url,options)=>{assert.equal(url,'https://fixture.invalid/api');const p=JSON.parse(options.body.get('payload'));return {ok:true,json:async()=>h.post(p)};};
  await act(async()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(App));await tick();});
  await fill(document.querySelector('input[autocomplete=username]'),'gestora');await fill(document.querySelector('input[type=password]'),'test-pass');
  await click('Entrar');await click('Ordens de serviço');
  assert.ok(text().includes('Nova ordem de serviço'));
}
async function stop(){await act(async()=>{root.unmount();await tick();});}
test('actual central UI and Apps Script fixture: create, reopen detail, assign, all stages, reopen and preserved history',async()=>{
  await start();
  try{
    await fill(document.querySelector('textarea[aria-label="Descrição do serviço"]'),'FICTICIO — Pintura da unidade de teste');await click('Criar e salvar OS');
    assert.ok(text().includes('OS salva e confirmada. Revisão 1.'));
    await click('Recarregar OS');await click('FICTICIO — Pintura da unidade de teste');
    await fill(document.querySelector('select[aria-label="Responsável"]'),'exec1');await click('Salvar responsável');
    for(const stage of ['Em conferência','Programada','Em execução','Aguardando validação']) await click('Avançar para '+stage);
    await fill(document.querySelector('textarea[aria-label="Observação / evidência textual"]'),'FICTICIO — inspeção aprovada no teste');await click('Avançar para Concluída');
    await fill(document.querySelector('textarea[aria-label="Observação / evidência textual"]'),'FICTICIO — retoque solicitado');await click('Reabrir OS em execução');
    await click('Recarregar OS');
    assert.equal(document.querySelectorAll('.os-history li').length,8);
    assert.ok(text().includes('FICTICIO — retoque solicitado'));
    assert.equal(h.sheets.OS_Eventos.data.length,9);
    assert.equal(window.localStorage.length,0);assert.equal(window.sessionStorage.length,0);
  }finally{await stop();}
});
test('actual UI: ambiguous persisted write reconciles same request instead of duplicating',async()=>{
  await start();try{
    let outage=true;h.context.SpreadsheetApp.flush=()=>{if(outage)throw Error('synthetic outage');};
    await fill(document.querySelector('textarea[aria-label="Descrição do serviço"]'),'FICTICIO — gravação ambígua');await click('Criar e salvar OS');
    assert.ok(text().includes('Gravação não confirmada'));outage=false;
    await click('Reconciliar mesmo pedido');assert.ok(text().includes('OS salva e confirmada. Revisão 1.'));
    assert.equal(h.sheets.OS_Eventos.data.length,2);
  }finally{await stop();}
});
test('actual UI: HTTP failure after persistence retains immutable retry command',async()=>{
  await start();try{
    const normal=global.fetch;let outage=true;
    global.fetch=async(url,options)=>{const p=JSON.parse(options.body.get('payload'));const response=await normal(url,options);if(outage&&p.action==='createOsOperacional')return {ok:false,status:503};return response;};
    await fill(document.querySelector('textarea[aria-label="Descrição do serviço"]'),'FICTICIO — resposta HTTP perdida');await click('Criar e salvar OS');
    assert.ok(text().includes('Gravação não confirmada'));
    assert.equal(document.querySelector('textarea[aria-label="Descrição do serviço"]').disabled,true);
    outage=false;await click('Reconciliar mesmo pedido');
    assert.equal(h.sheets.OS_Eventos.data.length,2);assert.ok(text().includes('OS salva e confirmada. Revisão 1.'));
  }finally{await stop();}
});
test('actual UI: revoked project clears previously loaded private order details',async()=>{
  await start();try{
    await fill(document.querySelector('textarea[aria-label="Descrição do serviço"]'),'FICTICIO — conteúdo protegido');await click('Criar e salvar OS');
    const rows=h.sheets.OS_Acessos.data;for(let i=rows.length-1;i>0;i--)if(rows[i][0]==='ProjetoA'&&rows[i][1]==='gestora')rows.splice(i,1);
    await click('Recarregar OS');assert.ok(text().includes('Sem acesso a este projeto.'));assert.ok(!text().includes('FICTICIO — conteúdo protegido'));
  }finally{await stop();}
});
