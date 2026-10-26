// =============================================================================
// Piloto VOCERO (preparação local, NÃO publicada, NÃO conectada) — ingestão de
// OS a partir de UM despacho individual (não-grupo) do CRM "vocero-crm" para
// um "cerebro" externo (nós, aqui, offline).
//
// FONTE E GRAU DE VERIFICAÇÃO (eu mesmo li este código e esta documentação
// nesta sessão — não é declaração de terceiro repassada, é leitura direta):
//   - Repositório público github.com/kevinrivm/vocero-crm, clonado
//     read-only (sem instalar/rodar nada) no commit exato
//     d4e9b1a61fff59110b21270e409fb7ac7f3b75be (tag v1.6.0), confirmado por
//     `git rev-parse HEAD` nesta sessão.
//   - Contrato lido na íntegra: specs/021-despacho-estandar/contracts/despacho.md
//   - Código lido: src/server/dispatch/outbox.ts, src/app/api/bot/context/route.ts,
//     src/app/api/bot/messages/route.ts, src/server/ai/pipeline.ts,
//     src/server/ai/trigger.ts, docker-compose.yml, scripts/e2e-despacho.mjs
//     (só leitura — a verificação de assinatura foi conferida contra o padrão
//     usado ali, mas o script NÃO foi executado).
//
// O QUE É O DESPACHO (confirmado lendo despacho.md):
//   O CRM despacha por POST a `{BRAIN_DISPATCH_URL}` uma "ráfaga" — tudo que o
//   cliente escreveu desde a última resposta, não uma mensagem isolada — para
//   UMA conversa 1:1 (contact.identity). Cabeçalhos:
//     Content-Type: application/json
//     X-Vocero-Signature: sha256=<hex>   (HMAC-SHA256 do corpo CRU, com BOT_API_KEY)
//     X-Vocero-Dispatch-Id: dsp_…
//     X-Vocero-Organization: <slug ou id>
//   A assinatura é sobre o corpo CRU, byte a byte, ANTES de fazer parse do
//   JSON — re-serializar para verificar NUNCA bate (dito explicitamente na doc).
//   `dispatchId` é a CHAVE DE IDEMPOTÊNCIA do despacho recebido: o mesmo
//   dispatchId duas vezes é o MESMO despacho, não dois turnos (despacho.md,
//   linhas 23-24). `messages[]` nunca chega vazio; dedup é por `messages[].id`,
//   porque um despacho seguinte repete mensagens anteriores junto com a nova.
//
// 6 PONTOS CONFIRMADOS NO CÓDIGO/DOC DESTA SESSÃO (nunca inventados):
//
//   V1. GRUPOS/AUTOR SEPARADO — SEM BASE NO CONTRATO. O corpo do despacho não
//       tem NENHUM campo de grupo (nem `isGroup`, nem `group`, nem qualquer
//       variante) — busquei em todo o repositório ("grupo", "isGroup",
//       "group_id") e as únicas ocorrências de "grupo" são agrupamento de
//       conexões/webhooks em `src/server/zernio/conexiones.ts`, sem relação
//       com conversa em grupo do WhatsApp. O modelo é 1:1: `contact.identity`
//       é a chave estável do contato (telefone normalizado, `bsuid:<id>`,
//       `ig:<id>` ou `fb:<id>`) — não existe "autor" separado do contato,
//       porque não há múltiplos remetentes a distinguir num 1:1. Isto é
//       esperado da Meta Cloud API oficial para WhatsApp Business, que não
//       expõe mensagens de grupo pela API de negócios.
//   V2. IA EMBUTIDA É TEXTO APENAS; MÍDIA PRECISA DE TRATAMENTO PRÓPRIO —
//       CONFIRMADO em `src/server/ai/pipeline.ts` (linha 281 no commit lido):
//       o histórico que vira prompt do modelo é construído com
//       `.filter((m) => m.text)` e depois `content: m.text!` — qualquer
//       mensagem sem `.text` (uma imagem/áudio/documento) é EXCLUÍDA do que a
//       IA embutida vê, mesmo que tenha `caption` (que é uma coluna separada
//       no schema, `src/lib/db/schema.ts:482`, nunca lida por esse filtro).
//       `mediaId` se baixa à parte por `GET /api/bot/media/{mediaId}`
//       (despacho.md) — não vem no corpo do despacho.
//   V3. A API BOT NÃO TRAZ HISTÓRICO — CONFIRMADO, e nem é inferência: é um
//       comentário explícito no próprio código,
//       `src/app/api/bot/context/route.ts:22`: "NO devuelve el historial de
//       mensajes: el bot lleva su propia memoria de la conversación."
//   V4. RESPOSTAS (POST /api/bot/messages) NÃO TÊM CHAVE DE IDEMPOTÊNCIA —
//       CONFIRMADO: o `bodySchema` em `src/app/api/bot/messages/route.ts`
//       (linhas 14-19) só aceita `conversationId` e `text` — nenhum campo de
//       idempotência, e o handler não faz nenhuma deduplicação antes de
//       chamar `sendText`. Diferente do despacho ENTRANTE (que tem
//       `dispatchId` como chave de idempotência — V-nota acima), a resposta
//       SAINTE do cérebro não tem proteção equivalente contra reenvio.
//   V5. "COMPOSE" APARENTEMENTE NÃO REPASSA BRAIN_DISPATCH_URL — CONFIRMADO:
//       o bloco `services.app.environment` de `docker-compose.yml` (raiz do
//       repo, ~linhas 20-36) lista várias variáveis (`BOT_API_KEY`,
//       `BRAIN_HEALTH_URL`, `META_APP_SECRET`, etc.) mas NÃO lista
//       `BRAIN_DISPATCH_URL` — mesmo havendo `BRAIN_HEALTH_URL` ao lado dela.
//       Ou seja: quem segue o deploy oficial por `docker compose up -d` (Ruta
//       B do próprio README) e define `BRAIN_DISPATCH_URL` no `.env` não a
//       vê chegar dentro do contêiner da app, porque o compose não a repassa
//       — é preciso editar o `docker-compose.yml` à mão para incluí-la.
//   V6. O OUTBOX REAL É DURÁVEL EM POSTGRES, NÃO EM MEMÓRIA — confirmado em
//       `src/server/dispatch/outbox.ts`: fila com `status` (`pendiente`,
//       `en_vuelo`, `entregado`, `caducado_a_humano`, `descartado`), lease
//       (`leasedUntil`) e até 3 tentativas com backoff 1s→4s. Isso é o lado
//       CRM→cérebro (envio do despacho); o nosso piloto implementa o lado
//       cérebro (recebe despacho → rascunho), e por isso simula durabilidade
//       localmente (ver `armazenamentoDurabilidadeOffline.ts`) — nunca com
//       Postgres real nem servidor novo.
//
// ESCOPO DESTE PILOTO (apertado de propósito, "não abrir um projeto CRM
// amplo"): só o caminho despacho-recebido → rascunho de OS pendente de
// aprovação, para TEXTO em conversa individual. Nada de GET /api/bot/context,
// POST /api/bot/messages, download de mídia, agenda/reservas ou handoff — o
// contrato dessas rotas não foi implementado aqui porque não foi pedido e
// alargaria o escopo.
// =============================================================================

