import {useEffect,useRef,useState} from 'react';
import {post} from './transport';
import {IS_FIXTURE} from './config';
type Draft={dedupeKey:string;projetoId:string;textoBruto:string|null;status:string;osId:string|null};
const PROJECT='PILOTO_FICTICIO_KAPSO';
export default function KapsoDrafts({token,onOpenOrders,onPendingChange}:{token:string;onOpenOrders:()=>void;onPendingChange?:(p:boolean)=>void}){
 const [rows,setRows]=useState<Draft[]>([]),[selected,setSelected]=useState(''),[scope,setScope]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [pending,setPending]=useState<Record<string,unknown>|null>(null),guard=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onPendingChange?.(!!pending);const warn=(e:BeforeUnloadEvent)=>{if(pending){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>{onPendingChange?.(false);window.removeEventListener('beforeunload',warn);};},[pending,onPendingChange]);
 async function read(){const data=await post({action:'listKapsoDrafts',token,projetoId:PROJECT});if(data.source!=='synthetic-local-sqlite'||data.projetoId!==PROJECT||!Array.isArray(data.drafts)||!data.drafts.every((d:any)=>d.projetoId===PROJECT&&typeof d.dedupeKey==='string'&&(d.textoBruto===null||typeof d.textoBruto==='string')&&(d.osId===null||typeof d.osId==='string')))throw Error('Invalid response');if(alive.current)setRows(data.drafts);return data.drafts as Draft[];}
 useEffect(()=>{if(IS_FIXTURE)void read().catch(()=>{if(alive.current)setError('Fonte de rascunhos indisponível. Nenhum resultado confirmado.');});},[token]);
 async function run(command?:Record<string,unknown>){if(guard.current)return;guard.current=true;setBusy(true);setError('');setNotice('');try{
  if(command){setPending(command);const saved=await post({...command,token,projetoId:PROJECT});const fresh=await read();if(!saved.workOrder||!fresh.some(d=>d.dedupeKey===command.draftKey&&d.osId===saved.workOrder.osId))throw Error('Unconfirmed');setPending(null);setSelected('');setScope('');setNotice('OS fictícia gravada e relida no SQLite local. Disponível em Ordens de serviço. Não despachada.');}
  else{await post({action:'simulateKapsoMessage',token,projetoId:PROJECT});await read();setNotice('Mensagem sintética processada e relida. Repetir este teste não cria outra cópia.');}
 }catch{setError(command?'Gravação não confirmada. Reconciliar o mesmo pedido antes de continuar.':'Não foi possível confirmar o teste. Releia os rascunhos.');}finally{guard.current=false;if(alive.current)setBusy(false);}}
 if(!IS_FIXTURE)return <section className="panel"><h2>Mensagens recebidas</h2><p>Kapso ainda não integrado. Nenhum webhook externo está ativo por esta tela.</p></section>;
 return <section className="panel"><h2>Mensagens recebidas · Kapso</h2><p className="notice">TESTE LOCAL COM MENSAGEM SINTÉTICA. Nenhuma conexão com WhatsApp, cobrança, envio ou dado de cliente. Persistência em SQLite neste computador.</p>
 <button disabled={busy||!!pending} onClick={()=>void run()}>Processar mensagem sintética fixa</button>{' '}<button disabled={busy} onClick={()=>void read().catch(()=>setError('Falha na leitura.'))}>Reler rascunhos</button>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!rows.length&&<p>Nenhum rascunho recebido nesta fonte local.</p>}
 {rows.map(d=><article className="panel" key={d.dedupeKey}><h3>{d.osId?'OS criada após revisão':'Aguardando revisão humana'}</h3><p>{d.textoBruto||'Mensagem sem texto. Conteúdo exige conferência.'}</p><p>Origem: evento sintético Kapso · Projeto fictício explícito.</p><p>Endereço, equipe, responsável e horários não informados. Nada foi inferido do texto.</p>{d.osId?<><p>OS: {d.osId}</p><button disabled={!!pending} onClick={onOpenOrders}>Ver em Ordens de serviço</button></>:<button disabled={busy||!!pending} onClick={()=>{setSelected(d.dedupeKey);setScope(d.textoBruto||'');}}>Conferir rascunho</button>}</article>)}
 {selected&&<form onSubmit={e=>{e.preventDefault();if(!pending)void run({action:'approveKapsoDraft',draftKey:selected,requestId:crypto.randomUUID(),escopo:scope.trim()});}}><h3>Revisão antes de criar OS</h3><label>Escopo conferido (somente teste)<textarea aria-label="Escopo conferido" value={scope} onChange={e=>setScope(e.target.value)} disabled={busy||!!pending} required maxLength={2048}/></label><p>A confirmação cria somente uma OS local na etapa Recebida, sem atribuir equipe ou despachar.</p><button disabled={busy||!!pending||scope.trim().length<3}>Confirmar revisão e criar OS fictícia</button></form>}
 {pending&&<button disabled={busy} onClick={()=>void run(pending)}>Reconciliar mesmo pedido</button>}
 </section>;
}
