// =============================================================================
// ISTO NÃO É UM RECEPTOR IMPLANTADO. Nenhum `wrangler deploy` foi executado
// nesta rodada, nenhuma conta Cloudflare foi usada para publicar nada — ver
// README.md e RUNBOOK.md. Este arquivo só roda localmente, dentro do
// runtime de testes (Miniflare via `@cloudflare/vitest-plugin`).
//
// Reaproveita, SEM ALTERAR, o mesmo pipeline já testado em
// `../webhookRecebido/__tests__/aplicadorDeRascunhosWebhook.test.ts`:
// processarWebhookRecebido -> decidirIngestaoAutomatica ->
// (agora) aplicarDecisaoIngestaoWorker. As peças novas são a entrada
// `fetch(Request)`, as PROTEÇÕES DE ENTRADA abaixo (`limitarEntradaHttp.ts`)
// e a store de deduplicação baseada em Durable Object — ver
// `durableObjectDedup.ts`.
//
// ORDEM DELIBERADA desta função (preparação desta rodada, revisão de
// proteção de entrada): cada verificação roda na ordem do mais BARATO/MENOS
// confiável para o mais CARO/MAIS confiável, e NENHUMA delas aloca Durable
// Object:
//   1. `RECEPTOR_HABILITADO` (interruptor local, não secreto — ver
//      wrangler.jsonc) — se desligado, rejeita tudo, sem olhar para o resto
//      da requisição.
//   2. método + rota + Content-Type/Content-Encoding (`validarMetodoRotaFormato`).
//   3. tamanho REAL do corpo, contando bytes conforme chegam
//      (`lerCorpoComLimiteDeBytes` — nunca confia em Content-Length).
//   4. decodificação UTF-8 estrita, depois `JSON.parse`.
//   5. SÓ DEPOIS disso tudo: `processarWebhookRecebido` ->
//      `decidirIngestaoAutomatica` -> `aplicarDecisaoIngestaoWorker`, que
//      por sua vez (ver esse arquivo) só aloca um Durable Object quando
//      `decisao.elegivel === true` — HOJE isto nunca acontece (gate G1
//      fechado), então nenhuma requisição real aloca ou grava em nenhum
//      Durable Object. Isto não é um detalhe de performance: é uma
//      proteção antiabuso (ninguém consegue gastar recursos de
//      armazenamento só enviando lixo que nunca seria elegível mesmo
//      assim) pedida explicitamente nesta rodada.
//
// Corpo cru: lido como bytes, nunca como texto sem limite (ver
// `limitarEntradaHttp.ts`), mantido em memória só durante esta chamada
// (para uma eventual verificação de assinatura futura, nunca inventada
// aqui), NUNCA logado, NUNCA devolvido na resposta, NUNCA persistido.
// Cabeçalhos continuam só OBSERVADOS — a resposta devolve apenas a
// CONTAGEM deles (`x-cabecalhos-observados-count`, nunca os valores em si,
// que poderiam conter algo sensível), e nenhum cabeçalho é usado para
// decidir nada — mesma política do `manipularCallbackHttpSintetico.ts`
// node. Nenhuma assinatura/segredo do fornecedor foi inventado aqui, e
// nenhum bypass por query/header/env existe — `RECEPTOR_HABILITADO` só
// DESLIGA o receptor inteiro, nunca abre o gate de autenticidade.
//
// NUNCA UM 2xx PARA CONTEÚDO DESCARTADO (correção de uma revisão desta
// rodada): com autenticidade do remetente ainda SEM mecanismo verificado,
// devolver 200 para "recebido, mas não-elegível"/"recebido, mas em
// quarentena (grupo/mídia)" confirmaria recebimento de dados que nunca
// foram autenticados — informação que um chamador não autorizado não
// deveria conseguir extrair ("meu payload chegou e foi processado até
// aqui"). Por isso `responderRecebimentoDescartado` abaixo devolve SEMPRE
// 503 (não-2xx, mesmo status para as três variantes — texto não-elegível,
// grupo, mídia — de propósito, para não vazar QUAL classificação interna
// um payload recebeu através do código de status) e NUNCA aloca/grava em
// nenhum Durable Object. Nenhum cabeçalho ou parâmetro de query "fingindo"
// autenticação (ex.: `Authorization`, `X-Hub-Signature`, `?verified=true`)
// é lido em nenhum ponto deste arquivo — não existe, portanto, nenhum jeito
// de uma requisição forjada obter um 2xx ou escapar desta rejeição (ver
// testes "headers/query fingindo auth" em `__tests__/workerFetch.test.ts`).
// `duplicado`/`rascunho_criado` abaixo permanecem 200 — mas são caminhos
// HOJE inalcançáveis por tráfego real (exigem `decisao.elegivel === true`,
// que `decidirIngestaoAutomatica.ts` nunca produz) e não foram alterados
// por não estarem no escopo desta correção.
import { processarWebhookRecebido } from '../webhookRecebido/processarWebhookRecebido';
import { decidirIngestaoAutomatica } from '../webhookRecebido/decidirIngestaoAutomatica';
import { aplicarDecisaoIngestaoWorker, type StubDedupParaAplicador } from './aplicarDecisaoIngestaoWorker';
import { codificarChaveCompostaDedup } from './chaveCompostaDedup';
import { DedupDurableObject } from './durableObjectDedup';
import { decodificarUtf8Estrito, lerCorpoComLimiteDeBytes, TAMANHO_MAXIMO_CORPO_BYTES, validarMetodoRotaFormato } from './limitarEntradaHttp';

