import { useEffect, useRef, useState } from 'react';
import { ApiError, post } from './transport';
import type { UserSession } from './types';
import './OsOperacional.css';

const stages = ['Recebida', 'Em conferência', 'Programada', 'Em execução', 'Aguardando validação', 'Concluída'];
type Event = { RequestId:string; TipoEvento:string; StatusNovo:string; UsuarioId:string; CriadoEm:string; Motivo:string; ResponsavelNovo:string; Revisao:string };
type Order = { osId:string; projetoId:string; escopo:string; status:string; responsavel:string; revisao:number; atualizadoEm:string; historico:Event[] };
type Project = { id:string; name:string };
type Member = { userId:string; name:string; role:string };
type Command = Record<string, unknown>;
function validOrder(value: any, project: string): value is Order {
  return value && typeof value.osId === 'string' && value.projetoId === project && typeof value.escopo === 'string' &&
    stages.includes(value.status) && typeof value.responsavel === 'string' && Number.isSafeInteger(value.revisao) && value.revisao > 0 && Array.isArray(value.historico);
}
const describe = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível consultar a OS.';
const uncertain = (e: unknown) => e instanceof ApiError && ['WRITE_UNCONFIRMED','TIMEOUT','NETWORK','REQUEST_FAILED'].includes(e.code);

