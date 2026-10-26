// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import CalendarQueue from './CalendarQueue';
import {useOsIndicatorsSource} from './useOsIndicatorsSource';
vi.mock('./useOsIndicatorsSource',()=>({useOsIndicatorsSource:vi.fn()}));
afterEach(cleanup);
it('keeps Programada without a date and never infers an appointment from source timestamps',()=>{
 vi.mocked(useOsIndicatorsSource).mockReturnValue({projects:[{id:'FICTICIO',name:'Fictício'}],selected:'FICTICIO',selectProject:()=>{},source:{kind:'ready',carregadoEm:'2026-10-21T00:00:00Z',orders:[{osId:'ficticio',projetoId:'FICTICIO',status:'Programada',escopo:'Serviço fictício',responsavel:'',atualizadoEm:'2026-10-20T00:00:00Z'}]}});
 render(<CalendarQueue token="fixture" revision={0} onExpired={()=>{}}/>);
 expect(screen.getByText('Data não informada')).toBeTruthy();
 expect(screen.queryByText(/20\/10\/2026/)).toBeNull();
 expect(screen.getByText('Programada',{exact:true})).toBeTruthy();
});
