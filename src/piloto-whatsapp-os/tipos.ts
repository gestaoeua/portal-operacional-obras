// =============================================================================
// PILOTO (preparação local, NÃO publicada, NÃO conectada) — ingestão de OS a
// partir de mensagens de WhatsApp em grupo.
//
// ATUALIZAÇÃO DE ESCOPO: para TEXTO PRIVADO (isGroup:false), o contrato do
// callback 'webhookReceived' deixou de ser hipotético — existe uma fonte
// pública citada (coleção Postman) e o adaptador real para esse caso vive em
// `./webhookRecebido/` (tipos.ts, validarPayloadBruto.ts,
// processarWebhookRecebido.ts). Os tipos ABAIXO deste arquivo continuam
// sendo só o contrato HIPOTÉTICO de GRUPO — grupos ainda não têm payload
// verificado (ver gate G2 em `./webhookRecebido/tipos.ts`) e por isso o
// adaptador real coloca qualquer mensagem de grupo em quarentena, nunca
// usando o formato hipotético abaixo como se fosse confirmado.
//
// AVISO CRÍTICO: os tipos abaixo representam um CONTRATO HIPOTÉTICO/SIMULADO
// de evento de webhook, escrito por mim a partir de padrões genéricos de
// serviços de WhatsApp não oficiais — NUNCA confirmado contra a documentação
// real do provedor (W-API, w-api.app). Não atribua este formato ao contrato
// real do W-API. Os pontos abaixo ficaram como lacuna explícita no parecer
// técnico anterior porque `docs.w-api.app` está bloqueado por robots.txt
// para minhas ferramentas de busca, e nenhuma fonte de terceiros verificável
// foi encontrada:
//
//   1. Autenticidade de webhook — não se sabe se há assinatura/HMAC, header
//      de segredo, ou validação por IP. `autenticidadeVerificada` abaixo é
//      um campo que o adaptador real (ainda não escrito) teria que preencher
//      — aqui ele é só um booleano de fixture.
//   2. Identidade do autor em mensagem de grupo — não se sabe se o payload
//      real traz um campo de participante/autor estável (telefone ou ID).
//      `autor` abaixo é opcional de propósito — o parser tem que funcionar
//      mesmo sem ele, sinalizando para triagem manual.
//   3. Estabilidade de ID de mensagem / deduplicação — não confirmado se o
//      ID do provedor é estável e único. `idMensagem` é tratado aqui como
//      "pode repetir, pode faltar" — a lógica de deduplicação (ver
//      `aplicadorDeRascunhos.ts`) não assume garantia nenhuma do provedor.
//   4. Ordem de entrega, reconexão e replay de lacunas — não confirmado se
//      há reenvio após queda de instância. Por isso todo processamento aqui
//      é intencionalmente idempotente e tolerante a ordem (ver testes).
//   5. Mídia e retenção — não confirmado por quanto tempo um link de mídia
//      fica válido nem o formato exato da referência. `midia.refExterna`
//      abaixo é só um placeholder de string, nunca uma URL real.
//   6. Cobertura do trial de 7 dias e termos de uso — não verificado.
//
// ATUALIZAÇÃO (DOCUMENTADO — trecho da documentação oficial, seção "Ao
// receber" (LITE/PRO), colado por Márcio nesta conversa em 2026-10-18; eu
// não tenho acesso a docs.w-api.app, bloqueado por robots.txt, então este
// trecho é a única fonte oficial que possuo e cito exatamente o que foi
// fornecido, sem completar o que não veio):
//
//   - Esse trecho documenta só o ENDPOINT DE CONFIGURAÇÃO (control plane) —
//     onde se registra a URL que vai receber os eventos — e não o formato
//     do evento em si:
//       PUT (HTTPS obrigatório, HTTP rejeitado) api.w-api.app/v1/webhook/update-webhook-received?instanceId=INSTANCE_ID
//       Headers: Content-Type: application/json ; Authorization: Bearer <SEU_TOKEN> (placeholder da doc, não é segredo real)
//       Body obrigatório: { "value": "<url do seu webhook>" } — HTTPS obrigatório, HTTP é rejeitado.
//       Resposta 200: { "error": false, "message": "Webhook de mensagens recebidas atualizado." }
//     Essa resposta 200 confirma SÓ que o cadastro da URL foi salvo — ela
//     NÃO é, e nunca deve ser confundida com, um evento de mensagem
//     recebida chegando nesse webhook.
//   - Inconsistência na própria doc, registrada aqui sem tentar resolvê-la:
//     a URL do cabeçalho leva `?instanceId=...` na query, mas o snippet de
//     exemplo fornecido por Márcio omite esse parâmetro.
//   - O exemplo da doc usa webhook.site (destino de teste de terceiros) —
//     isso é só ilustrativo; nunca deve ser usado como destino real.
//   - Isto NÃO resolve a lacuna nº1 (autenticidade de webhook): o Bearer
//     token acima autentica a CHAMADA DE CONFIGURAÇÃO (dono da conta →
//     W-API), não a ENTREGA do evento (W-API → nosso endpoint). Ainda não
//     sabemos se/como essa segunda chamada é assinada ou autenticável.
//   - Lacuna mais prioritária agora: um exemplo do BODY e dos HEADERS que o
//     W-API efetivamente envia no POST de "mensagem recebida" para a URL
//     configurada. Esse exemplo ainda não foi fornecido. Não sei o título
//     exato dessa seção na documentação (prováveis candidatos, sem
//     garantia: algo como "Payload do Webhook", "Estrutura do evento
//     recebido" ou um exemplo de corpo dentro da própria seção "Ao
//     receber") — peça a Márcio a íntegra dessa parte específica, com um
//     JSON de exemplo do que chega no seu endpoint quando uma mensagem é
//     recebida.
//
// Nenhum destes tipos deve virar código de integração real sem, antes,
// confirmar cada um dos 6 pontos contra a documentação real do provedor.
// =============================================================================

export type TipoMidiaSimulada = 'texto' | 'audio' | 'foto' | 'documento';

/** Evento de mensagem de grupo — formato HIPOTÉTICO, não confirmado. */
export interface EventoGrupoSimulado {
  /** ID da mensagem como o provedor hipoteticamente o entregaria. Pode se repetir (replay) ou faltar. */
  idMensagem: string;
  /** ID do grupo de origem (sempre fictício neste piloto). */
  idGrupo: string;
  nomeGrupoFicticio: string;
  /** Identificador do autor, quando o payload hipotético o trouxer. Ausente = triagem manual obrigatória. */
  autor?: string;
  tipo: TipoMidiaSimulada;
  /** Texto da mensagem, ou legenda, quando houver. */
  texto?: string;
  /** Referência de mídia — NUNCA uma URL real; só um identificador de fixture. */
  midia?: { tipo: 'audio' | 'foto' | 'documento'; refExterna: string };
  /** Timestamp declarado pelo evento — não necessariamente em ordem de chegada. */
  timestampDeclarado: string; // ISO 8601
  /** Simula se o adaptador (não escrito) teria validado a autenticidade do webhook. Fixture apenas. */
  autenticidadeVerificada: boolean;
}

export type StatusRascunho = 'pendente_triagem' | 'sem_autor_identificado';

/** Rascunho de OS gerado a partir de um evento — nunca uma OS "oficial": o gestor decide responsável e prazo no portal. */
export interface RascunhoOS {
  idMensagem: string;
  idGrupo: string;
  nomeGrupoFicticio: string;
  autor?: string;
  tipo: TipoMidiaSimulada;
  texto?: string;
  midiaRef?: string;
  timestampDeclarado: string;
  status: StatusRascunho;
}
