// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PropertiesUnits from './PropertiesUnits';

afterEach(() => cleanup());

const PROJ_A = 'proj-A';
const PROJ_B = 'proj-B';

function datasetFor(proj: string) {
  return {
    properties: [{ propertyId: 'p1', projetoId: proj, name: `Edifício exclusivo de ${proj}` }],
    units: [{ unitId: 'u1', propertyId: 'p1', projetoId: proj, label: 'Unidade 101' }],
  };
}

describe('<PropertiesUnits /> — estados', () => {
  it('estado padrão (sem state) é not_integrated', () => {
    render(<PropertiesUnits projetoId={PROJ_A} />);
    expect(screen.getByText('Locais e unidades ainda não integrados')).toBeTruthy();
  });

  it('ready com listas vazias é distinto de not_integrated e de "nenhum resultado de busca"', () => {
    render(
      <PropertiesUnits projetoId={PROJ_A} state={{ kind: 'ready', dataset: { properties: [], units: [] } }} />,
    );
    expect(screen.getByText('Nenhuma propriedade registrada neste projeto')).toBeTruthy();
    expect(screen.queryByText('Locais e unidades ainda não integrados')).toBeNull();
    expect(screen.queryByText('Nenhuma propriedade encontrada para esta busca.')).toBeNull();
  });

  it('busca local filtra a lista de propriedades e unidades', () => {
    const dataset = {
      properties: [
        { propertyId: 'p1', projetoId: PROJ_A, name: 'Edifício Norte' },
        { propertyId: 'p2', projetoId: PROJ_A, name: 'Edifício Sul' },
      ],
      units: [],
    };
    render(<PropertiesUnits projetoId={PROJ_A} state={{ kind: 'ready', dataset }} />);
    expect(screen.getByText('Edifício Norte')).toBeTruthy();
    expect(screen.getByText('Edifício Sul')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar propriedade ou unidade'), { target: { value: 'Norte' } });
    expect(screen.getByText('Edifício Norte')).toBeTruthy();
    expect(screen.queryByText('Edifício Sul')).toBeNull();
  });

  it('ao mudar projetoId sem atualizar o dataset (ainda do projeto anterior), nunca expõe esse dataset', () => {
    const datasetA = datasetFor(PROJ_A);
    const { rerender } = render(<PropertiesUnits projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetA }} />);
    expect(screen.getAllByText(`Edifício exclusivo de ${PROJ_A}`)).toHaveLength(2);
    // projetoId avança para B, mas o state ainda é o mesmo objeto, com dataset de A
    // (ex.: a troca de projeto aconteceu antes da nova consulta responder).
    rerender(<PropertiesUnits projetoId={PROJ_B} state={{ kind: 'ready', dataset: datasetA }} />);
    expect(screen.queryAllByText(`Edifício exclusivo de ${PROJ_A}`)).toHaveLength(0);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('trocar para loading remove os dados anteriores da tela', () => {
    const { rerender } = render(
      <PropertiesUnits projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />,
    );
    expect(screen.getAllByText(`Edifício exclusivo de ${PROJ_A}`)).toHaveLength(2);
    rerender(<PropertiesUnits projetoId={PROJ_A} state={{ kind: 'loading' }} />);
    expect(screen.queryAllByText(`Edifício exclusivo de ${PROJ_A}`)).toHaveLength(0);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('trocar para error remove os dados anteriores e nunca renderiza state.message arbitrário', () => {
    const { rerender } = render(
      <PropertiesUnits projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />,
    );
    expect(screen.getAllByText(`Edifício exclusivo de ${PROJ_A}`)).toHaveLength(2);
    const mensagemPerigosa = 'segredo-interno-do-backend-nao-deveria-aparecer-aqui';
    rerender(<PropertiesUnits projetoId={PROJ_A} state={{ kind: 'error', message: mensagemPerigosa }} />);
    expect(screen.queryAllByText(`Edifício exclusivo de ${PROJ_A}`)).toHaveLength(0);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain(mensagemPerigosa);
    expect(alert.textContent).toBe('Não foi possível consultar locais e unidades agora. Tente novamente mais tarde.');
  });
});
