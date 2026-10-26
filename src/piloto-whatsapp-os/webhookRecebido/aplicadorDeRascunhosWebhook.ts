// Aplicador de rascunho para o módulo webhookRecebido/ — GATEADO
// ESTRITAMENTE pela saída real de `decidirIngestaoAutomatica` (importada
// abaixo só pelo TIPO `DecisaoIngestaoAutomatica`, nunca chamada aqui: quem
// decide elegibilidade é sempre `decidirIngestaoAutomatica.ts`, nunca este
// arquivo). Esta função NUNCA cria, sozinha, uma decisão de elegibilidade —
// ela só reage à decisão que já chegou pronta.
//
// Hoje, `decidirIngestaoAutomatica` não tem NENHUM caminho de código que
// devolva `elegivel:true` (ver decidirIngestaoAutomatica.ts e tipos.ts) — ou
// seja, chamando esta função com a saída REAL dessa decisão, em produção,
// ela NUNCA cria um rascunho. Isso é verificado por teste
// (`__tests__/aplicadorDeRascunhosWebhook.test.ts`, caminho completo com
// fixtures reais), não é só uma alegação neste comentário.
//
// NUNCA cria uma OS real, NUNCA envia nada (nenhuma chamada de rede neste
// arquivo — ver guarda estrutural em `__tests__/semBackendReal.test.ts`),
// NUNCA conecta a um backend real: a "persistência durável" aqui é só o
// arquivo JSON local de `armazenamentoDurabilidadeOffline.ts`, para este
// piloto offline.
//
// ATUALIZADO (revisão independente do patch anterior, mesma rodada de
// 2026-10-20): usa as duas tabelas SEPARADAS do armazenamento — uma
// observação não elegível nunca é consultada para decidir se uma aplicação
// efetiva é duplicata, e vice-versa (ver armazenamentoDurabilidadeOffline.ts
// para o porquê). Também nunca finge sucesso se o armazenamento estiver
// corrompido — propaga isso explicitamente como `armazenamento_corrompido`,
// nunca cria um rascunho sem conseguir provar, com segurança, que não é
// duplicata.
import type { ArmazenamentoDurabilidadeOfflineWebhook } from './armazenamentoDurabilidadeOffline';
import type { DecisaoIngestaoAutomatica, RascunhoOSWebhookRecebido, ResultadoAplicacaoRascunhoWebhook } from './tipos';

/**
 * Aplica (ou não) uma `DecisaoIngestaoAutomatica` já calculada. Deduplica por
 * `messageId` de forma durável — uma redelivery do mesmo `messageId` (mesmo
 * callback reentregue pelo provedor, ou reprocessamento acidental) nunca
 * cria um segundo rascunho nem reavalia a decisão de novo.
 *
 * Esta função não tem acesso ao payload bruto nem ao validador — só à
 * decisão e aos metadados de auditoria que ela carrega — exatamente para
 * nunca poder "decidir de novo" por conta própria.
 */
export function aplicarDecisaoIngestao(
  decisao: DecisaoIngestaoAutomatica,
  armazenamento: ArmazenamentoDurabilidadeOfflineWebhook
): ResultadoAplicacaoRascunhoWebhook {
  if (!decisao.elegivel) {
    const messageId = decisao.auditoria.messageId;
    if (typeof messageId === 'string' && messageId.length > 0) {
      // Só auditoria — nunca escrito na tabela de aplicações efetivas, e
      // nunca usado para deduplicar uma aplicação futura do mesmo messageId.
      const registro = armazenamento.registrarObservacaoNaoElegivel(messageId, decisao.motivo);
      if (!registro.ok) {
        return { tipo: 'armazenamento_corrompido', motivo: registro.motivo };
      }
    }
    return { tipo: 'nao_elegivel', motivo: decisao.motivo };
  }

  // A partir daqui, `decisao.elegivel === true` — HOJE, nenhum código de
  // produção deste repositório produz essa variante (ver comentário acima).
  // Só é alcançável a partir de uma simulação explícita em teste.
  const { evento } = decisao;
  const messageId = evento.messageId;

  const consulta = armazenamento.consultarAplicacaoEfetiva(messageId);
  if (consulta.situacao === 'armazenamento_corrompido') {
    // FAIL-CLOSED: nunca cria rascunho sem conseguir provar, com segurança,
    // que este messageId não foi aplicado antes — mesmo que isso signifique
    // bloquear um caso que poderia ser legítimo. O arquivo corrompido fica
    // intacto em disco para diagnóstico manual (nunca sobrescrito aqui).
    return { tipo: 'armazenamento_corrompido', motivo: consulta.motivo };
  }
  if (consulta.situacao === 'aplicado') {
    return {
      tipo: 'duplicado',
      motivo: `messageId '${messageId}' já tem uma aplicação efetiva registrada — nenhum rascunho novo foi criado (redelivery ou reprocessamento)`,
      messageId,
    };
  }

  const rascunho: RascunhoOSWebhookRecebido = {
    origem: 'webhook_w_api_callback_nao_autenticado',
    messageId,
    instanceId: evento.instanceId,
    remetenteId: evento.remetenteId,
    remetenteNome: evento.remetenteNome,
    texto: evento.texto,
    momentoUnix: evento.momentoUnix,
    status: 'pendente_aprovacao',
  };

  const registro = armazenamento.registrarAplicacaoEfetiva(messageId, rascunho);
  if (!registro.ok) {
    // Nunca afirma que o rascunho foi persistido de forma durável se a
    // escrita em si falhou.
    return { tipo: 'armazenamento_corrompido', motivo: registro.motivo };
  }

  return { tipo: 'rascunho_criado', rascunho };
}
