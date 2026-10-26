// =============================================================================
// Contrato do CALLBACK de "mensagem recebida" ('webhookReceived') do W-API —
// escopo: SÓ TEXTO PRIVADO (isGroup:false). Diferente de todo o resto deste
// piloto, os campos abaixo não são mais um contrato hipotético inventado por
// mim: vêm de uma fonte pública citada pelo usuário.
//
// FONTE E SEU GRAU DE VERIFICAÇÃO (corrigido — registrado com precisão):
//   - Páginas públicas da coleção Postman do W-API, com URLs específicas:
//       · retorno-de-texto:   postman.com/w-api/w-api-api-do-whatsapp/request/l9kao55/retorno-de-texto
//       · retorno-de-imagem:  postman.com/w-api/w-api-api-do-whatsapp/request/og2p6ve/retorno-de-imagem
//       · buscar-webhook-log: postman.com/w-api/w-api-api-do-whatsapp/request/hcoaomx/buscar-webhook-log-por-id
//   - Essas páginas foram inspecionadas por outra ferramenta/processo — não
//     pelo usuário (Márcio) pessoalmente, nem por mim diretamente — e o
//     trecho resultante foi repassado a mim nesta conversa. Ou seja: isto
//     NÃO é "verificação independente de Márcio" nem "documentação que eu
//     li/confirmei diretamente" — é um trecho de terceiro repassado, com
//     fonte citada.
//   - Eu também tentei confirmar essas páginas de forma independente nesta
//     sessão (ferramenta de busca de página). RESULTADO DO TESTE REALMENTE
//     EXECUTADO: a página do Postman é renderizada via JavaScript (SPA) — o
//     que recebi de volta foi só o esqueleto HTML vazio (viewport + título
//     "Postman"), sem o JSON do payload. Minha tentativa de confirmação
//     falhou.
//   - Por isso, tudo abaixo é tratado como "trecho de terceiro, repassado a
//     mim, com fonte citada, sem verificação independente de ninguém nesta
//     conversa" — nunca como "documentação que eu li" nem como "Márcio
//     confirmou pessoalmente".
//
// O QUE FOI DECLARADO (evento de TEXTO privado, isGroup:false):
//   event: 'webhookReceived'
//   instanceId, connectedPhone, messageId: string
//   isGroup: false ; fromMe: boolean
//   chat: { id: string (id da conversa), profilePicture?: string }
//   sender: { id: string, profilePicture?: string, pushName?: string, verifiedBizName?: string }
//     — o próprio usuário observou que o comentário da doc sobre `sender.id`
//       é AMBÍGUO entre telefone/grupo; para texto privado tratamos como
//       identificador do remetente, sem mais garantia que isso.
//   moment: number (unix timestamp)
//   msgContent.extendedTextMessage.text: string
//
// O QUE FOI DECLARADO SOBRE IMAGEM (retorno-de-imagem) — DELIBERADAMENTE FORA
// DE ESCOPO NESTA ETAPA, não implementado, só citado para não se perder:
//   msgContent.imageMessage: { url (só o esquema, vazio, placeholder),
//   mimetype, caption?, fileLength (string), height, width, mediaKey,
//   fileEncSha256, directPath, jpegThumbnail (todos vazios no exemplo),
//   mediaKeyTimestamp, contextInfo, viewOnce:false }.
//   Isso NÃO comprova download, decriptação nem validade/expiração da mídia
//   — qualquer um desses pontos permanece não verificado. Por isso qualquer
//   payload cujo msgContent não seja `extendedTextMessage` é colocado em
//   quarentena por este módulo (ver `processarWebhookRecebido.ts`), nunca
//   processado como se fosse texto.
//
// O QUE FOI DECLARADO SOBRE LOGS (buscar-webhook-log-por-id): retenção de log
// por 30 dias. Isso é retenção de LOG, não garantia de reentrega/replay do
// evento em si — os dois são coisas diferentes e não devem ser confundidos.
//
// O QUE CONTINUA SEM VERIFICAÇÃO (gates residuais — registrados explicita-
// mente, não bloqueiam este preparo offline, mas bloqueiam qualquer uso real):
//   G1. Autenticidade do callback: nenhuma assinatura/HMAC, header de segredo
//       compartilhado ou Bearer verificado PARA A ENTREGA do evento (o Bearer
//       documentado antes é só da chamada de CONFIGURAÇÃO do webhook).
//   G2. Grupos (isGroup:true): nenhum payload de grupo verificado. A
//       ambiguidade de `sender.id` citada pelo usuário não foi resolvida.
//       Por isso: grupos são sempre rejeitados/colocados em quarentena por
//       este módulo, nunca normalizados.
//   G3. Mídia (imagem/áudio/documento): payload de imagem foi declarado, mas
//       download, decriptação (mediaKey/fileEncSha256) e validade/expiração
//       da URL não foram verificados. Por isso mídia fica em quarentena.
//   G4. Reentrega/replay/ordem/ack/timeout: não verificado. A retenção de
//       log de 30 dias não é evidência disso.
//   G5. Trial de 7 dias e termos de uso: ainda não verificado (lacuna já
//       registrada antes, continua aberta).
//
// NENHUM destes tipos deve virar integração real sem resolver G1–G5 contra a
// documentação oficial do provedor (não só a coleção Postman).
// =============================================================================

