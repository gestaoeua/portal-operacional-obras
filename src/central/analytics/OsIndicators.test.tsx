// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { calcularIndicadores, formatarInstante, validarConjunto, type OsLedgerEntry } from './model';
import OsIndicators from './OsIndicators';

afterEach(() => cleanup());

const PROJ = 'proj-1';

function ordem(partial: Partial<OsLedgerEntry> & { osId: string }): OsLedgerEntry {
  return {
    projetoId: PROJ,
    status: 'Recebida',
    escopo: 'Pintura de fachada',
    responsavel: '',
    atualizadoEm: '2026-10-01T10:00:00.000Z',
    ...partial,
  };
}

describe('validarConjunto', () => {
  it('aceita um conjunto vazio autenticado como válido', () => {
    const resultado = validarConjunto([], PROJ);
    expect(resultado).toEqual({ ok: true, ordens: [] });
  });

  it('rejeita conjunto com projeto misto, sem revelar o OsId da linha de outro projeto', () => {
    const resultado = validarConjunto(
      [ordem({ osId: 'a' }), ordem({ osId: 'os-sigilosa-outro-projeto', projetoId: 'outro-projeto' })],
      PROJ,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro.motivo).toBe('projeto_misto');
      expect(resultado.erro.detalhe).not.toContain('os-sigilosa-outro-projeto');
    }
  });

  it('rejeita OsId duplicada', () => {
    const resultado = validarConjunto([ordem({ osId: 'dup' }), ordem({ osId: 'dup' })], PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('os_duplicada');
  });

  it('rejeita status fora das seis etapas conhecidas', () => {
    const resultado = validarConjunto([ordem({ osId: 'a', status: 'Cancelada' })], PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('status_invalido');
  });

  it('rejeita entrada com formato inesperado', () => {
    const resultado = validarConjunto([{ osId: 'a' }], PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('formato');
  });
});

describe('calcularIndicadores', () => {
  it('conta concluídas separado de abertas sem responsável, e nunca conta uma concluída como "sem responsável"', () => {
    const ordens = [
      ordem({ osId: 'a', status: 'Concluída', responsavel: 'joao' }),
      ordem({ osId: 'b', status: 'Em execução', responsavel: 'maria' }),
      ordem({ osId: 'c', status: 'Recebida', responsavel: '' }),
      ordem({ osId: 'd', status: 'Programada', responsavel: '  ' }),
      // Concluída sem responsável: não deve contar como "sem responsável entre abertas".
      ordem({ osId: 'e', status: 'Concluída', responsavel: '' }),
    ];
    const indicadores = calcularIndicadores(ordens);
    expect(indicadores.total).toBe(5);
    expect(indicadores.concluidas).toBe(2);
    expect(indicadores.abertas).toBe(3);
    expect(indicadores.semResponsavelAbertas).toBe(2);
    expect(indicadores.porEstagio['Concluída']).toBe(2);
    expect(indicadores.porEstagio['Recebida']).toBe(1);
  });

  it('ignora datas de origem inválidas ao calcular a mais recente, sem derrubar o cálculo', () => {
    const ordens = [
      ordem({ osId: 'a', atualizadoEm: 'não é uma data' }),
      ordem({ osId: 'b', atualizadoEm: '2026-05-01T00:00:00.000Z' }),
      ordem({ osId: 'c', atualizadoEm: '2026-09-01T00:00:00.000Z' }),
    ];
    const indicadores = calcularIndicadores(ordens);
    expect(indicadores.atualizadoEmFonte).toBe('2026-09-01T00:00:00.000Z');
  });

  it('devolve atualizadoEmFonte null quando nenhuma entrada tem data de fonte válida', () => {
    const ordens = [ordem({ osId: 'a', atualizadoEm: 'lixo' }), ordem({ osId: 'b', atualizadoEm: '' })];
    const indicadores = calcularIndicadores(ordens);
    expect(indicadores.atualizadoEmFonte).toBeNull();
  });

  it('conjunto vazio autenticado produz zeros reais, não ausência de dado', () => {
    const indicadores = calcularIndicadores([]);
    expect(indicadores.total).toBe(0);
    expect(indicadores.abertas).toBe(0);
    expect(indicadores.concluidas).toBe(0);
    expect(indicadores.semResponsavelAbertas).toBe(0);
    expect(indicadores.atualizadoEmFonte).toBeNull();
  });
});

describe('formatarInstante', () => {
  it('mostra indisponível para null e para string não interpretável como data', () => {
    expect(formatarInstante(null)).toBe('indisponível');
    expect(formatarInstante('isto não é uma data')).toBe('indisponível');
  });

  it('formata uma data válida', () => {
    expect(formatarInstante('2026-01-15T12:00:00.000Z')).not.toBe('indisponível');
  });
});

describe('<OsIndicators /> — estados', () => {
  it('loading não mostra nenhum número', () => {
    render(<OsIndicators projetoId={PROJ} state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('Indicadores de OS')).toBeNull();
  });

  it('not_integrated mostra mensagem própria, nunca "0" como se fosse dado real', () => {
    render(<OsIndicators projetoId={PROJ} state={{ kind: 'not_integrated' }} />);
    expect(screen.getByText('Indicadores ainda não integrados')).toBeTruthy();
    expect(screen.queryByText('Indicadores de OS')).toBeNull();
  });

  it('error mostra o alerta com a mensagem recebida', () => {
    render(<OsIndicators projetoId={PROJ} state={{ kind: 'error', message: 'Falha ao consultar.' }} />);
    expect(screen.getByRole('alert').textContent).toBe('Falha ao consultar.');
  });

  it('ready com conjunto vazio mostra "0" real nos KPIs, distinto de not_integrated', () => {
    render(<OsIndicators projetoId={PROJ} state={{ kind: 'ready', orders: [], carregadoEm: '2026-10-21T12:00:00.000Z' }} />);
    expect(screen.getByText('Indicadores de OS')).toBeTruthy();
    expect(screen.getByText('Nenhuma OS registrada neste projeto até o momento.')).toBeTruthy();
    expect(screen.queryByText('Indicadores ainda não integrados')).toBeNull();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('ready com projeto misto não quebra: mostra alerta genérico, sem revelar o OsId de outro projeto', () => {
    const orders = [ordem({ osId: 'a' }), ordem({ osId: 'os-sigilosa-outro-projeto', projetoId: 'outro' })];
    render(<OsIndicators projetoId={PROJ} state={{ kind: 'ready', orders, carregadoEm: null }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).not.toContain('os-sigilosa-outro-projeto');
    expect(screen.queryByText('Indicadores de OS')).toBeNull();
  });

  it('troca de ready (com dados) para loading nunca deixa números antigos na tela', () => {
    const orders = [ordem({ osId: 'a', status: 'Em execução', responsavel: 'joao' })];
    const { rerender } = render(
      <OsIndicators projetoId={PROJ} state={{ kind: 'ready', orders, carregadoEm: '2026-10-21T12:00:00.000Z' }} />,
    );
    expect(screen.getByText('1 OS neste projeto')).toBeTruthy();
    rerender(<OsIndicators projetoId={PROJ} state={{ kind: 'loading' }} />);
    expect(screen.queryByText('1 OS neste projeto')).toBeNull();
    expect(screen.queryByText('Indicadores de OS')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('sem data de fonte válida no conjunto exibe indisponível, nunca uma data inventada', () => {
    const orders = [ordem({ osId: 'a', atualizadoEm: 'inválida' })];
    render(<OsIndicators projetoId={PROJ} state={{ kind: 'ready', orders, carregadoEm: null }} />);
    // As duas ocorrências ("Atualizado na fonte" e "Consultado nesta tela")
    // ficam no mesmo parágrafo, então um único nó já casa com o texto
    // inteiro — getAllByText conta nós, não ocorrências. Para confirmar que
    // AMBAS aparecem (fonte e tela), conta as ocorrências dentro do texto
    // desse nó em vez de contar elementos.
    const paragrafo = screen.getByText((content) => content.includes('Atualizado na fonte'));
    const ocorrencias = paragrafo.textContent?.match(/indisponível/g) ?? [];
    expect(ocorrencias.length).toBe(2);
  });
});
