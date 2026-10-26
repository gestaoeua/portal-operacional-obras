import OsIndicators from './analytics/OsIndicators';
import { useOsIndicatorsSource } from './useOsIndicatorsSource';
import ModuleIntegrationStatus from './ModuleIntegrationStatus';

export default function OsIndicatorsPage({token,revision,onExpired}:{token:string;revision:number;onExpired:()=>void}) {
  const {projects,selected,source,selectProject}=useOsIndicatorsSource(token,revision,onExpired);
  return <>
    <section className="panel"><label>Projeto autorizado
      <select value={selected} disabled={!projects.length} onChange={e=>selectProject(e.target.value)}>
        {!projects.length&&<option value="">Nenhum projeto disponível</option>}
        {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label><p className="muted">Indicadores derivados somente das ordens do projeto selecionado.</p></section>
    {source.kind==='no_projects'?<section className="panel"><h2>Sem projeto autorizado</h2><p>Este usuário não possui um vínculo de projeto disponível. Nenhum indicador foi calculado.</p></section>:<OsIndicators projetoId={selected} state={source}/>}
    <ModuleIntegrationStatus/>
  </>;
}
