import { describe, expect, it } from 'vitest';
import { validarDuracao } from '../duracao';

describe('validarDuracao — nunca corrige/arredonda em silêncio, só diz se é utilizável', () => {
  it('valor finito e positivo com unidade conhecida é válido', () => {
    expect(validarDuracao({ valor: 3, unidade: 'dias-corridos' })).toEqual({ valida: true });
    expect(validarDuracao({ valor: 6, unidade: 'horas-pessoa' })).toEqual({ valida: true });
    expect(validarDuracao({ valor: 4, unidade: 'horas' })).toEqual({ valida: true });
    expect(validarDuracao({ valor: 5, unidade: 'dias-uteis' })).toEqual({ valida: true });
  });

  it('valor ausente é inválido', () => {
    expect(validarDuracao(undefined).valida).toBe(false);
  });

  it('valor não finito (NaN, Infinity) é inválido — nunca vira duração', () => {
    expect(validarDuracao({ valor: NaN, unidade: 'dias-corridos' }).valida).toBe(false);
    expect(validarDuracao({ valor: Infinity, unidade: 'dias-corridos' }).valida).toBe(false);
    expect(validarDuracao({ valor: 'três', unidade: 'dias-corridos' }).valida).toBe(false);
  });

  it('valor zero ou negativo é inválido', () => {
    expect(validarDuracao({ valor: 0, unidade: 'dias-corridos' }).valida).toBe(false);
    expect(validarDuracao({ valor: -2, unidade: 'dias-corridos' }).valida).toBe(false);
  });

  it('unidade desconhecida é inválida, nunca aceita "as any"', () => {
    const r = validarDuracao({ valor: 3, unidade: 'semanas' });
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/desconhecida/);
  });

  it('CORREÇÃO: dias-úteis fracionário é inválido — nunca arredondado em silêncio (não existe "meio dia útil" sem contrato de jornada)', () => {
    const r = validarDuracao({ valor: 2.5, unidade: 'dias-uteis' });
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/fracion/);
  });

  it('dias-corridos e horas podem ser fracionários (ex.: 1.5 dias corridos, 2.5 horas) — só dias-úteis é restrito a inteiro', () => {
    expect(validarDuracao({ valor: 1.5, unidade: 'dias-corridos' }).valida).toBe(true);
    expect(validarDuracao({ valor: 2.5, unidade: 'horas' }).valida).toBe(true);
  });
});
