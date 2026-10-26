import {useEffect,useRef,useState, type ComponentProps} from 'react';
import SchedulePlanner from './schedule/SchedulePlanner';
import {createScheduleApi, type PlannedAssignment, type ScheduleDataset} from './scheduleApi';
import {post,ApiError} from './transport';
import {IS_FIXTURE} from './config';
import LocalScheduleDraftReview from './LocalScheduleDraftReview';

type Project={id:string;name:string};
type Result={token:string;project:string;dataset?:ScheduleDataset;error?:string;unavailable?:boolean};
const api=createScheduleApi();
export default function SchedulePage({token,onExpired,onPendingChange}:{token:string;onExpired:()=>void;onPendingChange?:(pending:boolean)=>void}) {
 const [grants,setGrants]=useState<{token:string;projects:Project[];error?:boolean}>();
 const [choice,setChoice]=useState<{token:string;project:string}>();
 const [result,setResult]=useState<Result>();
 const [refresh,setRefresh]=useState(0),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [hasPending,setHasPending]=useState(false);
 const pending=useRef<{token:string;project:string;assignment:PlannedAssignment;requestId:string;expectedRevision:number}>();
 const current=useRef({token,project:''});
 const projects=grants?.token===token?grants.projects:[];
 const project=choice?.token===token&&projects.some(p=>p.id===choice.project)?choice.project:projects[0]?.id||'';
 current.current={token,project};
 useEffect(()=>{let active=true;setGrants(undefined);post({action:'listOsProjects',token}).then(r=>{
  if(!Array.isArray(r.projects)||!r.projects.every((p:any)=>p&&typeof p.id==='string'&&p.id.trim()&&typeof p.name==='string')||new Set(r.projects.map((p:any)=>p.id)).size!==r.projects.length)throw Error();
  if(active)setGrants({token,projects:r.projects.map((p:Project)=>({id:p.id,name:p.name}))});
 }).catch(e=>{if(active){setGrants({token,projects:[],error:true});if(e instanceof ApiError&&e.code==='SESSION_EXPIRED')onExpired();}});return()=>{active=false;};},[token,onExpired]);
 useEffect(()=>{onPendingChange?.(hasPending);return()=>onPendingChange?.(false);},[hasPending,onPendingChange]);
 useEffect(()=>{if(!hasPending)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[hasPending]);
 useEffect(()=>{pending.current=undefined;setHasPending(false);setNotice('');},[token,project]);
 useEffect(()=>{let active=true;setResult(undefined);if(!project)return;
  api.list(token,project).then(dataset=>{if(active)setResult({token,project,dataset});}).catch(e=>{if(active){setResult({token,project,error:'Não foi possível consultar a programação.',unavailable:e instanceof ApiError&&['SCHEDULE_NOT_CONFIGURED','CONFIG_REQUIRED'].includes(e.code)});if(e instanceof ApiError&&e.code==='SESSION_EXPIRED')onExpired();}});
  return()=>{active=false;};
 },[token,project,refresh,onExpired]);
 const visible=result?.token===token&&result.project===project?result:undefined;
 let state:ComponentProps<typeof SchedulePlanner>['state']={kind:'loading'};
 if(visible?.dataset)state={kind:'ready',dataset:visible.dataset};
 else if(visible?.unavailable)state={kind:'not_integrated'};
 else if(visible?.error)state={kind:'error',message:visible.error};
 async function execute(command:NonNullable<typeof pending.current>){
  setBusy(true);setNotice('');
  try {
   const dataset=await api.save(command.token,command.project,command.assignment,command.requestId,command.expectedRevision);
   if(current.current.token===command.token&&current.current.project===command.project){setResult({token:command.token,project:command.project,dataset});pending.current=undefined;setHasPending(false);setNotice(IS_FIXTURE?'Gravado e relido no arquivo local de teste. Dados fictícios; nenhuma planilha real foi alterada.':'Programação gravada e confirmada por releitura.');}
  }catch(e){
   if(current.current.token===command.token&&current.current.project===command.project){
    const rejected=e instanceof ApiError&&['SCHEDULE_INVALID','SCHEDULE_TIME_AMBIGUOUS','REVISION_CONFLICT','SCHEDULE_NOT_CONFIGURED','ROLE_FORBIDDEN','PROJECT_FORBIDDEN'].includes(e.code);
    if(rejected){pending.current=undefined;setHasPending(false);}
    setNotice(rejected?'Solicitação rejeitada sem nova gravação. Confira os dados e permissões.':'Gravação não confirmada. Releia a lista ou repita exatamente a mesma solicitação antes de mudar de tela.');if(e instanceof ApiError&&e.code==='SESSION_EXPIRED')onExpired();}
   throw new Error('Não foi possível confirmar a gravação. Confira o aviso acima.');
  }finally{setBusy(false);}
 }
 return <>
  {IS_FIXTURE&&<LocalScheduleDraftReview/>}
  <section className="panel"><h2>Programação de trabalho</h2><p>Planejamento em America/New_York. Não altera horas realizadas nem despacha serviços.</p>
  {IS_FIXTURE&&<p className="notice">PRÉVIA LOCAL · dados de teste. Dados reais não estão gravados neste backend de teste.</p>}
  <label>Projeto autorizado<select disabled={busy||hasPending||!projects.length} value={project} onChange={e=>{if(!pending.current)setChoice({token,project:e.target.value});}}>{!projects.length&&<option value="">Sem projeto disponível</option>}{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {grants?.token===token&&grants.error&&<p role="alert">Não foi possível consultar os projetos autorizados.</p>}
  {grants?.token===token&&!grants.error&&!projects.length&&<p>Sem vínculo de projeto. Nenhuma programação pode ser consultada.</p>}
  <button disabled={busy||!project} onClick={()=>setRefresh(v=>v+1)}>Reler programação salva</button>
  {notice&&<p role="status">{notice}</p>}
  {pending.current&&pending.current.token===token&&pending.current.project===project&&!busy&&<button onClick={()=>void execute(pending.current!).catch(()=>{})}>Repetir mesma solicitação</button>}
  </section>
  {project&&<SchedulePlanner key={token+':'+project} projetoId={project} state={state} onSave={async draft=>{
   if(busy||pending.current)throw Error('Confira a solicitação anterior antes de criar outra.');
   const assignment:PlannedAssignment={assignmentId:crypto.randomUUID(),projetoId:project,personId:draft.personId,personName:draft.personName,locationId:draft.locationId,locationName:draft.locationName,date:draft.date,startTime:draft.startTime,endTime:draft.endTime,timezone:'America/New_York',sourceLabel:draft.sourceLabel,revision:0};
   const command={token,project,assignment,requestId:crypto.randomUUID(),expectedRevision:0};pending.current=command;setHasPending(true);
   await execute(command);
  }}/>}
 </>;
}
