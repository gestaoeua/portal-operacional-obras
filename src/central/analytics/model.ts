/**
 * Indicadores de OS por projeto — lógica pura, sem fetch e sem componente.
 *
 * Fonte de verdade: o ledger já autenticado e resolvido pelo servidor
 * (ação `listOsOperacional`, isolada por projeto — ver apps-script/Code.gs).
 * Este módulo NUNCA busca dados por conta própria, nunca infere prazos,
 * custos ou produtividade, e nunca confia silenciosamente num conjunto
 * malformado: tudo que entra é validado antes de qualquer contagem.
 */

/** As seis etapas do fluxo de OS, na ordem exigida. Nenhuma outra string é um status válido. */
export const OS_STAGES = [
  'Recebida',
  'Em conferência',
  'Programada',
  'Em execução',
  'Aguardando validação',
  'Concluída',
] as const;

export type OsStage = (typeof OS_STAGES)[number];

/**
 * Forma mínima exigida de cada entrada do ledger (o que `listOsOperacional`
 * devolve por OS). `revisao` e `historico` existem na fonte real mas não
 * são usados por nenhum cálculo aqui — nunca inventamos dependência neles.
 */
export interface OsLedgerEntry {
  osId: string;
  projetoId: string;
  status: string;
  escopo: string;
  responsavel: string;
  atualizadoEm: string;
  revisao?: unknown;
  historico?: unknown;
}

export interface OsIndicadores {
  total: number;
  abertas: number;
  concluidas: number;
  /** Entre as ABERTAS apenas — uma OS concluída sem responsável nunca entra aqui. */
  semResponsavelAbertas: number;
  porEstagio: Record<OsStage, number>;
  /**
   * Instante (string original da fonte) da OS mais recentemente atualizada
   * NA FONTE — nunca a hora em que esta tela consultou a fonte. `null`
   * quando o conjunto está vazio ou nenhuma entrada tem `atualizadoEm`
   * interpretável como data.
   */
  atualizadoEmFonte: string | null;
}

export type ConjuntoInvalido =
  | { motivo: 'formato'; detalhe: string }
  | { motivo: 'projeto_misto'; detalhe: string }
  | { motivo: 'os_duplicada'; detalhe: string }
  | { motivo: 'status_invalido'; detalhe: string };

export type ValidacaoConjunto =
  | { ok: true; ordens: OsLedgerEntry[] }
  | { ok: false; erro: ConjuntoInvalido };

function isStage(value: unknown): value is OsStage {
  return typeof value === 'string' && (OS_STAGES as readonly string[]).includes(value);
}

/**
 * Valida o conjunto bruto ANTES de qualquer contagem. Falha fechado: nunca
 * filtra, corrige ou mescla silenciosamente — só diz por que o conjunto
 * inteiro não pode ser usado. As três rejeições exigidas:
 *   - qualquer entrada de outro projeto (projeto_misto);
 *   - qualquer OsId repetida (os_duplicada);
 *   - qualquer status fora das seis etapas conhecidas (status_invalido).
 */
export function validarConjunto(value: unknown, projetoId: string): ValidacaoConjunto {
  if (typeof projetoId !== 'string' || !projetoId.trim()) {
    return { ok: false, erro: { motivo: 'formato', detalhe: 'Projeto inválido para indicadores.' } };
  }
  if (!Array.isArray(value)) {
    return { ok: false, erro: { motivo: 'formato', detalhe: 'Resposta de indicadores não é uma lista.' } };
  }
  const vistos = new Set<string>();
  const ordens: OsLedgerEntry[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Record<string, unknown>).osId !== 'string' ||
      !(item as Record<string, unknown>).osId ||
      typeof (item as Record<string, unknown>).projetoId !== 'string' ||
      typeof (item as Record<string, unknown>).escopo !== 'string' ||
      typeof (item as Record<string, unknown>).responsavel !== 'string' ||
      typeof (item as Record<string, unknown>).atualizadoEm !== 'string'
    ) {
      return { ok: false, erro: { motivo: 'formato', detalhe: 'Uma entrada de OS tem formato inesperado.' } };
    }
    const entry = item as OsLedgerEntry;
    if (entry.projetoId !== projetoId) {
      // Mensagem genérica de propósito: nunca expõe o OsId (nem qualquer
      // outro campo) de uma linha que pertence a um projeto ao qual esta
      // tela não tem acesso — mesmo princípio de "negar antes de revelar
      // linhas" já adotado no backend (docs/os-acceptance.md).
      return {
        ok: false,
        erro: { motivo: 'projeto_misto', detalhe: 'O conjunto recebido contém uma OS de outro projeto.' },
      };
    }
    if (vistos.has(entry.osId)) {
      return {
        ok: false,
        erro: { motivo: 'os_duplicada', detalhe: `A OS ${entry.osId} aparece mais de uma vez no conjunto.` },
      };
    }
    vistos.add(entry.osId);
    if (!isStage(entry.status)) {
      return {
        ok: false,
        erro: { motivo: 'status_invalido', detalhe: `A OS ${entry.osId} tem um status fora das seis etapas conhecidas.` },
      };
    }
    ordens.push(entry);
  }
  return { ok: true, ordens };
}

function instanteValido(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calcula os indicadores. Assume que `ordens` já passou por
 * `validarConjunto` — não revalida nem filtra por conta própria. Um
 * conjunto vazio (projeto autenticado sem nenhuma OS ainda) é uma entrada
 * legítima: devolve zeros reais, nunca um erro.
 */
export function calcularIndicadores(ordens: OsLedgerEntry[]): OsIndicadores {
  const porEstagio = OS_STAGES.reduce((acc, stage) => {
    acc[stage] = 0;
    return acc;
  }, {} as Record<OsStage, number>);
  let concluidas = 0;
  let semResponsavelAbertas = 0;
  let maisRecenteTs: number | null = null;
  let maisRecenteOriginal: string | null = null;
  for (const ordem of ordens) {
    const stage = ordem.status as OsStage;
    porEstagio[stage] += 1;
    const aberta = stage !== 'Concluída';
    if (!aberta) {
      concluidas += 1;
    } else if (!ordem.responsavel.trim()) {
      semResponsavelAbertas += 1;
    }
    const ts = instanteValido(ordem.atualizadoEm);
    if (ts !== null && (maisRecenteTs === null || ts > maisRecenteTs)) {
      maisRecenteTs = ts;
      maisRecenteOriginal = ordem.atualizadoEm;
    }
  }
  return {
    total: ordens.length,
    abertas: ordens.length - concluidas,
    concluidas,
    semResponsavelAbertas,
    porEstagio,
    atualizadoEmFonte: maisRecenteOriginal,
  };
}

/** Formata um instante para exibição em pt-BR. `null` ou string não interpretável como data => "indisponível" — nunca uma data inventada. */
export function formatarInstante(value: string | null): string {
  if (!value) return 'indisponível';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'indisponível';
  return new Date(parsed).toLocaleString('pt-BR');
}
