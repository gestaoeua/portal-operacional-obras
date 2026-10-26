import { describe, expect, it } from 'vitest';
import {
  calcularAlertas,
  isValidDate,
  isValidTime,
  transicaoDstNy,
  validarConjunto,
  validarRascunho,
  type ScheduleAssignment,
} from './model';

const PROJ = 'proj-1';

function atribuicao(partial: Partial<ScheduleAssignment> & { assignmentId: string }): ScheduleAssignment {
  return {
    projetoId: PROJ,
    personId: 'p1',
    personName: 'Ana',
    locationId: 'l1',
    locationName: 'Casa A',
    date: '2026-10-22',
    timezone: 'America/New_York',
    sourceLabel: 'Fonte X',
    revision: 1,
    ...partial,
  };
}

function dataset(assignments: unknown[], extra: Record<string, unknown> = {}) {
  return { projetoId: PROJ, assignments, ...extra };
}

describe('isValidDate / isValidTime', () => {
  it('aceita datas reais e rejeita datas que não existem no calendário', () => {
    expect(isValidDate('2026-10-22')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('não é uma data')).toBe(false);
  });

  it('aceita HH:mm válido e rejeita formato fora do esperado', () => {
    expect(isValidTime('09:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:00')).toBe(false);
    expect(isValidTime('09:60')).toBe(false);
  });
});

describe('transicaoDstNy', () => {
  it('detecta o buraco do avanço de horário de verão (2026-03-08, 02:00–02:59 não existe)', () => {
    expect(transicaoDstNy('2026-03-08', '02:30')).toBe('gap');
    expect(transicaoDstNy('2026-03-08', '01:30')).toBe('ok');
    expect(transicaoDstNy('2026-03-08', '03:30')).toBe('ok');
  });

  it('detecta a ambiguidade do retrocesso de horário de verão (2026-11-01, 01:00–01:59 ocorre duas vezes)', () => {
    expect(transicaoDstNy('2026-11-01', '01:30')).toBe('ambiguous');
    expect(transicaoDstNy('2026-11-01', '00:30')).toBe('ok');
    expect(transicaoDstNy('2026-11-01', '03:30')).toBe('ok');
  });

  it('um dia comum, sem transição, é sempre "ok"', () => {
    expect(transicaoDstNy('2026-10-22', '14:00')).toBe('ok');
  });
});

