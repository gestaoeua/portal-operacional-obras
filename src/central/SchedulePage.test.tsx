// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import SchedulePage from './SchedulePage';
import {post,ApiError} from './transport';
vi.mock('./transport',()=>({post:vi.fn(),ApiError:class extends Error{constructor(message:string,public code:string){super(message);}}}));
vi.mock('./config',()=>({IS_FIXTURE:true}));
vi.mock('./schedule/SchedulePlanner',()=>({default:({state,onSave}:any)=><div>
 <span data-testid="source-kind">{state.kind}</span>
 {state.kind==='ready'&&state.dataset.assignments.map((a:any)=><span key={a.assignmentId}>{a.personName}</span>)}
 <button onClick={()=>void onSave({personId:'test-person',personName:'Pessoa fictícia',locationId:'test-site',locationName:'Obra fictícia',date:'2026-10-22',sourceLabel:'Teste local'}).catch(()=>{})}>Save fixture draft</button>
</div>}));
const expired=()=>{};
const projects={projects:[{id:'A',name:'Projeto A'},{id:'B',name:'Projeto B'}]};
const assignment=(project='A',name='Pessoa A')=>({assignmentId:'fixture-id',projetoId:project,personId:'fixture-person',personName:name,locationId:'fixture-location',locationName:'Obra fictícia',date:'2026-10-22',timezone:'America/New_York',sourceLabel:'Fixture',revision:1});
const dataset=(project:string,assignments:any[]=[])=>({dataset:{projetoId:project,assignments,updatedAt:'2026-10-21T10:00:00Z'}});
beforeEach(()=>{let n=0;vi.stubGlobal('crypto',{randomUUID:()=>`test-uuid-${++n}`});});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});

it('clears old data on project/token switch and ignores a delayed foreign result',async()=>{
 let finishA:(v:any)=>void=()=>{};
 vi.mocked(post).mockImplementation(async p=>p.action==='listOsProjects'?projects:p.projetoId==='A'?new Promise(r=>finishA=r):dataset('B',[assignment('B','Pessoa B exclusiva')]));
 const view=render(<SchedulePage token="fixture-one" onExpired={expired}/>);
 await waitFor(()=>expect(screen.getByRole('combobox').getAttribute('disabled')).toBeNull());
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'B'}});
 await screen.findByText('Pessoa B exclusiva');
 await act(async()=>finishA(dataset('A',[assignment('A','Pessoa A exclusiva')])));
 expect(screen.queryByText('Pessoa A exclusiva')).toBeNull();
 vi.mocked(post).mockImplementation(async p=>p.action==='listOsProjects'?new Promise(()=>{}):dataset('A'));
 view.rerender(<SchedulePage token="fixture-two" onExpired={expired}/>);
 expect(screen.queryByText('Pessoa B exclusiva')).toBeNull();
});

it('keeps request id and full payload across an uncertain save, refresh, and explicit retry',async()=>{
 let attempts=0;let saved:any;
 const pendingChange=vi.fn();
 vi.mocked(post).mockImplementation(async p=>{
  if(p.action==='listOsProjects')return projects;
  if(p.action==='scheduleSave'){attempts++;saved={...(p.assignment as any),revision:1};if(attempts===1)throw new ApiError('timeout','TIMEOUT');return {ok:true,assignment:saved};}
  return dataset(String(p.projetoId),attempts>1?[saved]:[]);
 });
 render(<SchedulePage token="fixture" onExpired={expired} onPendingChange={pendingChange}/>);
 await waitFor(()=>expect(screen.getByTestId('source-kind').textContent).toBe('ready'));
 fireEvent.click(screen.getByText('Save fixture draft'));
 await screen.findByText('Repetir mesma solicitação');
 expect(pendingChange).toHaveBeenLastCalledWith(true);
 expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'B'}});
 expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('A');
 const warning=new Event('beforeunload',{cancelable:true});window.dispatchEvent(warning);
 expect(warning.defaultPrevented).toBe(true);
 fireEvent.click(screen.getByText('Reler programação salva'));
 await waitFor(()=>expect(screen.getByTestId('source-kind').textContent).toBe('ready'));
 expect(pendingChange).toHaveBeenLastCalledWith(true);
 expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
 fireEvent.click(screen.getByText('Repetir mesma solicitação'));
 await screen.findByText(/Gravado e relido no arquivo local/);
 const writes=vi.mocked(post).mock.calls.filter(([p])=>p.action==='scheduleSave').map(([p])=>p);
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
 expect(screen.queryByText('Repetir mesma solicitação')).toBeNull();
 expect(pendingChange).toHaveBeenLastCalledWith(false);
 expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false);
 const cleared=new Event('beforeunload',{cancelable:true});window.dispatchEvent(cleared);
 expect(cleared.defaultPrevented).toBe(false);
});

it('requires a separate list after save before showing confirmed persistence',async()=>{
 let saved:any;let finishRead:(v:any)=>void=()=>{};
 vi.mocked(post).mockImplementation(async p=>{
  if(p.action==='listOsProjects')return projects;
  if(p.action==='scheduleSave'){saved={...(p.assignment as any),revision:1};return {ok:true,assignment:saved};}
  return saved?new Promise(r=>finishRead=r):dataset(String(p.projetoId));
 });
 render(<SchedulePage token="fixture" onExpired={expired}/>);
 await waitFor(()=>expect(screen.getByTestId('source-kind').textContent).toBe('ready'));
 fireEvent.click(screen.getByText('Save fixture draft'));
 await waitFor(()=>expect(vi.mocked(post).mock.calls.filter(([p])=>p.action==='scheduleList')).toHaveLength(2));
 expect(screen.queryByText(/Gravado e relido no arquivo local/)).toBeNull();
 await act(async()=>finishRead(dataset('A',[saved])));
 expect(screen.getByText(/Gravado e relido no arquivo local/)).toBeTruthy();
});

it('distinguishes an unconfigured source from an empty confirmed ledger',async()=>{
 vi.mocked(post).mockImplementation(async p=>{if(p.action==='listOsProjects')return projects;throw new ApiError('private text','SCHEDULE_NOT_CONFIGURED');});
 render(<SchedulePage token="fixture" onExpired={expired}/>);
 await waitFor(()=>expect(screen.getByTestId('source-kind').textContent).toBe('not_integrated'));
 expect(screen.queryByText('private text')).toBeNull();
});

it('rejects stale confirmation without claiming save success',async()=>{
 let saved:any;
 vi.mocked(post).mockImplementation(async p=>{
  if(p.action==='listOsProjects')return projects;
  if(p.action==='scheduleSave'){saved={...(p.assignment as any),revision:1};return {ok:true,assignment:saved};}
  return dataset(String(p.projetoId));
 });
 render(<SchedulePage token="fixture" onExpired={expired}/>);
 await waitFor(()=>expect(screen.getByTestId('source-kind').textContent).toBe('ready'));
 fireEvent.click(screen.getByText('Save fixture draft'));
 await screen.findByText('Repetir mesma solicitação');
 expect(screen.queryByText(/Gravado e relido no arquivo local/)).toBeNull();
});
