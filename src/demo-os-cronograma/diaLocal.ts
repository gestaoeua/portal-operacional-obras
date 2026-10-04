// Datas de calendário sem hora (ex.: datas planejadas de início/fim).
//
// Correção obrigatória (ver COMPLEMENTO-CRONOGRAMA-E-CORRECOES.md, item 2):
// uma string "YYYY-MM-DD" NUNCA passa por `new Date("YYYY-MM-DD")` nem por
// qualquer conversão que interprete o valor como meia-noite UTC — isso pode
// mudar o dia exibido em fusos horários negativos (ex. America/New_York).
// Aqui, um "dia local" é só uma estrutura {ano, mes, dia}; toda aritmética
// de calendário usa Date.UTC(...) apenas como truque de cálculo de
// diferença de dias (nunca reinterpretado como um instante real/fuso).
//
// CORREÇÃO (revisão independente do patch original): o parser aceitava
// qualquer dia de 1 a 31 em qualquer mês — "2026-02-31" passava. E só
// aceitava a forma exata "YYYY-MM-DD": uma célula do Sheets formatada como
// Data chega ao servidor como objeto `Date`; ao virar JSON (`JSON.stringify`
// converte `Date` para ISO com hora, ex. "2026-10-06T04:00:00.000Z"), o
// regex antigo não casava e a data era silenciosamente descartada ("perdia
// o dia"). As duas falhas foram corrigidas abaixo: (1) validação real de
// calendário (31/02 nunca é aceito), e (2) suporte a instantes ISO/Date,
// extraindo o dia no FUSO DECLARADO DA FONTE — nunca por corte de texto
// (que pode errar o dia perto da virada da meia-noite) nem pelos getters
// locais do `Date` (que dependem do fuso do processo rodando o código, não
// do fuso real da planilha/negócio).
//
// Instantes reais (timestamps com hora, ex. MomentoResposta) são um tipo
// *diferente* — ver `instante.ts`. Os dois nunca se misturam.
import type { DiaLocal } from './types';
import { FUSO_EXIBICAO } from './instante';

const REGEX_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const REGEX_ISO_COM_HORA = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Fuso declarado da fonte de dados (planilha/negócio) usado para extrair o
 * dia de calendário a partir de um instante (Date/ISO com hora). Mesmo fuso
 * já usado para exibição em `instante.ts` — um único lugar declara isso,
 * nunca presumimos o fuso do processo que está rodando o código.
 */
export const FUSO_FONTE_PADRAO = FUSO_EXIBICAO;

/** Verifica se {ano, mes, dia} é uma data de calendário real (31/02 falha). */
function diaExisteDeVerdade_(ano: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Extrai {ano, mes, dia} de um instante real, no fuso informado — nunca em UTC/local do processo. */
function extrairDiaLocalDeInstante_(instanteMs: number, fuso: string): DiaLocal | undefined {
  if (!Number.isFinite(instanteMs)) return undefined;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instanteMs));
  const mapa: Partial<Record<string, string>> = {};
  partes.forEach((p) => {
    mapa[p.type] = p.value;
  });
  if (!mapa.year || !mapa.month || !mapa.day) return undefined;
  return { ano: Number(mapa.year), mes: Number(mapa.month), dia: Number(mapa.day) };
}

/**
 * Faz o parse de um valor vindo da fonte como dia de calendário puro.
 * Aceita:
 *  - "YYYY-MM-DD" (forma canônica) — validada como data real de calendário.
 *  - uma string ISO com hora (célula Date do Sheets serializada em JSON) ou
 *    um objeto `Date` de verdade (defensivo) — o dia é extraído no fuso
 *    declarado `fuso` (padrão: fuso da fonte, America/New_York), nunca por
 *    corte de texto.
 * Qualquer outra coisa (vazio, formato não reconhecido, data inexistente
 * como 31/02) devolve `undefined` — nunca um valor adivinhado.
 */