describe('validarConjunto', () => {
  it('exige o formato {projetoId, assignments}, nunca uma lista bruta solta', () => {
    const resultado = validarConjunto([atribuicao({ assignmentId: 'a1' })], PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('formato');
  });

  it('aceita dataset vazio autenticado como válido', () => {
    expect(validarConjunto(dataset([]), PROJ)).toEqual({ ok: true, assignments: [] });
  });

  it('repassa updatedAt quando presente e no formato certo, rejeita quando não é string', () => {
    const r1 = validarConjunto(dataset([], { updatedAt: '2026-10-22T10:00:00Z' }), PROJ);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.updatedAt).toBe('2026-10-22T10:00:00Z');
    const r2 = validarConjunto(dataset([], { updatedAt: 123 }), PROJ);
    expect(r2.ok).toBe(false);
  });

  it('rejeita projetoId do dataset diferente do pedido, sem revelar qual foi recebido', () => {
    const resultado = validarConjunto({ projetoId: 'outro-projeto-sigiloso', assignments: [] }, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro.motivo).toBe('projeto_misto');
      expect(resultado.erro.detalhe).not.toContain('outro-projeto-sigiloso');
    }
  });

  it('rejeita uma atribuição de outro projeto dentro da lista, sem revelar o assignmentId', () => {
    const resultado = validarConjunto(
      dataset([atribuicao({ assignmentId: 'a1' }), atribuicao({ assignmentId: 'sigiloso', projetoId: 'outro' })]),
      PROJ,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro.motivo).toBe('projeto_misto');
      expect(resultado.erro.detalhe).not.toContain('sigiloso');
    }
  });

  it('rejeita assignmentId duplicado', () => {
    const resultado = validarConjunto(dataset([atribuicao({ assignmentId: 'dup' }), atribuicao({ assignmentId: 'dup' })]), PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('atribuicao_duplicada');
  });

  it('rejeita data que não existe no calendário', () => {
    const resultado = validarConjunto(dataset([atribuicao({ assignmentId: 'a1', date: '2026-02-30' })]), PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('data_invalida');
  });

  it('aceita início sem término e rejeita término sem início', () => {
    const soInicio = validarConjunto(dataset([atribuicao({ assignmentId: 'a1', startTime: '09:00' })]), PROJ);
    expect(soInicio.ok).toBe(true);

    const soTermino = validarConjunto(dataset([atribuicao({ assignmentId: 'a1', endTime: '17:00' })]), PROJ);
    expect(soTermino.ok).toBe(false);
    if (!soTermino.ok) expect(soTermino.erro.motivo).toBe('horario_incompleto');

    const osDois = validarConjunto(dataset([atribuicao({ assignmentId: 'a1', startTime: '09:00', endTime: '17:00' })]), PROJ);
    expect(osDois.ok).toBe(true);

    const nenhum = validarConjunto(dataset([atribuicao({ assignmentId: 'a1' })]), PROJ);
    expect(nenhum.ok).toBe(true);
  });

  it('rejeita horário fora do formato HH:mm', () => {
    const resultado = validarConjunto(
      dataset([atribuicao({ assignmentId: 'a1', startTime: '25:00', endTime: '26:00' })]),
      PROJ,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('horario_invalido');
  });

  it('rejeita término no mesmo horário ou antes do início', () => {
    const resultado = validarConjunto(
      dataset([atribuicao({ assignmentId: 'a1', startTime: '17:00', endTime: '09:00' })]),
      PROJ,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('intervalo_invertido');
  });

  it('rejeita horário que cai num buraco ou é ambíguo numa transição de horário de verão em NY', () => {
    const gap = validarConjunto(
      dataset([atribuicao({ assignmentId: 'a1', date: '2026-03-08', startTime: '02:15', endTime: '02:45' })]),
      PROJ,
    );
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.erro.motivo).toBe('horario_dst_invalido');

    const ambiguo = validarConjunto(
      dataset([atribuicao({ assignmentId: 'a1', date: '2026-11-01', startTime: '01:15', endTime: '01:45' })]),
      PROJ,
    );
    expect(ambiguo.ok).toBe(false);
    if (!ambiguo.ok) expect(ambiguo.erro.motivo).toBe('horario_dst_invalido');
  });

  it('rejeita fuso diferente do único valor aceito', () => {
    const resultado = validarConjunto(
      dataset([{ ...atribuicao({ assignmentId: 'a1' }), timezone: 'America/Chicago' }]),
      PROJ,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('fuso_invalido');
  });

  it('rejeita revisão que não é inteiro seguro positivo', () => {
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      const resultado = validarConjunto(dataset([atribuicao({ assignmentId: 'a1', revision })]), PROJ);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.erro.motivo).toBe('revisao_invalida');
    }
  });

  it('rejeita formato inesperado de uma atribuição', () => {
    const resultado = validarConjunto(dataset([{ assignmentId: 'a1' }]), PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('formato');
  });

  it('nunca repassa a referência original: mutar o resultado não altera a entrada recebida', () => {
    const entrada = dataset([atribuicao({ assignmentId: 'a1', personName: '  Ana  ' })]);
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    resultado.assignments[0].personName = 'MUTADO';
    expect((entrada.assignments[0] as ScheduleAssignment).personName).toBe('  Ana  ');
  });

  it('copia só os campos declarados: um campo extra nunca atravessa a validação', () => {
    const entrada = dataset([{ ...atribuicao({ assignmentId: 'a1' }), campoSecreto: 'nao-deveria-vazar' }]);
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(Object.keys(resultado.assignments[0]).sort()).toEqual([
      'assignmentId',
      'date',
      'locationId',
      'locationName',
      'personId',
      'personName',
      'projetoId',
      'revision',
      'sourceLabel',
      'timezone',
    ]);
  });

  it('IDs nunca são renormalizados; name/sourceLabel só são aparados para o fallback visual', () => {
    const entrada = dataset([
      atribuicao({ assignmentId: 'a1', personName: '  Ana  ', locationName: '  Casa A  ', sourceLabel: '  Fonte X  ' }),
    ]);
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.assignments[0].assignmentId).toBe('a1');
    expect(resultado.assignments[0].personName).toBe('Ana');
    expect(resultado.assignments[0].locationName).toBe('Casa A');
    expect(resultado.assignments[0].sourceLabel).toBe('Fonte X');
  });

  it('rejeita projeto vazio/inválido como parâmetro', () => {
    expect(validarConjunto(dataset([]), '').ok).toBe(false);
  });
});

describe('calcularAlertas', () => {
  it('marks start-only as incomplete without inventing an end or a definite overlap', () => {
    const input = dataset([
      atribuicao({ assignmentId: 'start-only', startTime: '08:00' }),
      atribuicao({ assignmentId: 'complete', startTime: '09:00', endTime: '12:00' }),
    ]);
    const result = validarConjunto(input, PROJ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments[0].startTime).toBe('08:00');
    expect(Object.prototype.hasOwnProperty.call(result.assignments[0], 'endTime')).toBe(false);
    const alerts = calcularAlertas(result.assignments);
    expect(alerts[0]).toEqual({assignmentId:'start-only',horarioAusente:true,sobrepoeCom:[]});
    expect(alerts[1].sobrepoeCom).toEqual([]);
  });
  it('sinaliza horário ausente sem nunca inventar sobreposição entre atribuições sem horário', () => {
    const assignments = [atribuicao({ assignmentId: 'x1' }), atribuicao({ assignmentId: 'x2' })];
    const alertas = calcularAlertas(assignments);
    expect(alertas.every((a) => a.horarioAusente)).toBe(true);
    expect(alertas.every((a) => a.sobrepoeCom.length === 0)).toBe(true);
  });

  it('detecta sobreposição real entre atribuições da mesma pessoa no mesmo dia', () => {
    const assignments = [
      atribuicao({ assignmentId: 'x1', startTime: '09:00', endTime: '12:00' }),
      atribuicao({ assignmentId: 'x2', startTime: '11:00', endTime: '14:00' }),
    ];
    const alertas = calcularAlertas(assignments);
    expect(alertas.find((a) => a.assignmentId === 'x1')?.sobrepoeCom).toEqual(['x2']);
    expect(alertas.find((a) => a.assignmentId === 'x2')?.sobrepoeCom).toEqual(['x1']);
  });

  it('não sinaliza sobreposição entre pessoas diferentes nem entre dias diferentes', () => {
    const assignments = [
      atribuicao({ assignmentId: 'x1', personId: 'p1', date: '2026-10-22', startTime: '09:00', endTime: '12:00' }),
      atribuicao({ assignmentId: 'x2', personId: 'p2', date: '2026-10-22', startTime: '09:00', endTime: '12:00' }),
      atribuicao({ assignmentId: 'x3', personId: 'p1', date: '2026-10-23', startTime: '09:00', endTime: '12:00' }),
    ];
    const alertas = calcularAlertas(assignments);
    expect(alertas.every((a) => a.sobrepoeCom.length === 0)).toBe(true);
  });
});

