// =============================================================================
// CORREÇÃO (revisão independente nº2 deste subpacote): a codificação anterior
// de roteamento, `${instanceId}::${messageId}` (concatenação com delimitador
// fixo), é AMBÍGUA — dois pares distintos podem produzir a mesma string
// concatenada sempre que um dos dois valores contém o próprio delimitador:
//   ('a::b', 'c')  ->  'a::b::c'
//   ('a', 'b::c')  ->  'a::b::c'   (MESMA string!)
// Isso faria `idFromName` endereçar os dois pares para o MESMO Durable
// Object — um vazamento real de identidade entre instâncias/mensagens
// diferentes, não só um bug cosmético.
//
// Esta função substitui a concatenação por `JSON.stringify([instanceId,
// messageId])`: o formato de array JSON de duas strings preserva cada
// elemento com suas próprias aspas e escapes (`"` e `\` dentro de um valor
// são escapados pelo próprio JSON.stringify), então não existe par
// (instanceId, messageId) != (instanceId', messageId') que produza a mesma
// string codificada — ver `__tests__/dedupDurableObject.test.ts`, bloco
// "identidade de roteamento", para o teste explícito do caso acima.
//
// ÚNICA função que decide essa codificação neste subpacote — usada tanto
// pela entrada de produção (`worker.ts`) quanto pelos testes
// (`__tests__/dedupDurableObject.test.ts`), de propósito: um teste que
// recalculasse a chave à sua própria maneira não provaria nada sobre o
// comportamento real de produção.
export function codificarChaveCompostaDedup(instanceId: string, messageId: string): string {
  return JSON.stringify([instanceId, messageId]);
}
