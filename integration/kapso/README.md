# Adaptador Kapso (WhatsApp) — OFFLINE

Receptor/validador de webhooks do Kapso que produz **rascunhos para
revisão humana**. Não conecta nenhuma conta Kapso real, não cria chave
de API, OAuth nem assinatura de webhook, não envia mensagem nenhuma,
não publica nem compra nada. Nada aqui despacha uma OS ou qualquer
outra ação automaticamente — toda mensagem aceita vira um rascunho com
`status: 'aguardando_revisao_humana'`, nunca mais que isso.

Baseado só no que está documentado hoje em:

- https://docs.kapso.ai/docs/platform/webhooks/security
- https://docs.kapso.ai/docs/platform/webhooks/message-events
- https://docs.kapso.ai/docs/platform/webhooks/advanced

## Arquivos

- `signature.cjs` — verificação HMAC-SHA256 (hex) da assinatura, sobre
  os bytes originais do corpo, em tempo constante.
- `webhook.cjs` — o adaptador em si: `processarEntregaWebhook({headers,
  rawBody}, config, store)`. Verifica assinatura antes de fazer
  `JSON.parse`; reconhece entrega única e em lote; ignora (sem erro)
  eventos que não são `whatsapp.message.received`, mensagens de
  `history_sync`, direção diferente de `inbound` e números passivos;
  exige `phone_number_id` conhecido via configuração explícita; monta o
  rascunho sem nunca interpretar o texto.
- `memory-store.cjs` — **fixture** de armazenamento em memória, só para
  teste/demonstração da interface exigida (`enqueueRascunho`,
  `quarentenar`). Nunca é a implementação real: perde tudo ao reiniciar
  o processo.

## Bloqueios de configuração — isto NÃO funciona sem:

1. `config.webhookSecret` — o segredo de assinatura deste webhook
   específico (gerado e rotacionado no painel do Kapso). Sem ele, toda
   requisição é tratada como assinatura inválida.
2. `config.vinculosPermitidos` — lista explícita de
   `{phoneNumberId, senderField: 'from' | 'from_user_id', senderValue, projetoId}`.
   Remetente ausente/desconhecido ou vínculos correspondentes apontando para
   projetos distintos vão para quarentena. Não existe inferência de projeto.
3. Um `store` real e durável que implemente `enqueueRascunho`/
   `quarentenar` com as mesmas garantias testadas no fixture: dedup
   atômico e nunca confirmar antes de persistir. `memory-store.cjs` não
   serve para isso em produção.
4. Ligação deste adaptador a um transporte HTTP real (framework do
   host) que: (a) entregue o corpo como `Buffer` dos bytes originais
   — nunca já decodificado/reformatado — para `rawBody`; (b) só
   responda 200 ao Kapso depois que `processarEntregaWebhook` devolver
   `{status:'ok'}` com cada item persistido; (c) responda um status
   diferente de 2xx para `assinatura_invalida`, `payload_invalido`,
   `falha_armazenamento` e `bloqueado_configuracao`, para o Kapso
   reentregar.
5. Cadastro do webhook no painel do Kapso (URL, segredo, eventos
   assinados) — fora do código, nunca feito por este adaptador.

Nenhum destes cinco pontos tem um valor padrão "que funciona para
começar" — a ausência de qualquer um é um bloqueio explícito
(`status: 'bloqueado_configuracao'`), nunca contornada com um valor
fictício.

## Lacunas da documentação (confirmadas, não suposições)

- **Sem cabeçalho de timestamp assinado.** Nenhuma das três páginas
  documenta um timestamp de entrega protegido por assinatura.
  `message.timestamp` é quando a mensagem foi originada no WhatsApp,
  não quando o webhook foi entregue — nunca tratamos os dois como a
  mesma coisa. A defesa primária contra reentrega/replay aqui é o dedup
  determinístico (`phone_number_id` + `message.id` + hash do conteúdo).
  `config.maxMessageAgeSeconds` é uma heurística ADICIONAL e opcional
  (desligada por padrão) — documentada aqui como não sendo uma garantia
  criptográfica, só uma rejeição de "obviamente velho demais".
- **`X-Idempotency-Key` não é usado como identidade de dedup.** A doc
  não afirma se esse header está coberto pela assinatura HMAC. Por
  segurança, o dedup nunca depende dele — só do conteúdo assinado do
  corpo.
- **Sem mapeamento documentado `phone_number_id` → conta/projeto** —
  por isso o bloqueio de configuração nº 2 acima.
- **`from`, `phone_number`, `to`, `wa_id` não são garantidos
  presentes** (aviso explícito da própria documentação) — o rascunho
  sempre marca `remetente: null` quando ausente, nunca inventa ou
  infere um valor.
- **`history_sync` é um valor de `message.kapso.origin`, não um tipo de
  evento** — mensagens com essa origem são backfill de histórico, não
  recebimento em tempo real; este adaptador as ignora sempre.

## O que este adaptador nunca faz

- Nunca extrai endereço, equipe ou horário do texto por conta própria —
  o texto fica bruto no rascunho, para um humano ler.
- Nunca despacha uma OS ou qualquer ação a partir de uma mensagem.
- Nunca confirma (ack) uma entrega antes de persistir de verdade.
- Nunca usa um `phone_number_id` fora do mapa de configuração.
- Nunca trata `X-Idempotency-Key` como identidade de dedup.

## Fluxo local sintético persistente

Consulte `LOCAL-TEST.md`. O SQLite local, servidor e tela são exclusivamente de
teste. Não substituem autorização, hospedagem e persistência de produção.