export function parseDiaLocal(
  valor: string | Date | undefined | null,
  fuso: string = FUSO_FONTE_PADRAO
): DiaLocal | undefined {
  if (!valor) return undefined;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return undefined;
    return extrairDiaLocalDeInstante_(valor.getTime(), fuso);
  }

  const texto = valor.toString().trim();
  if (!texto) return undefined;

  const direto = REGEX_DIA.exec(texto);
  if (direto) {
    const ano = Number(direto[1]);
    const mes = Number(direto[2]);
    const dia = Number(direto[3]);
    return diaExisteDeVerdade_(ano, mes, dia) ? { ano, mes, dia } : undefined;
  }

  if (REGEX_ISO_COM_HORA.test(texto)) {
    const comoInstante = new Date(texto);
    if (Number.isNaN(comoInstante.getTime())) return undefined;
    return extrairDiaLocalDeInstante_(comoInstante.getTime(), fuso);
  }

  return undefined;
}

export function formatarDiaLocal(d: DiaLocal): string {
  const mm = String(d.mes).padStart(2, '0');
  const dd = String(d.dia).padStart(2, '0');
  return `${d.ano}-${mm}-${dd}`;
}

/** Converte só para fins de aritmética — nunca para exibição/fuso. */
function paraEpocaAritmetica(d: DiaLocal): number {
  return Date.UTC(d.ano, d.mes - 1, d.dia);
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Diferença em dias corridos (calendário), sem qualquer efeito de fuso/DST. */
export function diferencaEmDiasCorridos(inicio: DiaLocal, fim: DiaLocal): number {
  return Math.round((paraEpocaAritmetica(fim) - paraEpocaAritmetica(inicio)) / MS_POR_DIA);
}

export function compararDiaLocal(a: DiaLocal, b: DiaLocal): number {
  return paraEpocaAritmetica(a) - paraEpocaAritmetica(b);
}

export function somarDiasCorridos(d: DiaLocal, dias: number): DiaLocal {
  const epoca = paraEpocaAritmetica(d) + dias * MS_POR_DIA;
  const data = new Date(epoca);
  return { ano: data.getUTCFullYear(), mes: data.getUTCMonth() + 1, dia: data.getUTCDate() };
}

/**
 * Calendário de trabalho EXPLICITAMENTE declarado por quem chama.
 *
 * CORREÇÃO (revisão independente do patch original, item 3): a versão
 * anterior presumia por padrão segunda-a-sexta (só pulava sábado/domingo) e
 * chamava isso de "limitação declarada" — mas uma legenda de limitação não é
 * autorização para presumir a jornada do negócio. Sem um calendário como
 * este, explicitamente fornecido, nenhuma função deste arquivo projeta um
 * fim de "dias úteis" — ver `cronograma.ts#projetarFimPlanejado`, que só usa
 * `somarDiasUteis` quando um calendário foi de fato passado (nunca com um
 * default interno).
 */
export interface CalendarioTrabalho {
  /** Dias da semana (0=domingo .. 6=sábado) considerados úteis por este calendário. */
  diasUteisSemana: number[];
}

function diaEhUtilNoCalendario_(d: DiaLocal, calendario: CalendarioTrabalho): boolean {
  const diaDaSemana = new Date(paraEpocaAritmetica(d)).getUTCDay();
  return calendario.diasUteisSemana.includes(diaDaSemana);
}

/**
 * Soma dias ÚTEIS segundo um `calendario` EXPLICITAMENTE declarado pelo
 * chamador — nunca um default embutido aqui (ver `CalendarioTrabalho`
 * acima). Pré-condição: `diasUteis` já deve ter sido validado como inteiro
 * positivo por `validarDuracao` (ver `duracao.ts`) — fracionário nunca chega
 * aqui vindo do caminho normal; o arredondamento abaixo é só uma rede de
 * segurança defensiva, não uma forma de aceitar entrada inválida calada.
 */
export function somarDiasUteis(d: DiaLocal, diasUteis: number, calendario: CalendarioTrabalho): DiaLocal {
  let atual = d;
  let restante = Math.max(0, Math.round(diasUteis));
  while (restante > 0) {
    atual = somarDiasCorridos(atual, 1);
    if (diaEhUtilNoCalendario_(atual, calendario)) restante -= 1;
  }
  return atual;
}
