import { describe, expect, it } from 'vitest';
import { normalizarOrdem } from '../normalizar';

describe('normalizarOrdem — teste×produção pela origem, nunca só pelo campo OrigemTeste', () => {
  it('_isTeste=true (setado pelo servidor pela aba) marca teste mesmo com OrigemTeste vazio', () => {
    const o = normalizarOrdem({
      OS: 'TEST-002',
      Status: 'A executar',
      OrigemTeste: '', // vazio de propósito — não pode escapar da separação
      _isTeste: true,
    });
    expect(o.isTeste).toBe(true);
  });

  it('_isTeste=false marca produção mesmo com OrigemTeste preenchido por engano', () => {
    const o = normalizarOrdem({ OS: 'OS-1', Status: 'A executar', OrigemTeste: 'algo', _isTeste: false });
    expect(o.isTeste).toBe(false);
  });

  it('data de serviço informada (TEST-001) é só um dia isolado, nunca um intervalo', () => {
    const o = normalizarOrdem({
      OS: 'TEST-001',
      Status: 'Teste: concluída (informado)',
      DataServicoInformada: '2026-10-02',
      _isTeste: true,
    });
    expect(o.dataServicoInformada).toEqual({ ano: 2026, mes: 10, dia: 2 });
    expect(o.planejamento).toBeUndefined();
    expect(o.realizado).toBeUndefined();
    expect(o.estado).toBe('CONCLUIDA_INFORMADA'); // conclusão informada...
    expect(o.aprovacaoQualidade.semEvidencia).toBe(true); // ...mas aprovação continua pendente/sem evidência
  });

  it('status desconhecido (legado) nunca vira NAO_INICIADA nem EM_ANDAMENTO', () => {
    const o = normalizarOrdem({ OS: 'OS-9', Status: 'Aguardando material' });
    expect(o.estado).toBe('STATUS_NAO_MAPEADO');
  });

  it('escopo vazio e zero etapas conhecidas: temEtapaAplicavel é false', () => {
    const o = normalizarOrdem({ OS: 'OS-10', Status: 'A executar', Escopo: '', QuantidadeEtapasConhecidas: 0 });
    expect(o.temEtapaAplicavel).toBe(false);
  });

  it('campos de cronograma ausentes nunca geram erro — só ficam undefined', () => {
    const o = normalizarOrdem({ OS: 'OS-11', Status: 'A executar' });
    expect(o.planejamento).toBeUndefined();
    expect(o.realizado).toBeUndefined();
  });

  it('duração em horas-pessoa é preservada como tal, nunca convertida para dias na normalização', () => {
    const o = normalizarOrdem({
      OS: 'OS-12',
      Status: 'A executar',
      DuracaoPlanejadaValor: 6,
      DuracaoPlanejadaUnidade: 'horas-pessoa',
    });
    expect(o.planejamento?.duracaoPlanejada).toEqual({ valor: 6, unidade: 'horas-pessoa' });
  });

  it('CORREÇÃO: duração em "horas" (tempo real, separada de esforço) é preservada distintamente de horas-pessoa', () => {
    const o = normalizarOrdem({
      OS: 'OS-13',
      Status: 'A executar',
      DuracaoPlanejadaValor: 4,
      DuracaoPlanejadaUnidade: 'horas',
    });
    expect(o.planejamento?.duracaoPlanejada).toEqual({ valor: 4, unidade: 'horas' });
  });

  it('CORREÇÃO: valor de duração não finito/positivo nunca vira duracaoPlanejada — fica só o motivo, nunca corrigido em silêncio', () => {
    const o = normalizarOrdem({
      OS: 'OS-14',
      Status: 'A executar',
      DuracaoPlanejadaValor: -3,
      DuracaoPlanejadaUnidade: 'dias-corridos',
    });
    expect(o.planejamento?.duracaoPlanejada).toBeUndefined();
    expect(o.planejamento?.duracaoInvalidaMotivo).toMatch(/inválido/);
  });

  it('CORREÇÃO: unidade desconhecida nunca vira "as any" — fica só o motivo', () => {
    const o = normalizarOrdem({
      OS: 'OS-15',
      Status: 'A executar',
      DuracaoPlanejadaValor: 3,
      DuracaoPlanejadaUnidade: 'semanas',
    });
    expect(o.planejamento?.duracaoPlanejada).toBeUndefined();
    expect(o.planejamento?.duracaoInvalidaMotivo).toMatch(/desconhecida/);
  });

  it('CORREÇÃO: dias-úteis fracionário nunca é arredondado em silêncio na normalização — fica só o motivo', () => {
    const o = normalizarOrdem({
      OS: 'OS-16',
      Status: 'A executar',
      DuracaoPlanejadaValor: 2.5,
      DuracaoPlanejadaUnidade: 'dias-uteis',
    });
    expect(o.planejamento?.duracaoPlanejada).toBeUndefined();
    expect(o.planejamento?.duracaoInvalidaMotivo).toMatch(/fracion/);
  });

  it('CORREÇÃO: data planejada vinda como string ISO com hora (célula Date do Sheets) é normalizada corretamente, nunca perdida', () => {
    const o = normalizarOrdem({
      OS: 'OS-17',
      Status: 'A executar',
      DataInicioPlanejada: '2026-10-07T03:30:00.000Z', // 2026-10-06 em America/New_York
    });
    expect(o.planejamento?.dataInicioPlanejada).toEqual({ ano: 2026, mes: 10, dia: 6 });
  });
});

describe('rótulo de aprovação — estado negado (reprovado) e ausência de evidência são distintos', () => {
  it('reprovado (negado) é mostrado como tal, nunca escondido', async () => {
    const { rotuloAprovacao } = await import('../aprovacao');
    expect(rotuloAprovacao({ resultado: 'reprovado', semEvidencia: false })).toBe('Reprovado');
  });

  it('sem evidência nunca é rotulado como "não aplicável"', async () => {
    const { rotuloAprovacao } = await import('../aprovacao');
    const rotulo = rotuloAprovacao({ resultado: 'pendente', semEvidencia: true });
    expect(rotulo.toLowerCase()).not.toContain('não aplicável');
    expect(rotulo.toLowerCase()).toContain('sem evidência');
  });
});