export default function OsOperacional({session, revision, onExpired, onPendingChange}: {session:UserSession; revision:number; onExpired:()=>void; onPendingChange?:(pending:boolean)=>void}) {
  const [projects,setProjects] = useState<Project[]>([]), [project,setProject] = useState('');
  const [members,setMembers] = useState<Member[]>([]), [orders,setOrders] = useState<Order[]>([]);
  const [selected,setSelected] = useState<Order|null>(null), [scope,setScope] = useState(''), [assignee,setAssignee] = useState(''), [reason,setReason] = useState('');
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false), [loading,setLoading] = useState(false);
  const [pending,setPending] = useState<Command|null>(null);
  const operation = useRef(false), generation = useRef(0);
  const [readOnly,setReadOnly]=useState(false);
  const manager = session.role !== 'executor' && !readOnly;
  useEffect(()=>{onPendingChange?.(!!pending);return()=>onPendingChange?.(false);},[pending,onPendingChange]);
  function fail(e:unknown) {
    if(e instanceof ApiError && e.code==='SESSION_EXPIRED') onExpired();
    else {
      if(e instanceof ApiError && e.code==='PROJECT_FORBIDDEN') {setOrders([]);setMembers([]);setSelected(null);}
      setError(describe(e));
    }
  }

  useEffect(() => {
    let active=true;
    post({action:'listOsProjects',token:session.token}).then(data=>{
      if(!active) return;
      if(!Array.isArray(data.projects)) throw Error('Lista de projetos inválida.');
      setProjects(data.projects); setProject(data.projects[0]?.id || '');
    }).catch(e=>{if(active) fail(e);});
    return ()=>{active=false;};
  },[session.token]);

  async function reload(projectId=project, selectedId=selected?.osId, expected=generation.current) {
    if(!projectId) return;
    setLoading(true);
    try {
      const [list,people] = await Promise.all([
        post({action:'listOsOperacional',token:session.token,projetoId:projectId}),
        post({action:'listOsMembers',token:session.token,projetoId:projectId})
      ]);
      if(expected!==generation.current) return;
      if(!Array.isArray(list.workOrders) || !list.workOrders.every((o:any)=>validOrder(o,projectId)) || !Array.isArray(people.members)) throw Error('Resposta de OS inválida. Nenhum resultado confirmado.');
      setOrders(list.workOrders); setMembers(people.members); setReadOnly(list.readOnly===true);
      if(selectedId) { const current=list.workOrders.find((o:Order)=>o.osId===selectedId) || null; setSelected(current); setAssignee(current?.responsavel || ''); }
    } catch(e) {if(expected===generation.current) fail(e);}
    finally {if(expected===generation.current) setLoading(false);}
  }
  useEffect(()=>{
    generation.current++; setOrders([]); setMembers([]); setSelected(null); setError(''); setNotice(''); setScope(''); setReason('');
    void reload(project,undefined,generation.current);
    return ()=>{generation.current++;};
  },[project,session.token]);
  useEffect(()=>{if(project) void reload();},[revision]);
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{if(pending){e.preventDefault(); e.returnValue='';}};
    window.addEventListener('beforeunload',warn); return ()=>window.removeEventListener('beforeunload',warn);
  },[pending]);

  async function open(id:string) {
    if(operation.current || pending) return;
    const currentGeneration=generation.current;
    setLoading(true); setError(''); setNotice('');
    try {
      const data=await post({action:'detailOsOperacional',token:session.token,projetoId:project,osId:id});
      if(currentGeneration!==generation.current) return;
      if(!validOrder(data.workOrder,project) || data.workOrder.osId!==id) throw Error('Detalhe de OS inválido.');
      setSelected(data.workOrder);setAssignee(data.workOrder.responsavel);setReason('');
    }catch(e){if(currentGeneration===generation.current)fail(e);}
    finally{if(currentGeneration===generation.current)setLoading(false);}
  }
  async function execute(command:Command) {
    if(operation.current) return;
    operation.current=true;
    const expected=generation.current;
    try {
      setBusy(true);setError('');setNotice('');setPending(command);
      const data=await post({...command,token:session.token});
      if(expected!==generation.current) return;
      if(!validOrder(data.workOrder,project)) { throw new ApiError('Resposta incompleta. Confira o histórico e reconcilie o mesmo pedido.','WRITE_UNCONFIRMED'); }
      setPending(null);setSelected(data.workOrder);setAssignee(data.workOrder.responsavel);setReason('');setScope('');
      setOrders(previous=>[data.workOrder,...previous.filter(o=>o.osId!==data.workOrder.osId)]);
      setNotice(`OS salva e confirmada. Revisão ${data.workOrder.revisao}.`);
    }catch(e){if(expected===generation.current){if(!uncertain(e))setPending(null);fail(e);}}
    finally{operation.current=false;if(expected===generation.current)setBusy(false);}
  }
  function mutate(action:string, fields:Command={}) {
    if(pending || operation.current) return;
    const command:Command={action,projetoId:project,requestId:crypto.randomUUID(),...fields};
    if(action!=='createOsOperacional' && selected) {command.osId=selected.osId;command.expectedRevision=selected.revisao;}
    void execute(command);
  }
  const disabled=busy || !!pending || loading;
  const next=selected ? stages[stages.indexOf(selected.status)+1] : undefined;
  const mayAdvance=manager || selected?.responsavel===session.userId;
  return <section className="os-operacional" aria-label="OS operacional">
    <div className="panel os-controls">
      <label>Projeto autorizado<select aria-label="Projeto autorizado" value={project} disabled={busy||!!pending} onChange={e=>setProject(e.target.value)}>
        {!projects.length && <option value="">Nenhum projeto autorizado</option>}
        {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <button disabled={!project||busy||loading} onClick={()=>{setError('');void reload();}}>Recarregar OS</button>
      <span className="muted">{loading?'Consultando a fonte…':`${orders.length} OS neste projeto`}</span>
    </div>
    <p className="notice">WhatsApp automático ainda não integrado. Estas ordens são registradas pela equipe autenticada.</p>
    {error && <p role="alert" className="alert">{error}</p>}
    {notice && <p role="status" className="os-success">{notice}</p>}
    {pending && !busy && <section className="alert"><b>Gravação não confirmada</b><p>Não crie outra OS. Recarregue a lista e confira o histórico; a reconciliação abaixo repete exatamente o mesmo pedido, sem gerar novo identificador.</p><code>{String(pending.requestId)}</code><button onClick={()=>void execute(pending)}>Reconciliar mesmo pedido</button></section>}
    {project && manager && <form className="panel" onSubmit={e=>{e.preventDefault();mutate('createOsOperacional',{escopo:scope.trim()});}}>
      <h2>Nova ordem de serviço</h2><label>Descrição do serviço<textarea aria-label="Descrição do serviço" value={scope} onChange={e=>setScope(e.target.value)} maxLength={2048} required disabled={disabled}/></label>
      <p className="muted">A OS começa em Recebida. Responsável e demais informações serão conferidos pela equipe.</p>
      <button className="primary" type="submit" disabled={disabled||!scope.trim()}>Criar e salvar OS</button>
    </form>}
    <div className="os-columns"><section className="panel"><h2>Ordens de serviço</h2>
      {!orders.length && <p>{loading?'Carregando…':'Nenhuma OS confirmada neste projeto.'}</p>}
      {orders.map(o=><button className="os-list-item" key={o.osId} disabled={busy||!!pending||loading} aria-pressed={selected?.osId===o.osId} onClick={()=>void open(o.osId)}><strong>{o.escopo}</strong><span>{o.status} · revisão {o.revisao}</span><small>{o.responsavel || 'Responsável não atribuído'}</small></button>)}
    </section>
    <section className="panel" aria-label="Detalhe da OS">{!selected ? <p>Selecione uma OS para conferir andamento e histórico.</p> : <>
      <h2>{selected.escopo}</h2><small className="muted">OS {selected.osId} · revisão {selected.revisao}</small>
      <ol className="os-stages" aria-label="Etapas da OS">{stages.map((s,i)=><li key={s} className={i<=stages.indexOf(selected.status)?'reached':''} aria-current={s===selected.status?'step':undefined}>{s}</li>)}</ol>
      <p><b>Etapa atual:</b> {selected.status}</p>
      <label>Responsável<select aria-label="Responsável" value={assignee} onChange={e=>setAssignee(e.target.value)} disabled={disabled||!manager}>
        <option value="">Não atribuído</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name} ({m.userId})</option>)}
      </select></label>
      {manager && <button disabled={disabled||!assignee||assignee===selected.responsavel} onClick={()=>mutate('assignOsOperacional',{responsavel:assignee})}>Salvar responsável</button>}
      <label>Observação / evidência textual<textarea aria-label="Observação / evidência textual" maxLength={2048} value={reason} onChange={e=>setReason(e.target.value)} disabled={disabled||readOnly}/></label>
      <div className="os-actions">{next && mayAdvance && !readOnly && <button className="primary" disabled={disabled||(next==='Concluída'&&!reason.trim())} onClick={()=>mutate('advanceOsOperacional',{statusNovo:next,motivo:reason.trim()})}>Avançar para {next}</button>}
      {selected.status==='Concluída'&&manager&&<button disabled={disabled||!reason.trim()} onClick={()=>mutate('reopenOsOperacional',{statusNovo:'Em execução',motivo:reason.trim()})}>Reabrir OS em execução</button>}</div>
      {readOnly&&<p className="notice">Fonte local de teste: criação por revisão de rascunho e leitura. Alterações de andamento e atribuição não habilitadas nesta fonte.</p>}<h3>Histórico persistido</h3><ol className="os-history">{selected.historico.map(e=><li key={e.RequestId}><strong>Rev. {e.Revisao} · {e.StatusNovo}</strong><span>{e.TipoEvento} · {e.UsuarioId} · {new Date(e.CriadoEm).toLocaleString('pt-BR')}</span>{e.ResponsavelNovo&&<span>Responsável: {e.ResponsavelNovo}</span>}{e.Motivo&&<p>{e.Motivo}</p>}</li>)}</ol>
    </>}</section></div>
  </section>;
}