describe('validarRascunho', () => {
  const base = {
    personId: 'p1',
    personName: 'Ana',
    locationId: 'l1',
    locationName: 'Casa A',
    date: '2026-10-22',
    startTime: '',
    endTime: '',
  };

  it('preserves a known start with unknown end and validates DST for that start alone', () => {
    const knownStart = validarRascunho({...base,startTime:'08:00'});
    expect(knownStart.ok).toBe(true);
    if (knownStart.ok) {
      expect(knownStart.draft.startTime).toBe('08:00');
      expect(Object.prototype.hasOwnProperty.call(knownStart.draft,'endTime')).toBe(false);
    }
    for (const [date,startTime] of [['2026-03-08','02:30'],['2026-11-01','01:30']]) {
      const draft = validarRascunho({...base,date,startTime});
      expect(draft.ok).toBe(false);
      if (!draft.ok) expect(draft.erro.motivo).toBe('horario_dst_invalido');
      const loaded = validarConjunto(dataset([atribuicao({assignmentId:'dst',date,startTime})]),PROJ);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.erro.motivo).toBe('horario_dst_invalido');
    }
    const endOnly = validarRascunho({...base,endTime:'17:00'});
    expect(endOnly).toMatchObject({ok:false,erro:{detalhe:'Informe o início antes de informar o término.'}});
  });

  it('exige pessoa, local e data; rejeita campos vazios/só espaço', () => {
    const resultado = validarRascunho({ ...base, personName: '   ' });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('campo_obrigatorio');
  });

  it('rejeita data que não existe no calendário', () => {
    const resultado = validarRascunho({ ...base, date: '2026-02-30' });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('data_invalida');
  });

  it('aceita início sem término e rejeita término sem início', () => {
    const soInicio = validarRascunho({ ...base, startTime: '09:00' });
    expect(soInicio.ok).toBe(true);
    const soTermino = validarRascunho({ ...base, endTime: '17:00' });
    expect(soTermino.ok).toBe(false);
    if (!soTermino.ok) expect(soTermino.erro.motivo).toBe('horario_incompleto');
  });

  it('rejeita término no mesmo horário ou antes do início', () => {
    const resultado = validarRascunho({ ...base, startTime: '17:00', endTime: '09:00' });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('intervalo_invertido');
  });

  it('rejeita horário num buraco/ambiguidade de horário de verão em NY', () => {
    const resultado = validarRascunho({ ...base, date: '2026-03-08', startTime: '02:15', endTime: '02:45' });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('horario_dst_invalido');
  });

  it('aceita os dois horários ausentes ou os dois presentes; o draft nunca inclui assignmentId nem revision', () => {
    const semHorario = validarRascunho(base);
    expect(semHorario.ok).toBe(true);
    if (semHorario.ok) {
      expect(semHorario.draft.startTime).toBeUndefined();
      expect('startTime' in semHorario.draft).toBe(false);
      expect(semHorario.draft.sourceLabel).toBe('Entrada manual nesta tela');
      expect(Object.keys(semHorario.draft).sort()).toEqual([
        'date',
        'locationId',
        'locationName',
        'personId',
        'personName',
        'sourceLabel',
      ]);
    }

    const comHorario = validarRascunho({ ...base, startTime: '09:00', endTime: '17:00' });
    expect(comHorario.ok).toBe(true);
    if (comHorario.ok) {
      expect(comHorario.draft.startTime).toBe('09:00');
      expect(comHorario.draft.endTime).toBe('17:00');
    }
  });

  it('nunca inventa pessoa/local: os IDs e nomes vêm exatamente do que foi digitado (só aparados)', () => {
    const resultado = validarRascunho({ ...base, personName: '  Ana  ', locationName: '  Casa A  ' });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.draft.personId).toBe('p1');
      expect(resultado.draft.personName).toBe('Ana');
      expect(resultado.draft.locationName).toBe('Casa A');
    }
  });
});
