// Equivalente, para o runtime de Workers/Durable Objects, de
// `../webhookRecebido/aplicadorDeRascunhosWebhook.ts` — MESMA disciplina de
// gate (nunca decide elegibilidade sozinho, só reage à `DecisaoIngestaoAutomatica`
// já calculada por `decidirIngestaoAutomatica.ts`, reaproveitado sem alteração).
// Única diferença estrutural: aqui a deduplicação é feita por um stub de
// Durable Object já roteado pela chave composta (ver `chaveCompostaDedup.ts`
// e `worker.ts`), em vez de um arquivo JSON local — por isso os métodos são
// assíncronos e o stub não recebe `messageId` como parâmetro (a própria
// instância do Durable Object JÁ é essa chave).
//
// PROTEÇÃO ANTIABUSO (preparação desta rodada): o `obterStub` — e, com ele,
// qualquer alocação de Durable Object — só é CHAMADO quando
// `decisao.elegivel === true`. HOJE isto nunca acontece (gate G1 fechado,
// `decidirIngestaoAutomatica.ts` sem nenhum caminho de código que devolva
// `elegivel:true`), então nenhuma requisição real jamais aloca ou grava em
// nenhum Durable Object — nem para registrar uma observação de auditoria.
// Isto é deliberado: alguém conseguiria, de outra forma, gastar recursos de
// armazenamento só enviando qualquer coisa que `processarWebhookRecebido`
// aceite como "evento de texto privado", mesmo sabendo que isso NUNCA
// seria elegível. A capacidade de registrar observação continua existindo
// na classe `DedupDurableObject` (`registrarObservacaoNaoElegivel`,
// `foiObservadoComoNaoElegivel`) — é um primitivo isolado e testado por
// conta própria em `__tests__/dedupDurableObject.test.ts` — mas este
// arquivo, de propósito, NÃO a chama mais no caminho real.
import type { DecisaoIngestaoAutomatica, RascunhoOSWebhookRecebido, ResultadoAplicacaoRascunhoWebhook } from '../webhookRecebido/tipos';
import type { DedupDurableObject } from './durableObjectDedup';

/** Só o subconjunto de métodos RPC do Durable Object que este arquivo usa — facilita testar com um stub fictício se um dia for preciso, sem depender do tipo completo do DO. */
export type StubDedupParaAplicador = Pick<DedupDurableObject, 'registrarAplicacaoSeNaoDuplicado'>;

export async function aplicarDecisaoIngestaoWorker(
  decisao: DecisaoIngestaoAutomatica,
  obterStub: (instanceId: string, messageId: string) => StubDedupParaAplicador
): Promise<ResultadoAplicacaoRascunhoWebhook> {
  if (!decisao.elegivel) {
    // Rejeita AQUI, antes de qualquer tentativa de obter um stub do
    // Durable Object — nenhuma alocação, nenhuma gravação, nenhum
    // "sucesso de ingestão" para algo que o gate já descartou.
    return { tipo: 'nao_elegivel', motivo: decisao.motivo };
  }

  // A partir daqui, `decisao.elegivel === true` — HOJE nenhum código de
  // produção deste repositório produz essa variante (ver
  // `decidirIngestaoAutomatica.ts`); só alcançável por simulação em teste.
  const { evento } = decisao;
  const rascunhoCandidato: RascunhoOSWebhookRecebido = {
    origem: 'webhook_w_api_callback_nao_autenticado',
    messageId: evento.messageId,
    instanceId: evento.instanceId,
    remetenteId: evento.remetenteId,
    remetenteNome: evento.remetenteNome,
    texto: evento.texto,
    momentoUnix: evento.momentoUnix,
    status: 'pendente_aprovacao',
  };

  const stub = obterStub(evento.instanceId, evento.messageId);
  const resultado = await stub.registrarAplicacaoSeNaoDuplicado(rascunhoCandidato);
  switch (resultado.tipo) {
    case 'aplicado':
      return { tipo: 'rascunho_criado', rascunho: resultado.rascunho };
    case 'duplicado':
      return {
        tipo: 'duplicado',
        motivo: `messageId '${evento.messageId}' já tem uma aplicação efetiva registrada — nenhum rascunho novo foi criado (redelivery, reprocessamento, ou corrida concorrente perdida)`,
        messageId: evento.messageId,
      };
    case 'erro_validacao':
    case 'erro_gravacao':
      return { tipo: 'armazenamento_corrompido', motivo: resultado.motivo };
  }
}
