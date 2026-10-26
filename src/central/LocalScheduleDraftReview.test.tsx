// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import Review,{readLocalDraft} from './LocalScheduleDraftReview';
const row={sourcePerson:'Pessoa fictícia',sourceLocation:'Local fictício',date:'2026-10-22',startTime:'08:00',endTime:null,timezone:'America/New_York',identityStatus:'unresolved'};
const draft={status:'draft_not_ready_for_dispatch',assignments:[row,row]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('preserves repeated unresolved source rows and never invents a finish',()=>{
 const got=readLocalDraft(draft);expect(got).toHaveLength(2);expect(got[0].endTime).toBeNull();expect(got[0]).not.toBe(row);
});
it('reopening the same source replaces the review instead of appending rows',async()=>{
 render(<Review/>);
 const file={name:'fictional.json',size:200,text:async()=>JSON.stringify(draft)};
 const input=screen.getByLabelText(/Selecionar rascunho privado/);
 fireEvent.change(input,{target:{files:[file]}});
 await screen.findByRole('table');
 fireEvent.change(input,{target:{files:[file]}});
 expect((await screen.findAllByRole('row')).length).toBe(3);
});
it('rejects invalid date or finalized records',()=>{
 expect(()=>readLocalDraft({...draft,status:'approved'})).toThrow();
 expect(()=>readLocalDraft({...draft,assignments:[{...row,date:'2026-02-30'}]})).toThrow();
});
it('reads a selected file locally without network or storage writes',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const store=vi.spyOn(Storage.prototype,'setItem');
 render(<Review/>);fireEvent.change(screen.getByLabelText(/Selecionar rascunho privado/),{target:{files:[{name:'fictional.json',size:200,text:async()=>JSON.stringify(draft)}]}});
 await screen.findByText(/2 alocações para conferência/);expect(screen.getAllByText('Pessoa fictícia')).toHaveLength(2);expect(fetch).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();store.mockRestore();
});
it('reviews pasted draft locally and clears the editor without transmitting',()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(<Review/>);
 fireEvent.change(screen.getByLabelText('Conteúdo JSON do rascunho'),{target:{value:JSON.stringify(draft)}});
 fireEvent.click(screen.getByText('Revisar conteúdo local'));
 expect(screen.getAllByText('Pessoa fictícia')).toHaveLength(2);expect(fetch).not.toHaveBeenCalled();
 expect((screen.getByLabelText('Conteúdo JSON do rascunho') as HTMLTextAreaElement).value).toBe('');
});
