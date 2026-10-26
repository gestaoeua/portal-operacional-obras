import { describe, expect, it } from 'vitest';
import { verificarAssinaturaDespacho } from '../verificarAssinaturaDespacho';
import { assinarParaTeste, SEGREDO_HMAC_DE_TESTE_NUNCA_REAL } from '../fixturesVoceroFicticias';

const CORPO_FICTICIO = '{"dispatchId":"dsp-ficticio-teste-assinatura"}';

describe('verificarAssinaturaDespacho — fail-closed, nunca lança (dados fictícios)', () => {
  it('aceita uma assinatura válida calculada com o mesmo segredo', () => {
    const assinatura = assinarParaTeste(CORPO_FICTICIO);
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, assinatura, SEGREDO_HMAC_DE_TESTE_NUNCA_REAL);
    expect(resultado.valida).toBe(true);
  });

  it('rejeita quando o segredo usado para assinar é diferente do segredo de verificação', () => {
    const assinatura = assinarParaTeste(CORPO_FICTICIO, 'outro-segredo-ficticio-diferente');
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, assinatura, SEGREDO_HMAC_DE_TESTE_NUNCA_REAL);
    expect(resultado.valida).toBe(false);
  });

  it('rejeita quando o corpo foi adulterado depois de assinado (prova que a assinatura é sobre o corpo cru exato)', () => {
    const assinatura = assinarParaTeste(CORPO_FICTICIO);
    const corpoAdulterado = CORPO_FICTICIO.replace('teste-assinatura', 'teste-assinatura-adulterado');
    const resultado = verificarAssinaturaDespacho(corpoAdulterado, assinatura, SEGREDO_HMAC_DE_TESTE_NUNCA_REAL);
    expect(resultado.valida).toBe(false);
  });

  it('rejeita quando o cabeçalho de assinatura está ausente — nunca lança', () => {
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, undefined, SEGREDO_HMAC_DE_TESTE_NUNCA_REAL);
    expect(resultado.valida).toBe(false);
    if (resultado.valida) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('ausente');
  });

  it('rejeita quando o cabeçalho não começa com o prefixo sha256= — nunca lança', () => {
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, 'md5=abcdef', SEGREDO_HMAC_DE_TESTE_NUNCA_REAL);
    expect(resultado.valida).toBe(false);
  });

  it('rejeita quando a parte hexadecimal contém caracteres inválidos — nunca lança', () => {
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, 'sha256=nao-e-hex-valido!!', SEGREDO_HMAC_DE_TESTE_NUNCA_REAL);
    expect(resultado.valida).toBe(false);
  });

  it('rejeita quando a assinatura tem tamanho diferente do esperado — nunca lança (timingSafeEqual lançaria se chamado direto)', () => {
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, 'sha256=ab12', SEGREDO_HMAC_DE_TESTE_NUNCA_REAL);
    expect(resultado.valida).toBe(false);
    if (resultado.valida) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('tamanho');
  });

  it('rejeita fail-closed quando nenhum segredo HMAC é fornecido — nunca "autorizado por omissão"', () => {
    const assinatura = assinarParaTeste(CORPO_FICTICIO);
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, assinatura, undefined);
    expect(resultado.valida).toBe(false);
    if (resultado.valida) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('fail-closed');
  });

  it('rejeita quando o segredo é uma string vazia — fail-closed, nunca tratado como "sem verificação"', () => {
    const assinatura = assinarParaTeste(CORPO_FICTICIO);
    const resultado = verificarAssinaturaDespacho(CORPO_FICTICIO, assinatura, '');
    expect(resultado.valida).toBe(false);
  });
});
