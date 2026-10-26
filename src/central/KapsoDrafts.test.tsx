// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
vi.mock('./config',()=>({IS_FIXTURE:true}));
vi.mock('./transport',()=>({post:vi.fn()}));
import {post} from './transport';
import KapsoDrafts from './KapsoDrafts';
const draft={dedupeKey:'fixture-key',projetoId:'PILOTO_FICTICIO_KAPSO',textoBruto:'FIXTURE mensagem sem endereço',status:'aguardando_revisao_humana',osId:null};
const dataset=(rows:any[])=>({source:'synthetic-local-sqlite',projetoId:draft.projetoId,drafts:rows});
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('requires human confirmation and independent reread before showing an OS',async()=>{
 const api=vi.mocked(post);let saved=false;api.mockImplementation(async(p)=>p.action==='approveKapsoDraft'?(saved=true,{ok:true,workOrder:{osId:'OS-fixture'}}):dataset([{...draft,osId:saved?'OS-fixture':null}]));
 const open=vi.fn();render(<KapsoDrafts token="fixture" onOpenOrders={open}/>);
 await screen.findByText('Aguardando revisão humana');expect(api.mock.calls.some(([p])=>p.action==='approveKapsoDraft')).toBe(false);
 fireEvent.click(screen.getByText('Conferir rascunho'));fireEvent.click(screen.getByText('Confirmar revisão e criar OS fictícia'));
 await screen.findByText(/OS fictícia gravada e relida/);expect(api.mock.calls.filter(([p])=>p.action==='listKapsoDrafts').length).toBe(2);fireEvent.click(screen.getByText('Ver em Ordens de serviço'));expect(open).toHaveBeenCalledOnce();
});
it('uncertain write keeps exact request for retry and never claims success from receipt alone',async()=>{
 const api=vi.mocked(post);api.mockImplementation(async(p)=>p.action==='approveKapsoDraft'?{workOrder:{osId:'OS-fixture'}}:dataset([draft]));
 render(<KapsoDrafts token="fixture" onOpenOrders={()=>{}}/>);await screen.findByText('Aguardando revisão humana');fireEvent.click(screen.getByText('Conferir rascunho'));fireEvent.click(screen.getByText('Confirmar revisão e criar OS fictícia'));
 await screen.findByRole('alert');expect(screen.queryByText(/OS fictícia gravada e relida/)).toBeNull();const first=api.mock.calls.find(([p])=>p.action==='approveKapsoDraft')![0];fireEvent.click(screen.getByText('Reconciliar mesmo pedido'));await waitFor(()=>expect(api.mock.calls.filter(([p])=>p.action==='approveKapsoDraft').length).toBe(2));expect(api.mock.calls.filter(([p])=>p.action==='approveKapsoDraft')[1][0]).toEqual(first);
});
it('rejects a foreign project response and never renders its text',async()=>{
 vi.mocked(post).mockResolvedValue(dataset([{...draft,projetoId:'other',textoBruto:'PRIVATE_OTHER'}]));render(<KapsoDrafts token="fixture" onOpenOrders={()=>{}}/>);await screen.findByRole('alert');expect(screen.queryByText('PRIVATE_OTHER')).toBeNull();
});