/** Payload bruto como declarado pela fonte citada, para TEXTO privado. Ainda não confiável — passa por `validarPayloadBruto` antes de qualquer uso. */
export interface PayloadWebhookRecebidoBrutoTexto {
  event: unknown;
  instanceId: unknown;
  connectedPhone: unknown;
  messageId: unknown;
  isGroup: unknown;
  fromMe: unknown;
  chat: unknown;
  sender: unknown;
  moment: unknown;
  msgContent: unknown;
}

/**
 * Evento de texto privado já validado estruturalmente e NORMALIZADO — nunca
 * confundir "normalizado" com "autenticado". O campo `autenticidade` é um
 * tipo-literal fixo ('NAO_VERIFICADA') de propósito: não existe, nesta etapa,
 * nenhuma função neste módulo capaz de produzir outro valor. Mudar isso exige
 * alterar deliberadamente este arquivo depois de confirmar o gate G1 acima.
 */
export interface EventoTextoPrivadoNormalizado {
  origem: 'webhook_w_api_callback_nao_autenticado';
  instanceId: string;
  connectedPhone: string;
  messageId: string;
  remetenteId: string;
  remetenteNome?: string;
  fromMe: boolean;
  momentoUnix: number;
  texto: string;
  /** Sempre 'NAO_VERIFICADA' nesta etapa — ver gate G1. */
  autenticidade: 'NAO_VERIFICADA';
}

export type ResultadoProcessamentoWebhookRecebido =
  | { tipo: 'normalizado'; evento: EventoTextoPrivadoNormalizado }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'quarentena_grupo_nao_suportado'; motivo: string }
  | { tipo: 'quarentena_tipo_de_conteudo_nao_suportado'; motivo: string };

// =============================================================================
// CORREÇÃO DE SEGURANÇA (OFFLINE) — elegibilidade para criação AUTOMÁTICA de
// rascunho de OS, separada da normalização acima.
//
// POLÍTICA DESTA APLICAÇÃO (decisão de produto nossa — NÃO é filtro, garantia
// ou comportamento documentado do fornecedor W-API): uma mensagem com
// `fromMe:true` (eco de algo que a própria instância conectada enviou) NUNCA
// deve virar, automaticamente, um novo rascunho de OS. Isso é regra nossa,
// para evitar que a instância crie rascunhos a partir de mensagens que ela
// mesma mandou (confirmações, respostas automáticas, etc.) — o W-API não
// declara nem garante nada sobre isso; a decisão é só nossa.
//
// Metadados de auditoria são preservados mesmo quando a mensagem é
// ignorada/quarentenada para ingestão automática — para investigação manual
// depois, sem nunca criar um rascunho sozinha.
//
// CORREÇÃO ADICIONAL (2ª rodada, FAIL-CLOSED): a ausência de um backend real
// hoje NÃO é, e nunca foi, a salvaguarda de elegibilidade — a checagem em
// `decidirIngestaoAutomatica.ts` é. Por isso, além do eco (fromMe:true),
// NENHUM evento deste módulo é elegível para criação automática enquanto o
// campo `autenticidade` for 'NAO_VERIFICADA' — e hoje é o único valor que
// esse campo pode ter (gate G1 acima). Isso vale inclusive para
// fromMe:false. Nenhum status de autenticação "verificado", nem nenhum
// verificador do fornecedor, foi inventado para contornar isto — a
// elegibilidade automática simplesmente não existe ainda neste módulo.
//
// CORREÇÃO FINAL (3ª rodada, FAIL-CLOSED DEFINITIVO): tipo TypeScript não
// garante valor em runtime — nada impede, em tempo de execução, que
// `decidirIngestaoAutomatica` receba `null`, `undefined`, um objeto
// malformado, ou um valor de autenticidade ausente/desconhecido/forjado
// (alguém tentando simular um status "verificado" que não existe). Por
// isso a função trata a entrada como `unknown` e não tem MAIS NENHUM
// caminho de código que devolva uma decisão positiva — nem para o caso
// "normal" (autenticidade 'NAO_VERIFICADA', fromMe:false), nem para
// nenhum outro. Toda entrada, sem exceção, resulta em não-elegível, sem
// lançar erro. Isto conclui esta salvaguarda — não é lacuna para depois.
// Os metadados de auditoria abaixo refletem isso: são só o que foi possível
// OBSERVAR com segurança na entrada (nunca o que foi "confirmado"), por
// isso todos os campos são opcionais e nenhum deles concede confiança.
// =============================================================================