export { DedupDurableObject };

export interface Env {
  DEDUP_DO: DurableObjectNamespace<DedupDurableObject>;
  /**
   * Interruptor LOCAL, NÃO SECRETO (uma var de `wrangler.jsonc`, nunca um
   * secret) — "false"/ausente/qualquer valor que não seja exatamente
   * "true" DESLIGA o receptor inteiro antes de qualquer leitura de corpo
   * ou alocação de Durable Object. Nunca abre o gate de autenticidade
   * (G1) — só controla se o receptor responde ou não. Ver RUNBOOK.md para
   * o procedimento de ativação/desativação.
   */
  RECEPTOR_HABILITADO?: string;
}

function obterStubParaChave(env: Env, instanceId: string, messageId: string): StubDedupParaAplicador {
  // Codificação não ambígua — ver chaveCompostaDedup.ts (revisão nº2: a
  // concatenação anterior com '::' podia endereçar pares diferentes para o
  // MESMO Durable Object).
  const id = env.DEDUP_DO.idFromName(codificarChaveCompostaDedup(instanceId, messageId));
  return env.DEDUP_DO.get(id);
}

function responderComAuditoria(request: Request, corpo: Record<string, unknown>, status: number, cabecalhosExtras?: Record<string, string>): Response {
  let contagem = 0;
  for (const _ of request.headers.keys()) contagem++;
  return Response.json(corpo, { status, headers: { 'x-cabecalhos-observados-count': String(contagem), ...cabecalhosExtras } });
}

/**
 * Resposta para conteúdo DESCARTADO (não-elegível, grupo, mídia) — nunca um
 * 2xx, sempre 503, nunca confirma recebimento de algo que não foi
 * autenticado. Ver comentário de cabeçalho do arquivo.
 */
