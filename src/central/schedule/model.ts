/**
 * Cronograma de pessoas/obra/dia/horário por projeto — lógica pura, sem
 * fetch e sem componente.
 *
 * Fonte de verdade: o dataset explícito de atribuições devolvido pela
 * ação `scheduleList` e já normalizado por quem integra esta fatia
 * (src/central/scheduleApi.ts, fora desta pasta) — nunca buscado por
 * este módulo, nunca inferido de `Usuarios` nem de `Salas`. O formato
 * esperado é `{ projetoId, assignments: [...], updatedAt? }` — NUNCA uma
 * lista bruta solta. Este módulo representa PLANEJAMENTO — quem deveria
 * estar em qual local, em qual dia e horário — e isso NUNCA equivale a
 * horas realmente trabalhadas; nenhuma função aqui calcula produtividade,
 * custo ou horas efetivas. Falha fechado: um conjunto malformado,
 * misturado entre projetos, com ID duplicado, data inválida, horário
 * inválido/numa transição de horário de verão ambígua, ou
 * intervalo invertido é rejeitado por inteiro — nunca filtrado ou
 * corrigido em silêncio, e nunca revela o ID de uma linha de outro
 * projeto na mensagem de erro.
 */

/** Único fuso válido nesta fatia — valor literal, não uma lista configurável. */
export const SCHEDULE_TIMEZONE = 'America/New_York' as const;

/** Uma atribuição planejada: uma pessoa, num local, numa data, com horário opcional; início pode existir com término ainda desconhecido. */
export interface ScheduleAssignment {
  assignmentId: string;
  projetoId: string;
  personId: string;
  personName: string;
  locationId: string;
  locationName: string;
  /** Data real no formato AAAA-MM-DD (nunca um texto livre). */
  date: string;
  /** HH:mm, 24h. Início pode existir sozinho; término exige início. Ausências nunca são inferidas. */
  startTime?: string;
  endTime?: string;
  timezone: typeof SCHEDULE_TIMEZONE;
  /** De onde esta linha veio (ex.: "Entrada manual nesta tela", "Planilha X"). Nunca inventado por este módulo. */
  sourceLabel: string;
  revision: number;
}

/** Forma exigida do dataset vindo de `scheduleList` — nunca uma lista solta. */
export interface ScheduleDataset {
  projetoId: string;
  assignments: ScheduleAssignment[];
  updatedAt?: string;
}

export type ConjuntoInvalido =
  | { motivo: 'formato'; detalhe: string }
  | { motivo: 'projeto_misto'; detalhe: string }
  | { motivo: 'atribuicao_duplicada'; detalhe: string }
  | { motivo: 'data_invalida'; detalhe: string }
  | { motivo: 'horario_invalido'; detalhe: string }
  | { motivo: 'horario_incompleto'; detalhe: string }
  | { motivo: 'horario_dst_invalido'; detalhe: string }
  | { motivo: 'intervalo_invertido'; detalhe: string }
  | { motivo: 'fuso_invalido'; detalhe: string }
  | { motivo: 'revisao_invalida'; detalhe: string };

export type ValidacaoConjunto =
  | { ok: true; assignments: ScheduleAssignment[]; updatedAt?: string }
  | { ok: false; erro: ConjuntoInvalido };

