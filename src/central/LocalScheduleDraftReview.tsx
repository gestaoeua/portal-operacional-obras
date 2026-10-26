import {useState} from 'react';
export type DraftRow={sourcePerson:string;sourceLocation:string;date:string;startTime:string;endTime:null|string;timezone:'America/New_York';identityStatus:string;locationContext?:string};
/** Local File API only. Never fetch, persist in web storage, or submit these records. */
export function readLocalDraft(raw:unknown):DraftRow[]{
 const value=raw as any;
 if(!value||value.status!=='draft_not_ready_for_dispatch'||!Array.isArray(value.assignments)||value.assignments.length>500)throw Error('Invalid draft');
 return value.assignments.map((a:any)=>{
  if(!a||['sourcePerson','sourceLocation','date','startTime','identityStatus'].some(k=>typeof a[k]!=='string'||!a[k].trim()||a[k].length>500)||a.timezone!=='America/New_York'||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.startTime)||a.endTime!==null)throw Error('Invalid draft');
  const day=new Date(a.date+'T12:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==a.date)throw Error('Invalid date');
  return {sourcePerson:a.sourcePerson,sourceLocation:a.sourceLocation,date:a.date,startTime:a.startTime,endTime:null,timezone:'America/New_York',identityStatus:a.identityStatus,...(typeof a.locationContext==='string'?{locationContext:a.locationContext}:{})};
 });
}
export default function LocalScheduleDraftReview(){
 const [rows,setRows]=useState<DraftRow[]>([]),[error,setError]=useState(''),[fileName,setFileName]=useState('');
 const [pasted,setPasted]=useState('');
 return <section className="panel" aria-label="Revisão privada de arquivo local">
  <h2>Escala recebida — revisão privada</h2>
  <p className="notice">O arquivo fica neste computador. A leitura acontece somente nesta aba, sem envio ao servidor de testes. Estes rascunhos não são registros de produção nem autorizações de trabalho.</p>
  <label>Selecionar rascunho privado (JSON)<input type="file" accept=".json,application/json" onChange={async e=>{
   const file=e.target.files?.[0];if(!file)return;setError('');setRows([]);setFileName('');
   try{if(file.size>500000)throw Error();const parsed=readLocalDraft(JSON.parse(await file.text()));setRows(parsed);setFileName(file.name);}catch{setError('Não foi possível validar o rascunho local. Nenhum dado foi enviado ou gravado.');}
  }}/></label>
  <details open={!rows.length}><summary>Alternativa: colar rascunho local</summary><p>O conteúdo é processado somente nesta aba; não é enviado nem incluído no código do portal.</p><label>Conteúdo JSON do rascunho<textarea value={pasted} onChange={e=>{const text=e.target.value;setPasted(text);setRows([]);setFileName("");setError("");try{const parsed=readLocalDraft(JSON.parse(text));setRows(parsed);setFileName("rascunho privado colado nesta aba");setError("");}catch{/* Incomplete input stays editable until explicit review. */}}} maxLength={500000}/></label><button onClick={()=>{try{const parsed=readLocalDraft(JSON.parse(pasted));setRows(parsed);setFileName('rascunho privado colado nesta aba');setError('');setPasted('');}catch{setError('Não foi possível validar o rascunho local. Nenhum dado foi enviado ou gravado.');}}}>Revisar conteúdo local</button></details>
  {error&&<p role="alert">{error}</p>}
  {!!fileName&&<><p role="status">Rascunho local {fileName}: {rows.length} alocações para conferência. Esta visualização não grava dados. Guarde o arquivo de origem e reabra-o após recarregar esta página.</p>
  <p>America/New_York · Término não informado · Identidades e referências de projeto/local pendentes de conferência.</p>
  <div className="table-scroll"><table><thead><tr><th>Pessoa conforme mensagem</th><th>Local conforme mensagem</th><th>Data</th><th>Início</th><th>Término</th><th>Conferência</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{r.sourcePerson}</td><td>{r.sourceLocation}{r.locationContext&&<small> · Contexto da localização a confirmar</small>}</td><td>{r.date}</td><td>{r.startTime}</td><td>Não informado</td><td>Identidade e vínculo pendentes</td></tr>)}</tbody></table></div>
  <p>Não cria logins, equipes, vínculos, OS ou horas realizadas. A publicação e a gravação no backend real são etapas separadas.</p></>}
 </section>;
}
