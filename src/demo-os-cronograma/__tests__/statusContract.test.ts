import { describe, expect, it } from 'vitest';
import { areaPodeSerConsideradaConcluida, classificarStatus, temEtapaAplicavel } from '../statusContract';

describe('classificarStatus — comparação exata, nunca por eliminação/trecho', () => {
  it('reconhece os valores confirmados', () => {
    expect(classificarStatus('Finalizada')).toBe('CONCLUIDA_INFORMADA');
    expect(classificarStatus('A executar')).toBe('NAO_INICIADA');
    expect(classificarStatus('Teste: concluída (informado)')).toBe('CONCLUIDA_INFORMADA');
  });

  it('nunca classifica um texto desconhecido como execução/concluída por eliminação', () => {
    expect(classificarStatus('Aguardando material')).toBe('STATUS_NAO_MAPEADO');
    expect(classificarStatus('')).toBe('STATUS_NAO_MAPEADO');
    expect(classificarStatus(undefined)).toBe('STATUS_NAO_MAPEADO');
  });

  it('não usa substring — "não concluída" nunca vira concluída', () => {
    expect(classificarStatus('não concluída')).toBe('STATUS_NAO_MAPEADO');
    expect(classificarStatus('Não concluída')).toBe('STATUS_NAO_MAPEADO');
  });

  it('CORREÇÃO: contrato explícito de EM_ANDAMENTO agora existe ("Em execução") — nenhuma célula real foi alterada, só o código passou a reconhecer esse texto', () => {
    expect(classificarStatus('Em execução')).toBe('EM_ANDAMENTO');
  });

  it('valores já conhecidos continuam distintos de EM_ANDAMENTO, e texto desconhecido continua NAO_MAPEADO (nunca por eliminação)', () => {
    expect(classificarStatus('Finalizada')).not.toBe('EM_ANDAMENTO');
    expect(classificarStatus('A executar')).not.toBe('EM_ANDAMENTO');
    expect(classificarStatus('Em execucao')).toBe('STATUS_NAO_MAPEADO'); // sem acento: comparação é exata, não aproximada
    expect(classificarStatus('em execução')).toBe('STATUS_NAO_MAPEADO'); // caixa diferente: também não bate
  });
});

describe('temEtapaAplicavel / areaPodeSerConsideradaConcluida — escopo vazio nunca comprova conclusão', () => {
  it('escopo vazio nunca é aplicável, mesmo com contagem de etapas > 0', () => {
    expect(temEtapaAplicavel('', 3)).toBe(false);
  });

  it('zero etapas conhecidas nunca é aplicável, mesmo com escopo definido', () => {
    expect(temEtapaAplicavel('Pintura de trim', 0)).toBe(false);
  });

  it('escopo definido + pelo menos 1 etapa conhecida é aplicável', () => {
    expect(temEtapaAplicavel('Pintura de trim', 1)).toBe(true);
  });

  it('conjunto vazio de etapas nunca comprova conclusão (evita "verdadeiro por vacuidade")', () => {
    const resultado = areaPodeSerConsideradaConcluida({
      temEtapaAplicavel: false,
      todasEtapasConhecidasConcluidas: true, // "todas as zero etapas" seria vacuamente verdadeiro
      existeStatusNaoMapeado: false,
    });
    expect(resultado).toBe(false);
  });

  it('com etapa aplicável e tudo concluído, sem status não mapeado: concluída', () => {
    const resultado = areaPodeSerConsideradaConcluida({
      temEtapaAplicavel: true,
      todasEtapasConhecidasConcluidas: true,
      existeStatusNaoMapeado: false,
    });
    expect(resultado).toBe(true);
  });

  it('status não mapeado bloqueia a conclusão mesmo com etapa aplicável', () => {
    const resultado = areaPodeSerConsideradaConcluida({
      temEtapaAplicavel: true,
      todasEtapasConhecidasConcluidas: true,
      existeStatusNaoMapeado: true,
    });
    expect(resultado).toBe(false);
  });
});
