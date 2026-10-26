// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { validarConjunto } from './model';
import TeamsServices from './TeamsServices';
afterEach(cleanup);

it('preserves distinct padded identifiers without merging identities after validation', () => {
  const data = { teams: [
    {teamId:' t ',projetoId:'P',name:'Equipe',members:[{memberId:' m ',name:'  '}]},
    {teamId:'t',projetoId:'P',name:'Outra',members:[]},
  ], services: [
    {serviceId:' s ',projetoId:'P',version:1,name:'S',description:''},
    {serviceId:'s',projetoId:'P',version:1,name:'S',description:''},
  ]};
  const result = validarConjunto(data,'P');
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.dataset.teams.map(t=>t.teamId)).toEqual([' t ','t']);
  expect(result.dataset.teams[0].members[0].memberId).toBe(' m ');
  expect(result.dataset.services.map(s=>s.serviceId)).toEqual([' s ','s']);
  render(<TeamsServices projetoId="P" state={{kind:'ready',dataset:data}}/>);
  expect(screen.getByText('Nao informado')).toBeTruthy();
});