/** Uma mensagem dentro da ráfaga do despacho — forma exata de despacho.md. */
export interface MensagemDespachoBruta {
  id: unknown;
  at: unknown;
  type: unknown;
  text: unknown;
  mediaId: unknown;
  mimeType?: unknown;
  caption?: unknown;
}

/** O corpo do despacho, já com `JSON.parse` feito — ainda não validado estruturalmente. */
export interface DespachoBrutoIndividual {
  dispatchId: unknown;
  organization: unknown;
  conversation: unknown;
  contact: unknown;
  messages: unknown;
  firstMessageAt: unknown;
  lastMessageAt: unknown;
}

/** Cabeçalhos HTTP do despacho, conforme despacho.md. Tudo opcional: entrada não confiável. */
export interface CabecalhosDespachoBrutos {
  /** `X-Vocero-Signature`, formato `sha256=<hex>`. */
  assinatura?: string;
  /** `X-Vocero-Dispatch-Id`, formato `dsp_…`. */
  dispatchId?: string;
  /** `X-Vocero-Organization`, slug ou id. */
  organization?: string;
}

export type TipoMensagemVocero = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts' | string;

/** Uma mensagem de texto já validada, dentro de uma ráfaga. */
export interface MensagemTextoValidada {
  id: string;
  at: string;
  texto: string;
}

/**
 * Rascunho de OS gerado a partir de um despacho individual — NUNCA uma OS
 * real: `status` é um tipo-literal fixo ('pendente_aprovacao') de propósito,
 * igual ao padrão já usado no piloto W-API (`webhookRecebido/tipos.ts`). Não
 * existe, neste módulo, nenhuma função que produza outro valor nem que
 * persista isto como OS de verdade — ver guarda estrutural em
 * `__tests__/semBackendRealVocero.test.ts`.
 */
export interface RascunhoOSVocero {
  origem: 'vocero_despacho_individual_nao_autenticado_em_producao';
  dispatchId: string;
  organizationRef: string;
  conversationId: string;
  contatoId: string;
  contatoIdentidade: string;
  contatoNome?: string;
  canal: string;
  /** Mensagens de texto NOVAS (não vistas num despacho anterior) que compõem este rascunho. */
  mensagens: MensagemTextoValidada[];
  /** ids de mídia presentes na ráfaga, mas NÃO processados (V2 — mídia precisa de tratamento próprio). */
  midiasNaoProcessadas: string[];
  primeiraMensagemEm: string;
  ultimaMensagemEm: string;
  /** Sempre 'pendente_aprovacao' — ver aviso acima. */
  status: 'pendente_aprovacao';
}

export type ResultadoProcessamentoDespacho =
  | { tipo: 'rascunho_criado'; rascunho: RascunhoOSVocero }
  | { tipo: 'assinatura_invalida'; motivo: string }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'duplicado'; motivo: string; dispatchId: string }
  | { tipo: 'quarentena_sem_texto_processavel'; motivo: string; dispatchId: string };
