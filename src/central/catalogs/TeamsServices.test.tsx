// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TeamsServices from './TeamsServices';

afterEach(() => cleanup());

const PROJ_A = 'proj-A';
const PROJ_B = 'proj-B';

function datasetFor(proj: string) {
  return {
    teams: [
      {
        teamId: 't1',
        projetoId: proj,
        name: `Equipe exclusiva de ${proj}`,
        members: [{ memberId: 'm1', name: 'Ana' }],
      },
    ],
    services: [
      { serviceId: 's1', projetoId: proj, version: 1, name: 'Pintura', description: 'Pintura interna' },
      { serviceId: 's1', projetoId: proj, version: 2, name: 'Pintura', description: 'Pintura interna revisada' },
    ],
  };
}

describe('<TeamsServices /> — estados', () => {
  it('estado padrão (sem state) é not_integrated', () => {
    render(<TeamsServices projetoId={PROJ_A} />);
    expect(screen.getByText('Equipes e serviços ainda não integrados')).toBeTruthy();
  });

  it('ready com listas vazias é distinto de not_integrated e de "nenhum resultado de busca"', () => {
    render(<TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: { teams: [], services: [] } }} />);
    expect(screen.getByText('Nenhuma equipe registrada neste projeto')).toBeTruthy();
    expect(screen.queryByText('Equipes e serviços ainda não integrados')).toBeNull();
    expect(screen.queryByText('Nenhuma equipe encontrada para esta busca.')).toBeNull();
  });

  it('busca local filtra a lista de equipes', () => {
    const dataset = {
      teams: [
        { teamId: 't1', projetoId: PROJ_A, name: 'Equipe Norte', members: [] },
        { teamId: 't2', projetoId: PROJ_A, name: 'Equipe Sul', members: [] },
      ],
      services: [],
    };
    render(<TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset }} />);
    expect(screen.getByText('Equipe Norte')).toBeTruthy();
    expect(screen.getByText('Equipe Sul')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar equipe ou serviço'), { target: { value: 'Norte' } });
    expect(screen.getByText('Equipe Norte')).toBeTruthy();
    expect(screen.queryByText('Equipe Sul')).toBeNull();
  });

  it('mostra as duas versões distintas do mesmo serviço, não apenas a mais recente', () => {
    render(<TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Serviços' }));
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('v2')).toBeTruthy();
  });

  it('ao mudar projetoId sem atualizar o dataset (ainda do projeto anterior), nunca expõe esse dataset', () => {
    const datasetA = datasetFor(PROJ_A);
    const { rerender } = render(<TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetA }} />);
    expect(screen.getByText(`Equipe exclusiva de ${PROJ_A}`)).toBeTruthy();
    // projetoId avança para B, mas o state ainda é o mesmo objeto, com dataset de A
    // (ex.: a troca de projeto aconteceu antes da nova consulta responder).
    rerender(<TeamsServices projetoId={PROJ_B} state={{ kind: 'ready', dataset: datasetA }} />);
    expect(screen.queryByText(`Equipe exclusiva de ${PROJ_A}`)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('trocar para loading remove os dados anteriores da tela', () => {
    const { rerender } = render(
      <TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />,
    );
    expect(screen.getByText(`Equipe exclusiva de ${PROJ_A}`)).toBeTruthy();
    rerender(<TeamsServices projetoId={PROJ_A} state={{ kind: 'loading' }} />);
    expect(screen.queryByText(`Equipe exclusiva de ${PROJ_A}`)).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('trocar para error remove os dados anteriores e nunca renderiza state.message arbitrário', () => {
    const { rerender } = render(
      <TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />,
    );
    expect(screen.getByText(`Equipe exclusiva de ${PROJ_A}`)).toBeTruthy();
    const mensagemPerigosa = 'segredo-interno-do-backend-nao-deveria-aparecer-aqui';
    rerender(<TeamsServices projetoId={PROJ_A} state={{ kind: 'error', message: mensagemPerigosa }} />);
    expect(screen.queryByText(`Equipe exclusiva de ${PROJ_A}`)).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain(mensagemPerigosa);
    expect(alert.textContent).toBe('Não foi possível consultar equipes e serviços agora. Tente novamente mais tarde.');
  });
});

describe('<TeamsServices /> — prop view', () => {
  it('sem a prop view, preserva o alternador interno (uncontrolled), começando em "teams"', () => {
    render(<TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />);
    expect(screen.getByText(`Equipe exclusiva de ${PROJ_A}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Serviços' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Serviços' }));
    expect(screen.queryByText(`Equipe exclusiva de ${PROJ_A}`)).toBeNull();
    expect(screen.getByText('v1')).toBeTruthy();
  });

  it('com view="services", mostra serviços direto e não renderiza o alternador (controlled)', () => {
    render(<TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} view="services" />);
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.queryByText(`Equipe exclusiva de ${PROJ_A}`)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Equipes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Serviços' })).toBeNull();
  });

  it('com view="teams", mostra equipes direto e não renderiza o alternador (controlled)', () => {
    render(<TeamsServices projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} view="teams" />);
    expect(screen.getByText(`Equipe exclusiva de ${PROJ_A}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Equipes' })).toBeNull();
  });
});