function isNonEmptyString(value: unknown): value is string {
  // Whitespace-only ("   ") não é um ID/nome válido — mesmo padrão já
  // adotado em src/central/catalogs/model.ts e src/central/properties/model.ts.
  return typeof value === 'string' && value.trim().length > 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Data real no calendário, não só o formato: rejeita "2026-02-30" etc. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** HH:mm, 24h, sem segundos, sem "24:00". */
export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

function minutosDoDia(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function offsetMinutosEm(utcMillis: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const partes = dtf.formatToParts(new Date(utcMillis));
  const obter = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? NaN);
  const comoUtc = Date.UTC(obter('year'), obter('month') - 1, obter('day'), obter('hour'), obter('minute'), obter('second'));
  return Math.round((comoUtc - utcMillis) / 60000);
}

/**
 * Detecta se uma hora local `date`+`time` em America/New_York cai num
 * "buraco" do avanço do horário de verão (não existe — ex.: 02:30 no dia
 * em que o relógio avança de 02:00 para 03:00) ou é "ambígua" no
 * retrocesso (ocorre duas vezes — ex.: 01:30 no dia em que o relógio
 * volta de 02:00 para 01:00). Usa só `Intl`/`Date` nativos, sem
 * biblioteca de datas: compara o instante UTC obtido assumindo o offset
 * do dia anterior contra o offset do dia seguinte e confere, por
 * round-trip, se cada um bate com a hora local pedida.
 */
export function transicaoDstNy(date: string, time: string): 'gap' | 'ambiguous' | 'ok' {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const offsetAntes = offsetMinutosEm(Date.UTC(y, mo - 1, d, 12, 0, 0) - 24 * 60 * 60000);
  const offsetDepois = offsetMinutosEm(Date.UTC(y, mo - 1, d, 12, 0, 0) + 24 * 60 * 60000);
  const alvo = Date.UTC(y, mo - 1, d, h, mi, 0);
  const candidatoAntes = alvo - offsetAntes * 60000;
  const candidatoDepois = alvo - offsetDepois * 60000;
  const bateAlvo = (utcMillis: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: SCHEDULE_TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(utcMillis));
    const g = (t: string) => p.find((x) => x.type === t)?.value;
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}` === `${date}T${time}`;
  };
  const bateAntes = bateAlvo(candidatoAntes);
  const bateDepois = bateAlvo(candidatoDepois);
  if (bateAntes && bateDepois && candidatoAntes !== candidatoDepois) return 'ambiguous';
  if (!bateAntes && !bateDepois) return 'gap';
  return 'ok';
}

function horarioValidoNoFuso(date: string, time: string): boolean {
  return transicaoDstNy(date, time) === 'ok';
}

/**
 * Valida o dataset bruto ANTES de qualquer renderização. Falha fechado:
 * nunca filtra, corrige ou mescla silenciosamente. Rejeições exigidas,
 * todas com mensagem genérica (nunca expõem ID/dado de uma linha de
 * outro projeto):
 *   - formato inesperado, incluindo um `projetoId`/`assignments` ausente
 *     na raiz do dataset (`formato`);
 *   - `projetoId` do dataset OU de uma atribuição diferente do pedido
 *     (`projeto_misto`);
 *   - assignmentId repetido (`atribuicao_duplicada`);
 *   - data que não existe no calendário (`data_invalida`);
 *   - horário presente mas fora do formato HH:mm válido (`horario_invalido`);
 *   - término informado sem início (`horario_incompleto`);
 *   - horário local que cai num buraco ou é ambíguo numa transição de
 *     horário de verão em America/New_York (`horario_dst_invalido`);
 *   - os dois horários presentes com término <= início (`intervalo_invertido`);
 *   - fuso diferente do único valor aceito (`fuso_invalido`);
 *   - revisão que não é inteiro seguro positivo (`revisao_invalida`).
 * Sobreposição entre atribuições da mesma pessoa no mesmo dia NÃO é
 * rejeitada aqui — é sinalizada depois por `calcularAlertas`, para
 * revisão humana, nunca como erro fatal do conjunto inteiro.
 */
export function validarConjunto(value: unknown, projetoId: string): ValidacaoConjunto {
  if (typeof projetoId !== 'string' || !projetoId.trim()) {
    return { ok: false, erro: { motivo: 'formato', detalhe: 'Projeto inválido para o cronograma.' } };
  }
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as Record<string, unknown>).projetoId !== 'string' ||
    !Array.isArray((value as Record<string, unknown>).assignments)
  ) {
    return { ok: false, erro: { motivo: 'formato', detalhe: 'Resposta do cronograma não tem o formato esperado.' } };
  }
  const bruto = value as { projetoId: string; assignments: unknown[]; updatedAt?: unknown };
  if (bruto.projetoId !== projetoId) {
    // Mensagem genérica de propósito: nunca expõe o projetoId recebido.
    return { ok: false, erro: { motivo: 'projeto_misto', detalhe: 'O conjunto recebido é de outro projeto.' } };
  }
  if (bruto.updatedAt !== undefined && typeof bruto.updatedAt !== 'string') {
    return { ok: false, erro: { motivo: 'formato', detalhe: 'Resposta do cronograma não tem o formato esperado.' } };
  }

  const vistos = new Set<string>();
  const assignments: ScheduleAssignment[] = [];
  for (const item of bruto.assignments) {
    if (
      !item ||
      typeof item !== 'object' ||
      !isNonEmptyString((item as Record<string, unknown>).assignmentId) ||
      typeof (item as Record<string, unknown>).projetoId !== 'string' ||
      !isNonEmptyString((item as Record<string, unknown>).personId) ||
      !isNonEmptyString((item as Record<string, unknown>).personName) ||
      !isNonEmptyString((item as Record<string, unknown>).locationId) ||
      !isNonEmptyString((item as Record<string, unknown>).locationName) ||
      typeof (item as Record<string, unknown>).date !== 'string' ||
      !isNonEmptyString((item as Record<string, unknown>).sourceLabel) ||
      typeof (item as Record<string, unknown>).timezone !== 'string' ||
      typeof (item as Record<string, unknown>).revision !== 'number' ||
      ((item as Record<string, unknown>).startTime !== undefined &&
        typeof (item as Record<string, unknown>).startTime !== 'string') ||
      ((item as Record<string, unknown>).endTime !== undefined &&
        typeof (item as Record<string, unknown>).endTime !== 'string')
    ) {
      return { ok: false, erro: { motivo: 'formato', detalhe: 'Uma atribuição do cronograma tem formato inesperado.' } };
    }
    const raw = item as ScheduleAssignment;
    if (raw.projetoId !== projetoId) {
      // Mensagem genérica de propósito: nunca expõe o assignmentId (nem
      // qualquer outro campo) de uma linha de outro projeto.
      return {
        ok: false,
        erro: { motivo: 'projeto_misto', detalhe: 'O conjunto recebido contém uma atribuição de outro projeto.' },
      };
    }
    if (vistos.has(raw.assignmentId)) {
      return {
        ok: false,
        erro: { motivo: 'atribuicao_duplicada', detalhe: 'Uma atribuição aparece mais de uma vez no conjunto.' },
      };
    }
    vistos.add(raw.assignmentId);
    if (!isValidDate(raw.date)) {
      return {
        ok: false,
        erro: { motivo: 'data_invalida', detalhe: 'Uma atribuição tem uma data que não existe no calendário.' },
      };
    }
    const temInicio = raw.startTime !== undefined;
    const temTermino = raw.endTime !== undefined;
    if (temTermino && !temInicio) {
      return {
        ok: false,
        erro: {
          motivo: 'horario_incompleto',
          detalhe: 'Uma atribuição tem término sem início. Informe o início ou deixe ambos desconhecidos.',
        },
      };
    }
    if (temInicio && !isValidTime(raw.startTime!)) {
      return { ok: false, erro: { motivo: 'horario_invalido', detalhe: 'Uma atribuição tem um horário de início inválido.' } };
    }
    if (temTermino && !isValidTime(raw.endTime!)) {
      return { ok: false, erro: { motivo: 'horario_invalido', detalhe: 'Uma atribuição tem um horário de término inválido.' } };
    }
    if (temInicio && temTermino) {
      if (minutosDoDia(raw.endTime!) <= minutosDoDia(raw.startTime!)) {
        return {
          ok: false,
          erro: { motivo: 'intervalo_invertido', detalhe: 'Uma atribuição tem término no mesmo horário ou antes do início.' },
        };
      }
    }
      if ((temInicio && !horarioValidoNoFuso(raw.date, raw.startTime!)) || (temTermino && !horarioValidoNoFuso(raw.date, raw.endTime!))) {
        return {
          ok: false,
          erro: {
            motivo: 'horario_dst_invalido',
            detalhe: 'Uma atribuição cai num horário que não existe ou é ambíguo na transição de horário de verão em America/New_York.',
          },
        };
      }
    if (raw.timezone !== SCHEDULE_TIMEZONE) {
      return { ok: false, erro: { motivo: 'fuso_invalido', detalhe: 'Uma atribuição está em um fuso não aceito nesta fatia.' } };
    }
    // Number.isSafeInteger (não só Number.isInteger): mesmo padrão já usado
    // no backend (requireRevisaoEsperada_ em apps-script/Code.gs) e nas
    // fatias anteriores (catalogs, properties).
    if (!Number.isSafeInteger(raw.revision) || raw.revision <= 0) {
      return { ok: false, erro: { motivo: 'revisao_invalida', detalhe: 'Uma atribuição tem uma revisão que não é um número inteiro positivo.' } };
    }
    // Cópia defensiva: nunca empurra o objeto bruto `raw` para o conjunto
    // validado — só os campos declarados de ScheduleAssignment são
    // copiados. IDs, data, horários, fuso e revisão ficam exatamente como
    // recebidos (nunca renormalizados); só personName/locationName/
    // sourceLabel são aparados, e só para o fallback visual na tela —
    // nunca uma exigência nova.
    assignments.push({
      assignmentId: raw.assignmentId,
      projetoId: raw.projetoId,
      personId: raw.personId,
      personName: raw.personName.trim(),
      locationId: raw.locationId,
      locationName: raw.locationName.trim(),
      date: raw.date,
      ...(temInicio ? { startTime: raw.startTime } : {}),
      ...(temTermino ? { endTime: raw.endTime } : {}),
      timezone: raw.timezone,
      sourceLabel: raw.sourceLabel.trim(),
      revision: raw.revision,
    });
  }
  return { ok: true, assignments, ...(typeof bruto.updatedAt === 'string' ? { updatedAt: bruto.updatedAt } : {}) };
}

/** O que a tela precisa sinalizar por atribuição, sem rejeitar o conjunto. */
export interface AlertaAgenda {
  assignmentId: string;
  /** Falta início ou término; o intervalo está incompleto e não permite confirmar conflitos. */
  horarioAusente: boolean;
  /** assignmentIds de outras atribuições da MESMA pessoa no MESMO dia cujo intervalo se sobrepõe ao desta. */
  sobrepoeCom: string[];
}

/**
 * Sinaliza (nunca rejeita) duas situações que precisam de revisão humana:
 *   - intervalo incompleto: início ou término desconhecido;
 *   - sobreposição de horário entre atribuições da MESMA pessoa no MESMO
 *     dia. Só é possível confirmar sobreposição quando AMBAS as
 *     atribuições comparadas têm ambos os horários — nunca inventa uma
 *     sobreposição a partir de atribuições com intervalo incompleto (essas só recebem
 *     `horarioAusente`, não entram em `sobrepoeCom`).
 */
export function calcularAlertas(assignments: ScheduleAssignment[]): AlertaAgenda[] {
  const porPessoaDia = new Map<string, ScheduleAssignment[]>();
  for (const a of assignments) {
    const chave = `${a.personId}::${a.date}`;
    const lista = porPessoaDia.get(chave);
    if (lista) lista.push(a);
    else porPessoaDia.set(chave, [a]);
  }
  const sobreposicoes = new Map<string, Set<string>>();
  const registrar = (a: string, b: string) => {
    const atual = sobreposicoes.get(a) ?? new Set<string>();
    atual.add(b);
    sobreposicoes.set(a, atual);
  };
  for (const lista of porPessoaDia.values()) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a1 = lista[i];
        const a2 = lista[j];
        if (!a1.startTime || !a1.endTime || !a2.startTime || !a2.endTime) continue;
        const s1 = minutosDoDia(a1.startTime);
        const e1 = minutosDoDia(a1.endTime);
        const s2 = minutosDoDia(a2.startTime);
        const e2 = minutosDoDia(a2.endTime);
        if (s1 < e2 && s2 < e1) {
          registrar(a1.assignmentId, a2.assignmentId);
          registrar(a2.assignmentId, a1.assignmentId);
        }
      }
    }
  }
  return assignments.map((a) => ({
    assignmentId: a.assignmentId,
    horarioAusente: !a.startTime || !a.endTime,
    sobrepoeCom: Array.from(sobreposicoes.get(a.assignmentId) ?? []),
  }));
}

/**
 * Rascunho de uma nova atribuição criada manualmente nesta tela.
 * NUNCA inclui assignmentId ou revision: quem persiste (fora desta
 * fatia) decide o assignmentId e a revisão (0 para uma criação nova,
 * conforme o contrato de `scheduleSave`). `sourceLabel` também não é
 * digitado pelo usuário: o componente sempre o marca como entrada
 * manual.
 */
export interface NovoAssignmentDraft {
  personId: string;
  personName: string;
  locationId: string;
  locationName: string;
  date: string;
  startTime?: string;
  endTime?: string;
  sourceLabel: string;
}

export type RascunhoInvalido =
  | { motivo: 'campo_obrigatorio'; detalhe: string }
  | { motivo: 'data_invalida'; detalhe: string }
  | { motivo: 'horario_invalido'; detalhe: string }
  | { motivo: 'horario_incompleto'; detalhe: string }
  | { motivo: 'horario_dst_invalido'; detalhe: string }
  | { motivo: 'intervalo_invertido'; detalhe: string };

export type ValidacaoRascunho =
  | { ok: true; draft: NovoAssignmentDraft }
  | { ok: false; erro: RascunhoInvalido };

export interface RascunhoBruto {
  personId: string;
  personName: string;
  locationId: string;
  locationName: string;
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Valida o formulário de entrada manual ANTES da etapa de revisão.
 * Mesmas regras de data/horário/intervalo/DST de `validarConjunto`,
 * aplicadas ao que o humano digitou. Nunca aceita pessoa/local/data
 * vazios ou só espaço; início pode existir com término desconhecido.
 * Término sem início é rejeitado; nenhuma ausência é completada em silêncio.
 */
export function validarRascunho(input: RascunhoBruto): ValidacaoRascunho {
  const personId = input.personId.trim();
  const personName = input.personName.trim();
  const locationId = input.locationId.trim();
  const locationName = input.locationName.trim();
  const date = input.date.trim();
  const startTime = input.startTime.trim();
  const endTime = input.endTime.trim();
  if (!personId || !personName || !locationId || !locationName || !date) {
    return {
      ok: false,
      erro: { motivo: 'campo_obrigatorio', detalhe: 'Pessoa, local e data são obrigatórios para revisar a atribuição.' },
    };
  }
  if (!isValidDate(date)) {
    return { ok: false, erro: { motivo: 'data_invalida', detalhe: 'Informe uma data real, no formato AAAA-MM-DD.' } };
  }
  if (endTime && !startTime) {
    return {
      ok: false,
      erro: { motivo: 'horario_incompleto', detalhe: 'Informe o início antes de informar o término.' },
    };
  }
  if (startTime && !isValidTime(startTime)) {
    return { ok: false, erro: { motivo: 'horario_invalido', detalhe: 'O horário de início não é um horário válido (HH:mm).' } };
  }
  if (endTime && !isValidTime(endTime)) {
    return { ok: false, erro: { motivo: 'horario_invalido', detalhe: 'O horário de término não é um horário válido (HH:mm).' } };
  }
  if (startTime && endTime) {
    if (minutosDoDia(endTime) <= minutosDoDia(startTime)) {
      return { ok: false, erro: { motivo: 'intervalo_invertido', detalhe: 'O término precisa ser depois do início.' } };
    }
  }
    if ((startTime && !horarioValidoNoFuso(date, startTime)) || (endTime && !horarioValidoNoFuso(date, endTime))) {
      return {
        ok: false,
        erro: {
          motivo: 'horario_dst_invalido',
          detalhe: 'Esse horário não existe ou é ambíguo na transição de horário de verão em America/New_York — confira a data e o horário.',
        },
      };
    }
  // Objeto literal com spread condicional: quando os dois horários estão
  // vazios, o draft nem tem as chaves `startTime`/`endTime` — nunca uma
  // chave presente com valor `undefined` (isso enganaria um
  // `Object.keys`/JSON.stringify de quem integra, fazendo parecer que o
  // horário foi considerado quando não foi).
  return {
    ok: true,
    draft: {
      personId,
      personName,
      locationId,
      locationName,
      date,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      sourceLabel: 'Entrada manual nesta tela',
    },
  };
}

/** Assinatura esperada do callback assíncrono de salvamento — fora desta fatia (ver src/central/SchedulePage.tsx). */
export type OnSaveAssignment = (draft: NovoAssignmentDraft) => Promise<void>;
