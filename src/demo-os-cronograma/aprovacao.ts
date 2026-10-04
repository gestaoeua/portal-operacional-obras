// Rótulo de aprovação de qualidade — sempre separado da conclusão informada
// (ver v2, seção 1.3, e correção 2 do complemento). Ausência de evidência
// NUNCA é "não aplicável" — é um estado próprio, igual a uma reprovação
// explícita (um status negado) é sempre mostrada como tal, nunca escondida
// atrás de um rótulo genérico de conclusão.
import type { AprovacaoQualidade } from './types';

export function rotuloAprovacao(a: AprovacaoQualidade): string {
  if (a.semEvidencia) return 'Sem evidência — aprovação pendente';
  if (a.resultado === 'reprovado') return 'Reprovado';
  if (a.resultado === 'aprovado') return 'Aprovado';
  return 'Pendente';
}
