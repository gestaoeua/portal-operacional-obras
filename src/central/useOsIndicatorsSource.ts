import { useEffect, useState } from 'react';
import { ApiError, post } from './transport';

export type IndicatorsSource =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'no_projects' }
  | { kind: 'not_integrated'; message: string }
  | { kind: 'ready'; orders: unknown[]; carregadoEm: string };
type Project = { id: string; name: string };
type ProjectResult = { token: string; revision: number; projects: Project[]; error?: string };
type Result = { token: string; project: string; revision: number; source: IndicatorsSource };
const message = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível consultar indicadores.';

/** Only explicit grants; no field/financial source is merged into the OS ledger. */
export function useOsIndicatorsSource(token: string, revision: number, onExpired: () => void) {
  const [grantResult, setGrantResult] = useState<ProjectResult>();
  const [selection, setSelection] = useState<{token:string; id:string}>();
  const [result, setResult] = useState<Result>();
  const projects = grantResult?.token === token && grantResult.revision === revision ? grantResult.projects : [];
  const selected = selection?.token === token && projects.some(p => p.id === selection.id)
    ? selection.id : projects[0]?.id || '';
  useEffect(() => {
    let active = true;
    setGrantResult(undefined);
    post({action:'listOsProjects',token}).then(data => {
      if (!active) return;
      const seen = new Set<string>();
      if (!Array.isArray(data.projects) || !data.projects.every((p: any) => {
        if (!p || typeof p.id !== 'string' || !p.id.trim() || typeof p.name !== 'string' || seen.has(p.id)) return false;
        seen.add(p.id); return true;
      })) throw Error('Lista de projetos inválida.');
      setGrantResult({token,revision,projects:data.projects});
    }).catch(e => {
      if (!active) return;
      setGrantResult({token,revision,projects:[],error:message(e)});
      if(e instanceof ApiError && e.code==='SESSION_EXPIRED') onExpired();
    });
    return () => {active=false;};
  },[token,revision,onExpired]);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    if (!selected) return () => {active=false;};
    post({action:'listOsOperacional',token,projetoId:selected}).then(data => {
      if (!active) return;
      if (!Array.isArray(data.workOrders) || !data.workOrders.every((o:any)=>o && o.projetoId===selected)) throw Error('Resposta fora do projeto selecionado.');
      setResult({token,project:selected,revision,source:{kind:'ready',orders:data.workOrders,carregadoEm:new Date().toISOString()}});
    }).catch(e => {
      if (!active) return;
      const kind = e instanceof ApiError && ['OS_LEDGER_NOT_CONFIGURED','OS_NOT_CONFIGURED','CONFIG_REQUIRED'].includes(e.code) ? 'not_integrated' : 'error';
      setResult({token,project:selected,revision,source:{kind,message:message(e)}});
      if(e instanceof ApiError && e.code==='SESSION_EXPIRED') onExpired();
    });
    return () => {active=false;};
  },[token,selected,revision,onExpired]);
  let source: IndicatorsSource = {kind:'loading'};
  if(grantResult?.token===token && grantResult.revision===revision) {
    if(grantResult.error) source={kind:'error',message:grantResult.error};
    else if(!projects.length) source={kind:'no_projects'};
    else if(result?.token===token && result.project===selected && result.revision===revision) source=result.source;
  }
  return {projects,selected,source,selectProject:(id:string)=>setSelection({token,id})};
}
