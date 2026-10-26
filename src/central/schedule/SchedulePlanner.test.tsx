// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SchedulePlanner from './SchedulePlanner';

afterEach(() => cleanup());

const PROJ_A = 'proj-A';
const PROJ_B = 'proj-B';

function datasetFor(proj: string) {
  return {
    projetoId: proj,
    assignments: [
      {
        assignmentId: 'a1',
        projetoId: proj,
        personId: 'p1',
        personName: `Pessoa exclusiva de ${proj}`,
        locationId: 'l1',
        locationName: 'Casa A',
        date: '2026-10-22',
        startTime: '09:00',
        endTime: '12:00',
        timezone: 'America/New_York' as const,
        sourceLabel: 'Fonte X',
        revision: 1,
      },
    ],
  };
}

function preencherFormulario(valores: Partial<Record<string, string>>) {
  const campos: Record<string, string> = {
    'ID da pessoa': 'personId',
    'Nome da pessoa': 'personName',
    'ID do local': 'locationId',
    'Nome do local': 'locationName',
    Data: 'date',
    'Horário de início': 'startTime',
    'Horário de término': 'endTime',
  };
  for (const [rotulo, chave] of Object.entries(campos)) {
    const valor = valores[chave];
    if (valor !== undefined) {
      fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
    }
  }
}

describe('<SchedulePlanner /> — estados', () => {
  it('estado padrão (sem state) é not_integrated', () => {
    render(<SchedulePlanner projetoId={PROJ_A} />);
    expect(screen.getByText('Cronograma ainda não integrado')).toBeTruthy();
  });

  it('ready com lista vazia é distinto de not_integrated', () => {
    render(
      <SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }} />,
    );
    expect(screen.getByText('Nenhuma atribuição registrada neste projeto')).toBeTruthy();
    expect(screen.queryByText('Cronograma ainda não integrado')).toBeNull();
  });

  it('rejeita um dataset em formato de lista bruta (sem {projetoId, assignments}), com alerta genérico', () => {
    render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: [] }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('busca local filtra por pessoa e local', () => {
    const dataset = {
      projetoId: PROJ_A,
      assignments: [
        { assignmentId: 'a1', projetoId: PROJ_A, personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa Norte', date: '2026-10-22', timezone: 'America/New_York' as const, sourceLabel: 'X', revision: 1 },
        { assignmentId: 'a2', projetoId: PROJ_A, personId: 'p2', personName: 'Bruno', locationId: 'l2', locationName: 'Casa Sul', date: '2026-10-22', timezone: 'America/New_York' as const, sourceLabel: 'X', revision: 1 },
      ],
    };
    render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset }} />);
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar pessoa ou local'), { target: { value: 'Ana' } });
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('Bruno')).toBeNull();
  });

  it('alterna entre vista por dia e por pessoa', () => {
    const dataset = datasetFor(PROJ_A);
    render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset }} />);
    expect(screen.getByText('2026-10-22')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Por pessoa' }));
    expect(screen.getByText(`Pessoa exclusiva de ${PROJ_A}`)).toBeTruthy();
  });

  it('ao mudar projetoId sem atualizar o dataset (ainda do projeto anterior), nunca expõe esse dataset', () => {
    const datasetA = datasetFor(PROJ_A);
    const { rerender } = render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetA }} />);
    expect(screen.getByText(`Pessoa exclusiva de ${PROJ_A}`)).toBeTruthy();
    rerender(<SchedulePlanner projetoId={PROJ_B} state={{ kind: 'ready', dataset: datasetA }} />);
    expect(screen.queryByText(`Pessoa exclusiva de ${PROJ_A}`)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('trocar para loading remove os dados anteriores da tela', () => {
    const { rerender } = render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />);
    expect(screen.getByText(`Pessoa exclusiva de ${PROJ_A}`)).toBeTruthy();
    rerender(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'loading' }} />);
    expect(screen.queryByText(`Pessoa exclusiva de ${PROJ_A}`)).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('trocar para error remove os dados anteriores e nunca renderiza state.message arbitrário', () => {
    const { rerender } = render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: datasetFor(PROJ_A) }} />);
    expect(screen.getByText(`Pessoa exclusiva de ${PROJ_A}`)).toBeTruthy();
    const mensagemPerigosa = 'segredo-interno-do-backend-nao-deveria-aparecer-aqui';
    rerender(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'error', message: mensagemPerigosa }} />);
    expect(screen.queryByText(`Pessoa exclusiva de ${PROJ_A}`)).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain(mensagemPerigosa);
    expect(alert.textContent).toBe('Não foi possível consultar o cronograma agora. Tente novamente mais tarde.');
  });
});

