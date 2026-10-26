// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { useOsIndicatorsSource } from './useOsIndicatorsSource';
import { post } from './transport';
vi.mock('./transport',()=>({post:vi.fn(),ApiError:class extends Error {code='SESSION_EXPIRED';}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const expired=()=>{};
it('ignores delayed result from previous project and clears data on token change',async()=>{
 let finishA:(v:any)=>void=()=>{};
 vi.mocked(post).mockImplementation(async p=>p.action==='listOsProjects'?{projects:[{id:'A',name:'Ficticio A'},{id:'B',name:'Ficticio B'}]}:p.projetoId==='A'?new Promise(r=>finishA=r):{workOrders:[{projetoId:'B',osId:'b'}]});
 const h=renderHook(({token})=>useOsIndicatorsSource(token,0,expired),{initialProps:{token:'fixture-one'}});
 await waitFor(()=>expect(h.result.current.selected).toBe('A'));
 act(()=>h.result.current.selectProject('B'));
 await waitFor(()=>expect(h.result.current.source.kind).toBe('ready'));
 await act(async()=>finishA({workOrders:[{projetoId:'A',osId:'a'}]}));
 expect(h.result.current.source).toMatchObject({kind:'ready',orders:[{osId:'b'}]});
 h.rerender({token:'fixture-two'});expect(h.result.current.source.kind).not.toBe('ready');
});
it('rejects cross-project results and distinguishes no grants from an empty ledger',async()=>{
 vi.mocked(post).mockResolvedValueOnce({projects:[{id:'A',name:'A'}]}).mockResolvedValueOnce({workOrders:[{projetoId:'B'}]});
 const h=renderHook(()=>useOsIndicatorsSource('fixture',0,expired));
 await waitFor(()=>expect(h.result.current.source.kind).toBe('error'));
 cleanup();vi.mocked(post).mockResolvedValue({projects:[]});
 const empty=renderHook(()=>useOsIndicatorsSource('fixture',0,expired));
 await waitFor(()=>expect(empty.result.current.source.kind).toBe('no_projects'));
});
it('invalidates grants immediately on refresh and ignores a pending ledger after revocation',async()=>{
 let finish:(v:any)=>void=()=>{};
 vi.mocked(post).mockImplementation(async p=>p.action==='listOsProjects'?{projects:[{id:'A',name:'A'}]}:new Promise(r=>finish=r));
 const h=renderHook(({revision})=>useOsIndicatorsSource('fixture',revision,expired),{initialProps:{revision:0}});
 await waitFor(()=>expect(h.result.current.selected).toBe('A'));
 vi.mocked(post).mockResolvedValue({projects:[]});
 h.rerender({revision:1});
 expect(h.result.current.projects).toEqual([]);
 expect(h.result.current.source.kind).not.toBe('ready');
 await waitFor(()=>expect(h.result.current.source.kind).toBe('no_projects'));
 await act(async()=>finish({workOrders:[{projetoId:'A',osId:'a'}]}));
 expect(h.result.current.source.kind).toBe('no_projects');
});
