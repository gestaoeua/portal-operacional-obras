// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import App from './App';
vi.mock('./config',()=>({IS_FIXTURE:true,APPS_SCRIPT_URL:'http://fixture.invalid',FETCH_TIMEOUT_MS:100}));
vi.mock('./fieldApi',()=>({login:async()=>({token:'fixture',userId:'fixture',name:'Fixture',role:'gestor'}),logout:async()=>{},getVisits:async()=>[]}));
vi.mock('./transport',()=>({ApiError:class extends Error{},post:async(p:any)=>p.action==='listOsProjects'?{projects:[{id:'p',name:'Projeto fictício'}]}:{dataset:{projetoId:'p',assignments:[]}}}));
it('opens the actual schedule page from the authenticated central sidebar',async()=>{
 render(<App/>);
 fireEvent.change(screen.getByLabelText('Usuário'),{target:{value:'fixture'}});
 fireEvent.change(screen.getByLabelText('Senha'),{target:{value:'fixture'}});
 fireEvent.click(screen.getByRole('button',{name:/Entrar com segurança/}));
 await screen.findByRole('heading',{name:'Nova ordem de serviço'});
 fireEvent.click(screen.getByRole('button',{name:/Calendário/}));
 await screen.findByRole('heading',{name:'Programação de trabalho'});
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'Nova ordem de serviço'})).toBeNull());
});
