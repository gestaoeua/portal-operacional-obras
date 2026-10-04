// Validação de duração — correção obrigatória (revisão independente do
// patch original): o normalizador aceitava qualquer `DuracaoPlanejadaValor`
// sem checar se era finito/positivo, aceitava qualquer texto como unidade
// (inclusive um valor desconhecido viraria uma unidade "as any"), e
// `somarDiasUteis` arredondava silenciosamente um valor fracionário de
// dias úteis (ex.: 2.5) sem avisar ninguém.
//
// Esta função é o único lugar que decide se uma duração é utilizável.
// Nunca corrige o valor (nunca arredonda, nunca assume uma jornada de
// trabalho) — um valor inválido vira "não utilizável", com o motivo
// preservado para a tela, nunca uma suposição silenciosa.
import type { UnidadeDuracao } from './types';

export const UNIDADES_DURACAO_VALIDAS: UnidadeDuracao[] = [
  'horas',
  'horas-pessoa',
  'dias-corridos',
  'dias-uteis',
];

export interface ValidacaoDuracao {
  valida: boolean;
  motivo?: string;
}

/**
 * Valida um par (valor, unidade) antes de ele virar barra/anotação na
 * régua. `dias-uteis` fracionário é tratado como inválido — não existe
 * "meio dia útil" sem um contrato explícito de jornada, que este sistema
 * não presume (ver cronograma.ts).
 */
export function validarDuracao(d: { valor: unknown; unidade: unknown } | undefined | null): ValidacaoDuracao {
  if (!d) return { valida: false, motivo: 'Duração ausente.' };
  const valor = Number(d.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return {
      valida: false,
      motivo: `Valor de duração inválido (${String(d.valor)}) — ignorado, nunca usado na régua.`,
    };
  }
  if (!UNIDADES_DURACAO_VALIDAS.includes(d.unidade as UnidadeDuracao)) {
    return {
      valida: false,
      motivo: `Unidade de duração desconhecida (${String(d.unidade)}) — ignorada.`,
    };
  }
  if (d.unidade === 'dias-uteis' && !Number.isInteger(valor)) {
    return {
      valida: false,
      motivo: `Dias úteis fracionários (${valor}) não são suportados sem um contrato de jornada explícito — ignorado, nunca arredondado em silêncio.`,
    };
  }
  return { valida: true };
}
