// Instantes reais (com hora e fuso) — diferente de `DiaLocal` (dia de
// calendário puro, ver `diaLocal.ts`). Usado só para timestamps de verdade:
// MomentoResposta, UltimaAtualizacao. Gravação sempre em UTC (ISO 8601 com
// 'Z'); exibição sempre convertida para o fuso do projeto, hoje
// America/New_York — mesmo padrão já usado em apps-script/Code.gs via
// Session.getScriptTimeZone().
export const FUSO_EXIBICAO = 'America/New_York';

export function agoraUtcIso(): string {
  return new Date().toISOString();
}

export function formatarInstanteLocal(isoUtc: string): string {
  const data = new Date(isoUtc);
  if (Number.isNaN(data.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_EXIBICAO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}