/**
 * Metadados preservados para auditoria quando uma mensagem é ignorada para
 * ingestão automática. Todos os campos são o que foi possível OBSERVAR com
 * segurança na entrada recebida — nunca um fato confirmado — por isso são
 * opcionais: uma entrada malformada, ou sem algum campo, não deve lançar
 * erro, só resultar em metadado ausente aqui. Nenhum destes campos é usado
 * para criar rascunho sozinho, e nenhum deles concede confiança.
 */
export interface MetadadosAuditoriaIngestao {
  instanceId?: string;
  messageId?: string;
  remetenteId?: string;
  momentoUnix?: number;
  fromMe?: boolean;
  /**
   * O valor de autenticidade OBSERVADO na entrada, tal como veio — pode
   * estar ausente, ser de outro tipo, ou ser uma string forjada tentando
   * simular um status "verificado" que este módulo não implementa. Nunca
   * tratar este campo como confirmado; ele é só registro para auditoria.
   */
  autenticidadeObservada?: string;
}

export type DecisaoIngestaoAutomatica =
  | { elegivel: true; evento: EventoTextoPrivadoNormalizado } // nenhum código deste módulo produz esta variante hoje — ver decidirIngestaoAutomatica.ts
  | { elegivel: false; motivo: string; auditoria: MetadadosAuditoriaIngestao };

// =============================================================================
// CAMADA NOVA (retomada do piloto W-API em 2026-10-20) — aplicador de
// rascunho GATEADO pela decisão real de `decidirIngestaoAutomatica`, nunca
// por um atalho próprio. Esta camada NÃO reabre o gate G1: ela só existe
// para que, no dia em que G1 for resolvido de verdade (fora deste módulo) e
// `decidirIngestaoAutomatica` passar a poder devolver `elegivel:true`, já
// exista um caminho testado, com deduplicação durável por `messageId`, para
// transformar isso num rascunho de OS sempre `pendente_aprovacao` (nunca uma
// OS real, nunca enviado a lugar nenhum). Hoje, chamando esta camada com a
// saída REAL de `decidirIngestaoAutomatica` (sempre `elegivel:false`), ela
// NUNCA cria rascunho — isso é coberto por teste, não é alegação.
//
// Simulações de "como seria se elegivel:true" (para testar só esta camada,
// isoladamente da pergunta ainda não resolvida de autenticidade) vivem
// SOMENTE em código de teste, explicitamente rotuladas como simulação —
// nunca nesta camada nem em `decidirIngestaoAutomatica.ts`.
// =============================================================================

/** Rascunho de OS a partir de um evento de webhook elegível — sempre `pendente_aprovacao`, nunca aplicado como OS real. */
export interface RascunhoOSWebhookRecebido {
  origem: 'webhook_w_api_callback_nao_autenticado';
  messageId: string;
  instanceId: string;
  remetenteId: string;
  remetenteNome?: string;
  texto: string;
  momentoUnix: number;
  status: 'pendente_aprovacao';
}

export type ResultadoAplicacaoRascunhoWebhook =
  | { tipo: 'rascunho_criado'; rascunho: RascunhoOSWebhookRecebido }
  | { tipo: 'nao_elegivel'; motivo: string }
  | { tipo: 'duplicado'; motivo: string; messageId: string }
  // CORREÇÃO (revisão independente do patch, mesma rodada de 2026-10-20):
  // antes, um arquivo de armazenamento corrompido virava silenciosamente
  // "estado vazio" (fail-closed só de nome — na prática, perda silenciosa
  // do histórico de deduplicação). Agora isso é um resultado EXPLÍCITO,
  // nunca escondido atrás de 'nao_elegivel' nem de um rascunho "criado" sem
  // garantia de dedup — ver armazenamentoDurabilidadeOffline.ts.
  | { tipo: 'armazenamento_corrompido'; motivo: string };
