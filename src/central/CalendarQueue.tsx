import { useOsIndicatorsSource } from './useOsIndicatorsSource';
import { validarConjunto } from './analytics/model';

/** The ledger has no appointment fields. Never infer a booking from its stage. */
export default function CalendarQueue({token,revision,onExpired}:{token:string;revision:number;onExpired:()=>void}) {
 const {projects,selected,source,selectProject}=useOsIndicatorsSource(token,revision,onExpired);
 const validated=source.kind==='ready'?validarConjunto(source.orders,selected):null;
 return <section className="panel">
   <h2>Fila para programação</h2>
   <p className="notice">Agenda ainda não integrada. A etapa “Programada” não contém data, horário ou duração. Nenhuma OS abaixo foi colocada automaticamente em um calendário.</p>
   <label>Projeto autorizado<select value={selected} onChange={e=>selectProject(e.target.value)} disabled={!projects.length}>
    {!projects.length&&<option value="">Nenhum projeto disponível</option>}{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
   </select></label>
   {source.kind==='loading'&&<p role="status">Consultando ordens…</p>}
   {source.kind==='error'&&<p role="alert">{source.message}</p>}
   {source.kind==='not_integrated'&&<p>Fonte de OS ainda não integrada.</p>}
   {source.kind==='no_projects'&&<p>Sem vínculo autorizado para consultar ordens.</p>}
   {validated&&!validated.ok&&<p role="alert">Não foi possível validar a lista do projeto.</p>}
   {validated?.ok&&<><div className="table-scroll"><table><thead><tr><th>Serviço</th><th>Etapa</th><th>Responsável</th><th>Agendamento</th></tr></thead><tbody>
    {validated.ordens.filter(o=>o.status!=='Concluída').map(o=><tr key={o.osId}><td>{o.escopo}</td><td>{o.status}</td><td>{o.responsavel||'A definir'}</td><td>Data não informada</td></tr>)}
   </tbody></table></div>{!validated.ordens.some(o=>o.status!=='Concluída')&&<p>Nenhuma OS aberta nesta consulta.</p>}</>}
 </section>;
}