describe('<SchedulePlanner /> — entrada manual com revisão', () => {
  it('valida o formulário antes de revisar: rejeita término sem início', () => {
    render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }} />);
    preencherFormulario({ personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa A', date: '2026-10-22', endTime: '09:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar atribuição' }));
    expect(screen.getByText('Informe o início antes de informar o término.')).toBeTruthy();
    expect(screen.queryByText('Confira antes de salvar')).toBeNull();
  });

  it('mostra a revisão com os dados digitados antes de salvar, e permite voltar a editar', () => {
    render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }} />);
    preencherFormulario({
      personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa A',
      date: '2026-10-22', startTime: '09:00', endTime: '12:00',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar atribuição' }));
    expect(screen.getByText('Confira antes de salvar')).toBeTruthy();
    expect(screen.getByText(/Ana/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar e editar' }));
    expect(screen.queryByText('Confira antes de salvar')).toBeNull();
    expect((screen.getByLabelText('Nome da pessoa') as HTMLInputElement).value).toBe('Ana');
  });

  it('sem onSave, o botão de confirmar fica desabilitado com aviso de que o salvamento não está integrado', () => {
    render(<SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }} />);
    preencherFormulario({ personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa A', date: '2026-10-22' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar atribuição' }));
    expect((screen.getByRole('button', { name: 'Confirmar e salvar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('O salvamento ainda não está integrado a esta tela — esta é só a etapa de revisão.')).toBeTruthy();
  });

  it('confirmar chama onSave com o rascunho validado (nunca com assignmentId ou revision) e mostra sucesso', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SchedulePlanner
        projetoId={PROJ_A}
        state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }}
        onSave={onSave}
      />,
    );
    preencherFormulario({
      personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa A',
      date: '2026-10-22', startTime: '09:00', endTime: '12:00',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar atribuição' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e salvar' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const draft = onSave.mock.calls[0][0];
    expect(draft).toEqual({
      personId: 'p1',
      personName: 'Ana',
      locationId: 'l1',
      locationName: 'Casa A',
      date: '2026-10-22',
      startTime: '09:00',
      endTime: '12:00',
      sourceLabel: 'Entrada manual nesta tela',
    });
    expect('assignmentId' in draft).toBe(false);
    expect('revision' in draft).toBe(false);
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Atribuição enviada para salvamento.'));
  });

  it('quando onSave rejeita, mostra uma mensagem genérica (nunca o texto bruto do erro) e preserva o rascunho na revisão', async () => {
    const mensagemExterna = 'segredo-interno-do-backend-nao-deveria-aparecer-aqui';
    const onSave = vi.fn().mockRejectedValue(new Error(mensagemExterna));
    render(
      <SchedulePlanner
        projetoId={PROJ_A}
        state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }}
        onSave={onSave}
      />,
    );
    preencherFormulario({ personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa A', date: '2026-10-22' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar atribuição' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e salvar' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain(mensagemExterna);
    expect(alert.textContent).toBe('Não foi possível salvar esta atribuição agora. Confira e tente novamente.');
    expect(screen.getByText('Confira antes de salvar')).toBeTruthy();
  });

  it('onSave pode rejeitar sem um Error (ex.: string ou objeto) e ainda assim só mostra a mensagem genérica', async () => {
    const onSave = vi.fn().mockRejectedValue('texto-bruto-nao-confiavel-vindo-de-fora');
    render(
      <SchedulePlanner
        projetoId={PROJ_A}
        state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }}
        onSave={onSave}
      />,
    );
    preencherFormulario({ personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa A', date: '2026-10-22' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar atribuição' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e salvar' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain('texto-bruto-nao-confiavel-vindo-de-fora');
    expect(alert.textContent).toBe('Não foi possível salvar esta atribuição agora. Confira e tente novamente.');
  });

  it('trocar de projetoId descarta o rascunho em revisão (nunca salva sob o projeto novo um rascunho revisado no antigo)', () => {
    const { rerender } = render(
      <SchedulePlanner projetoId={PROJ_A} state={{ kind: 'ready', dataset: { projetoId: PROJ_A, assignments: [] } }} />,
    );
    preencherFormulario({ personId: 'p1', personName: 'Ana', locationId: 'l1', locationName: 'Casa A', date: '2026-10-22' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar atribuição' }));
    expect(screen.getByText('Confira antes de salvar')).toBeTruthy();
    rerender(<SchedulePlanner projetoId={PROJ_B} state={{ kind: 'ready', dataset: { projetoId: PROJ_B, assignments: [] } }} />);
    expect(screen.queryByText('Confira antes de salvar')).toBeNull();
    expect((screen.getByLabelText('Nome da pessoa') as HTMLInputElement).value).toBe('');
  });
});
