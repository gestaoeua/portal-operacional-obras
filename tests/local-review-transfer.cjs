// Loopback-only transfer of reviewed source and screenshot bytes. Never deploy.
const fs=require('fs'),http=require('http'),path=require('path');
const out=path.resolve('../screenshots');fs.mkdirSync(out,{recursive:true});
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'){
  res.setHeader('Content-Type','text/html; charset=utf-8');
  const source=fs.readFileSync('integration/Code.production-compatible.gs','utf8');
  res.end('<!doctype html><html lang="zxx" translate="no"><meta name="google" content="notranslate"><title>RSF local review transfer</title><label>Reviewed source<textarea readonly id="source" class="notranslate">'+escape(source)+'</textarea></label><form method="post"><label>Artifact name<select name="name"><option>rsf-pilot-desktop</option><option>rsf-pilot-mobile</option></select></label><label>Screenshot bytes<textarea name="image"></textarea></label><button>Save screenshot locally</button></form></html>');return;
 }
 if(req.method!=='POST'){res.writeHead(405);res.end();return;}
 let body='';req.on('data',c=>{body+=c;if(body.length>12e6)req.destroy();});req.on('end',()=>{
 const data=new URLSearchParams(body),name=data.get('name'),bytes=data.get('image');
 if(!['rsf-pilot-desktop','rsf-pilot-mobile'].includes(name)||!bytes||!/^[a-zA-Z0-9+/=]+$/.test(bytes)){res.writeHead(400);res.end('Invalid capture');return;}
 const dest=path.join(out,name+'.jpg');if(fs.existsSync(dest)){res.writeHead(409);res.end('Existing capture preserved');return;}
 fs.writeFileSync(dest,Buffer.from(bytes,'base64'));res.end('Saved '+name+'.jpg');
 });
}).listen(8792,'127.0.0.1',()=>console.log('LOCAL REVIEW TRANSFER http://127.0.0.1:8792'));
