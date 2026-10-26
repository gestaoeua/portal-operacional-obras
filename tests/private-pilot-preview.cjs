// Local-only browser acceptance of the exact generated private UI.
// Synthetic credentials/data; memory-only ledger. NEVER DEPLOY.
process.env.RSF_OS_BACKEND_FILE='integration/Code.production-compatible.gs';
const fs=require('node:fs'),http=require('node:http');
const fixture=fs.readFileSync(__dirname+'/os-ledger.test.cjs','utf8');
const harness=new Function('require','__dirname',fixture.slice(0,fixture.indexOf("test('"))+'\nreturn harness;')(require,__dirname);
const h=harness();
h.context.ContentService.createTextOutput=text=>({getContent:()=>text,setMimeType(){return this;}});
h.sheets.Usuarios.data.push(['boss',h.context.hash_('fixture-only'),'Ficticio','gestor','Sim']);
h.sheets.OS_Acessos.data.push(['PILOTO_FICTICIO_RSF_20261021','boss']);
const adapter=`<script>window.google={script:{run:{withSuccessHandler(ok){return {withFailureHandler(fail){return {privatePilotRequest(p){fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(r=>r.json()).then(ok,fail);}};}};}}}};</script>`;
const html=require('./fixture-presentation.cjs').fixturePresentation(h.context.privatePilotHtml_()).replace('<script>',adapter+'<script>').replace('Projeto fictício de validação','PRÉVIA LOCAL — dados fictícios e voláteis — senha de teste: fixture-only. Projeto fictício de validação');
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
 if(req.method!=='POST'||req.url!=='/rpc'){res.writeHead(404);res.end();return;}
 let body='';req.on('data',c=>{body+=c;if(body.length>8192)req.destroy();});
 req.on('end',()=>{try{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(h.context.privatePilotRequest(JSON.parse(body))));}catch{res.writeHead(400);res.end('{}');}});
}).listen(process.env.RSF_FIXTURE_PREVIEW_PORT === '8794' ? 8794 : 8791,'127.0.0.1',()=>console.log('SYNTHETIC PRIVATE UI PREVIEW loopback only — no live spreadsheet'));
