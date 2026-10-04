import { describe, expect, it } from 'vitest';
import { diferencaEmDiasCorridos, formatarDiaLocal, parseDiaLocal, somarDiasCorridos, somarDiasUteis } from '../diaLocal';
import type { CalendarioTrabalho } from '../diaLocal';

describe('parseDiaLocal — dia de calendário sem conversão para meia-noite UTC', () => {
  it('faz o parse de "YYYY-MM-DD" sem passar por new Date(string)', () => {
    expect(parseDiaLocal('2026-10-02')).toEqual({ ano: 2026, mes: 10, dia: 2 });
  });

  it('nunca "perde um dia" como new Date("YYYY-MM-DD") perderia em fusos negativos', () => {
    // new Date('2026-10-02') é meia-noite UTC; em America/New_York (UTC-4/-5)
    // isso vira 1º de outubro às 20h/19h — o bug que esta função evita.
    const d = parseDiaLocal('2026-10-02')!;
    expect(d.dia).toBe(2); // nunca 1
    expect(formatarDiaLocal(d)).toBe('2026-10-02');
  });

  it('entrada inválida devolve undefined, nunca uma data adivinhada', () => {
    expect(parseDiaLocal('')).toBeUndefined();
    expect(parseDiaLocal(undefined)).toBeUndefined();
    expect(parseDiaLocal('02/10/2026')).toBeUndefined();
  });

  it('CORREÇÃO (revisão independente): "2026-02-31" nunca é aceito — valida calendário real, não só o intervalo 1-31', () => {
    expect(parseDiaLocal('2026-02-31')).toBeUndefined();
    expect(parseDiaLocal('2026-04-31')).toBeUndefined(); // abril só tem 30 dias
    expect(parseDiaLocal('2026-02-28')).toEqual({ ano: 2026, mes: 2, dia: 28 }); // dia real continua ok
  });

  it('CORREÇÃO: 29/02 só é aceito em ano bissexto', () => {
    expect(parseDiaLocal('2024-02-29')).toEqual({ ano: 2024, mes: 2, dia: 29 }); // 2024 é bissexto
    expect(parseDiaLocal('2026-02-29')).toBeUndefined(); // 2026 não é
  });

  it('CORREÇÃO: string ISO com hora (célula Date do Sheets serializada em JSON) nunca "perde o dia" — extrai no fuso declarado da fonte (America/New_York)', () => {
    // 2026-10-06T23:30:00-04:00 em Nova York ainda é dia 6; em UTC já é dia 7
    // (03:30Z) — um corte ingênuo da string UTC erraria o dia.
    const d = parseDiaLocal('2026-10-07T03:30:00.000Z');
    expect(d).toEqual({ ano: 2026, mes: 10, dia: 6 });
  });

  it('CORREÇÃO: objeto Date de verdade (chamada direta, sem passar por JSON) é aceito e extraído no fuso da fonte, nunca quebra com .trim()', () => {
    const data = new Date('2026-10-07T03:30:00.000Z');
    expect(parseDiaLocal(data)).toEqual({ ano: 2026, mes: 10, dia: 6 });
  });

  it('Date inválido (Invalid Date) devolve undefined, nunca lança', () => {
    expect(parseDiaLocal(new Date('não é uma data'))).toBeUndefined();
  });

  it('string ISO com hora mas com mês inválido devolve undefined, nunca lança', () => {
    expect(parseDiaLocal('2026-13-01T00:00:00.000Z')).toBeUndefined();
  });
});

describe('aritmética de calendário — virada de mês/ano, sem efeito de DST', () => {
  it('soma dias corridos através de uma virada de mês', () => {
    expect(somarDiasCorridos({ ano: 2026, mes: 1, dia: 31 }, 1)).toEqual({ ano: 2026, mes: 2, dia: 1 });
  });

  it('soma dias corridos através de uma virada de ano', () => {
    expect(somarDiasCorridos({ ano: 2025, mes: 12, dia: 31 }, 1)).toEqual({ ano: 2026, mes: 1, dia: 1 });
  });

  it('diferença em dias corridos não é afetada pela troca de horário de verão (America/New_York, 2026-03-08)', () => {
    // O "dia real" em torno dessa data tem 23h, não 24h — a diferença de
    // calendário continua sendo exatamente 2 dias, não "1.95".
    const inicio = { ano: 2026, mes: 3, dia: 7 };
    const fim = { ano: 2026, mes: 3, dia: 9 };
    expect(diferencaEmDiasCorridos(inicio, fim)).toBe(2);
  });

  it('CORREÇÃO (revisão independente, item 3): soma dias úteis só segundo um calendário EXPLICITAMENTE declarado pelo chamador — nunca um default interno de segunda-a-sexta', () => {
    // 2026-10-02 é sexta-feira -> +1 dia útil, com um calendário seg-sex
    // explicitamente passado, cai na segunda 2026-10-05.
    const sexta = { ano: 2026, mes: 10, dia: 2 };
    const calendarioSegundaASexta: CalendarioTrabalho = { diasUteisSemana: [1, 2, 3, 4, 5] };
    expect(somarDiasUteis(sexta, 1, calendarioSegundaASexta)).toEqual({ ano: 2026, mes: 10, dia: 5 });
  });

  it('um calendário declarado DIFERENTE (ex.: terça a sábado) muda o resultado — prova que não há jornada fixa embutida nesta função', () => {
    // 2026-10-05 é segunda-feira; com um calendário terça-sábado, +1 dia
    // útil cai na terça 2026-10-06 (segunda não conta como útil aqui).
    const segunda = { ano: 2026, mes: 10, dia: 5 };
    const calendarioTercaASabado: CalendarioTrabalho = { diasUteisSemana: [2, 3, 4, 5, 6] };
    expect(somarDiasUteis(segunda, 1, calendarioTercaASabado)).toEqual({ ano: 2026, mes: 10, dia: 6 });
  });
});