function responderRecebimentoDescartado(request: Request, resultado: string, detalhe: string): Response {
  return responderComAuditoria(request, { resultado, detalhe }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1) Interruptor local — rejeita ANTES de qualquer outra coisa, sem
    // olhar método/corpo, sem alocar nada.
    if (env.RECEPTOR_HABILITADO !== 'true') {
      return responderComAuditoria(request, { resultado: 'receptor_desabilitado', detalhe: 'RECEPTOR_HABILITADO não está ligado nesta implantação' }, 503);
    }

    // 2) Método + rota + Content-Type/Content-Encoding — barato, sem I/O.
    const validacaoDeFormato = validarMetodoRotaFormato(request);
    if (!validacaoDeFormato.ok) {
      // `cabecalhosExtras` carrega `Allow: POST` no caso 405 (exigido por
      // RFC 9110 §15.5.6 — ver limitarEntradaHttp.ts) — ausente nos demais
      // casos (404/400/415).
      return responderComAuditoria(
        request,
        { resultado: 'requisicao_rejeitada', detalhe: validacaoDeFormato.motivo },
        validacaoDeFormato.status,
        validacaoDeFormato.cabecalhosExtras
      );
    }

    // 3) Tamanho REAL do corpo (nunca confia em Content-Length) — ver
    // limitarEntradaHttp.ts para o porquê de ler o stream manualmente.
    const leituraDoCorpo = await lerCorpoComLimiteDeBytes(request, TAMANHO_MAXIMO_CORPO_BYTES);
    if (!leituraDoCorpo.ok) {
      return responderComAuditoria(request, { resultado: 'requisicao_rejeitada', detalhe: leituraDoCorpo.motivo }, leituraDoCorpo.status);
    }

    // 4) Decodificação UTF-8 estrita, depois JSON — nunca ecoa o conteúdo
    // bruto nem o erro cru do decoder/parser.
    const decodificacao = decodificarUtf8Estrito(leituraDoCorpo.bytes);
    if (!decodificacao.ok) {
      return responderComAuditoria(request, { resultado: 'invalido', detalhe: decodificacao.motivo }, 400);
    }

    let corpoJson: unknown;
    try {
      corpoJson = JSON.parse(decodificacao.texto);
    } catch {
      return responderComAuditoria(request, { resultado: 'invalido', detalhe: 'corpo não é JSON válido' }, 400);
    }

    const normalizado = processarWebhookRecebido(corpoJson);
    if (normalizado.tipo === 'invalido') {
      return responderComAuditoria(request, { resultado: 'invalido', detalhe: normalizado.motivo }, 400);
    }
    if (normalizado.tipo === 'quarentena_grupo_nao_suportado' || normalizado.tipo === 'quarentena_tipo_de_conteudo_nao_suportado') {
      // Nunca 2xx — ver comentário de cabeçalho ("NUNCA UM 2xx PARA
      // CONTEÚDO DESCARTADO"). Grupo/mídia nunca alocam Durable Object
      // (este `return` acontece antes de qualquer chamada a
      // `aplicarDecisaoIngestaoWorker`/`obterStubParaChave`).
      return responderRecebimentoDescartado(request, normalizado.tipo, normalizado.motivo);
    }

    // 5) Decisão de elegibilidade (gate G1, sempre fechado hoje) ->
    // aplicação. `aplicarDecisaoIngestaoWorker` só aloca um Durable Object
    // quando `decisao.elegivel === true` — ver esse arquivo.
    const decisao = decidirIngestaoAutomatica(normalizado.evento);
    const aplicacao = await aplicarDecisaoIngestaoWorker(decisao, (instanceId, messageId) => obterStubParaChave(env, instanceId, messageId));

    switch (aplicacao.tipo) {
      case 'armazenamento_corrompido':
        return responderComAuditoria(request, { resultado: 'armazenamento_corrompido', detalhe: aplicacao.motivo }, 500);
      case 'nao_elegivel':
        // Nunca 2xx — ver comentário de cabeçalho. `aplicarDecisaoIngestaoWorker`
        // já rejeitou isto antes de qualquer tentativa de obter um stub do
        // Durable Object (ver esse arquivo) — nenhuma alocação acontece aqui.
        return responderRecebimentoDescartado(request, 'recebido_nao_elegivel', aplicacao.motivo);
      case 'duplicado':
        return responderComAuditoria(request, { resultado: 'recebido_duplicado', detalhe: aplicacao.motivo }, 200);
      case 'rascunho_criado':
        // HOJE inalcançável pelo caminho real — ver aplicarDecisaoIngestaoWorker.ts.
        return responderComAuditoria(request, { resultado: 'recebido_rascunho_pendente_aprovacao' }, 200);
    }
  },
} satisfies ExportedHandler<Env>;
