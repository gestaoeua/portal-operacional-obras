'use strict';
/**
 * Adaptador OFFLINE de recebimento de webhooks do Kapso (WhatsApp).
 *
 * Baseado só no que está documentado hoje em:
 *   - https://docs.kapso.ai/docs/platform/webhooks/security
 *   - https://docs.kapso.ai/docs/platform/webhooks/message-events
 *   - https://docs.kapso.ai/docs/platform/webhooks/advanced
 *
 * Isto é só o receptor/validador/montador de rascunho — não conecta
 * nenhuma conta Kapso de verdade, não cria chave de API, OAuth nem
 * assinatura de webhook, não envia mensagem nenhuma, não publica nem
 * compra nada. Para operar de verdade, o host PRECISA fornecer a
 * configuração e o armazenamento durável — sem isso, este módulo se
 * recusa a processar (ver `validarConfig`).
 *
 * Lacunas conhecidas e deliberadas (a documentação lida não cobre isto):
 *   - Sem timestamp de entrega ASSINADO. `message.timestamp` é quando a
 *     mensagem foi originada no WhatsApp, nunca tratado como hora de
 *     entrega do webhook. A defesa primária contra reentrega é o dedup
 *     determinístico (phone_number_id+message.id+hash do conteúdo).
 *     `maxMessageAgeSeconds` (opcional) e o limite de futuro implausível
 *     (`maxFutureSkewSeconds`, sempre ativo com padrão conservador) são
 *     heurísticas de plausibilidade, documentadas aqui como NÃO sendo
 *     garantias criptográficas contra replay.
 *   - `X-Idempotency-Key` não é usado como identidade de dedup — a doc
 *     não afirma se está coberto pela assinatura.
 *   - Sem mapeamento documentado phone_number_id → conta/projeto, e sem
 *     indicação de qual campo identifica o remetente de forma
 *     confiável — por isso a identificação de projeto exige um vínculo
 *     EXPLÍCITO (phoneNumberId + campo do remetente + valor do
 *     remetente), nunca inferido por convenção de nome de campo.
 *   - `from`/`phone_number`/`to`/`wa_id` não são garantidos presentes.
 */
const crypto = require('node:crypto');
const { isValidSignature } = require('./signature.cjs');

const EVENTO_MENSAGEM_RECEBIDA = 'whatsapp.message.received';
/** Únicos campos de remetente que este adaptador aceita configurar — nunca descobertos por heurística de nome. */
const CAMPOS_REMETENTE_VALIDOS = new Set(['from', 'from_user_id']);
/** Únicas origens que podem virar rascunho — tudo fora disto (incluindo ausente) vai para quarentena. */
const ORIGENS_PERMITIDAS_PARA_RASCUNHO = new Set(['cloud_api', 'business_app']);

const DEFAULT_MAX_BODY_BYTES = 262144; // 256 KiB — restritivo de propósito; o host aumenta explicitamente se precisar.
const DEFAULT_MAX_BATCH_SIZE = 50; // mesmo teto padrão documentado para buffering no painel do Kapso.
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 86400; // 1 dia — "absurdamente distante no futuro", não uma prova de hora de entrega.

function lerHeader(headers, nome) {
  if (!headers) return undefined;
  const chave = Object.keys(headers).find((k) => k.toLowerCase() === nome.toLowerCase());
  return chave === undefined ? undefined : headers[chave];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Nenhum valor de configuração aqui tem um padrão "de teste" que
 * funcione sozinho para o que é inerentemente sensível (segredo,
 * vínculos de remetente). Ausência de qualquer um destes é um bloqueio
 * explícito, nunca contornado com um valor fictício.
 */
function validarConfig(config) {
  const erros = [];
  if (!config || typeof config !== 'object') return { ok: false, erros: ['config ausente.'] };

  if (typeof config.webhookSecret !== 'string' || !config.webhookSecret) {
    erros.push('config.webhookSecret ausente — obrigatório para verificar X-Webhook-Signature.');
  }

  if (!Array.isArray(config.vinculosPermitidos) || config.vinculosPermitidos.length === 0) {
    erros.push(
      'config.vinculosPermitidos ausente ou vazio — cada vínculo explícito {phoneNumberId, senderField, senderValue, projetoId} é obrigatório; este adaptador nunca infere projeto nem remetente permitido a partir da mensagem.',
    );
  } else {
    const vistos = new Map();
    for (const [i, v] of config.vinculosPermitidos.entries()) {
      if (
        !v ||
        typeof v !== 'object' ||
        !isNonEmptyString(v.phoneNumberId) ||
        !isNonEmptyString(v.senderValue) ||
        !isNonEmptyString(v.projetoId) ||
        !CAMPOS_REMETENTE_VALIDOS.has(v.senderField)
      ) {
        erros.push(
          `config.vinculosPermitidos[${i}] inválido — precisa de phoneNumberId, senderValue, projetoId (strings não vazias) e senderField em ${JSON.stringify([...CAMPOS_REMETENTE_VALIDOS])}.`,
        );
        continue;
      }
      const chave = `${v.phoneNumberId}::${v.senderField}::${v.senderValue}`;
      if (vistos.has(chave) && vistos.get(chave) !== v.projetoId) {
        erros.push(`config.vinculosPermitidos tem o mesmo phoneNumberId+senderField+senderValue apontando para projetos diferentes (${chave}).`);
      }
      vistos.set(chave, v.projetoId);
    }
  }

  if (config.maxMessageAgeSeconds !== undefined && !(typeof config.maxMessageAgeSeconds === 'number' && Number.isFinite(config.maxMessageAgeSeconds) && config.maxMessageAgeSeconds > 0)) {
    erros.push('config.maxMessageAgeSeconds, quando definido, precisa ser um número positivo de segundos.');
  }
  if (config.maxFutureSkewSeconds !== undefined && !(typeof config.maxFutureSkewSeconds === 'number' && Number.isFinite(config.maxFutureSkewSeconds) && config.maxFutureSkewSeconds > 0)) {
    erros.push('config.maxFutureSkewSeconds, quando definido, precisa ser um número positivo de segundos.');
  }
  if (config.maxBodyBytes !== undefined && !isPositiveInteger(config.maxBodyBytes)) {
    erros.push('config.maxBodyBytes, quando definido, precisa ser um inteiro positivo.');
  }
  if (config.maxBatchSize !== undefined && !isPositiveInteger(config.maxBatchSize)) {
    erros.push('config.maxBatchSize, quando definido, precisa ser um inteiro positivo.');
  }

  return { ok: erros.length === 0, erros };
}

function normalizarEntrega(body) {
  if (!body || typeof body !== 'object') return { ok: false };
  if (body.batch === true) {
    if (!Array.isArray(body.data)) return { ok: false };
    return { ok: true, itens: body.data, tipoDoLote: body.type, ehLote: true };
  }
  if (body.message && typeof body.message === 'object' && isNonEmptyString(body.phone_number_id)) {
    return { ok: true, itens: [body], tipoDoLote: undefined, ehLote: false };
  }
  return { ok: false };
}

/** Valida a forma mínima de UM item de mensagem. Nunca aceita um item incompleto "completando" o que falta. Timestamp precisa ser epoch inteiro não negativo — nunca decimal, negativo ou não numérico. */
function validarItem(item) {
  if (!item || typeof item !== 'object') return { ok: false, motivo: 'item_formato' };
  if (!isNonEmptyString(item.phone_number_id)) return { ok: false, motivo: 'phone_number_id_ausente' };
  const msg = item.message;
  if (!msg || typeof msg !== 'object') return { ok: false, motivo: 'message_ausente' };
  if (!isNonEmptyString(msg.id)) return { ok: false, motivo: 'message_id_ausente' };
  if (typeof msg.timestamp !== 'string' || !/^\d+$/.test(msg.timestamp)) {
    return { ok: false, motivo: 'timestamp_invalido' };
  }
  if (!isNonEmptyString(msg.type)) return { ok: false, motivo: 'tipo_ausente' };
  if (!msg.kapso || typeof msg.kapso !== 'object' || !isNonEmptyString(msg.kapso.direction)) {
    return { ok: false, motivo: 'kapso_direction_ausente' };
  }
  return { ok: true };
}

/**
 * Classifica o item: "ignorar" (reconhecido, benigno, nunca vira
 * rascunho nem quarentena — ack normal), "quarentena" (suspeito/fora da
 * whitelist, precisa de revisão humana) ou "seguir" (candidato a
 * rascunho, segue para a checagem de remetente/projeto).
 */
function classificarItem(item) {
  const k = item.message.kapso;
  if (k.origin === 'history_sync') return { acao: 'ignorar', motivo: 'history_sync' };
  if (k.direction !== 'inbound') return { acao: 'ignorar', motivo: `direcao_${k.direction || 'desconhecida'}` };
  if (k.passive === true) return { acao: 'ignorar', motivo: 'numero_passivo' };
  // Whitelist de origem: ausente ou qualquer valor fora de
  // cloud_api/business_app nunca se torna rascunho — vai para
  // quarentena (nunca "ignorado em silêncio", porque uma origem fora do
  // esperado é um sinal de atenção, não um caso benigno conhecido).
  if (!ORIGENS_PERMITIDAS_PARA_RASCUNHO.has(k.origin)) return { acao: 'quarentena', motivo: 'origin_nao_permitida' };
  return { acao: 'seguir' };
}

/** Resolve o projeto só por vínculo(s) EXPLÍCITO(s) phoneNumberId+senderField+senderValue.
 * Coleta TODAS as correspondências antes de decidir — nunca para na primeira — porque
 * uma mensagem pode trazer `from` e `from_user_id` juntos, cada um batendo um vínculo
 * diferente. Se as correspondências encontradas não concordam no mesmo projetoId, a
 * identificação é ambígua e nunca escolhe uma por ordem de declaração: vai para
 * quarentena. Sem nenhuma correspondência (remetente ausente, desconhecido, ou phone
 * sem esse remetente cadastrado) = sem projeto, nunca um palpite. */
function resolverVinculo(item, vinculosPermitidos) {
  const msg = item.message;
  const projetosEncontrados = new Set();
  let primeiraCorrespondencia = null;
  for (const v of vinculosPermitidos) {
    if (v.phoneNumberId !== item.phone_number_id) continue;
    const valorRemetente = msg[v.senderField];
    if (typeof valorRemetente === 'string' && valorRemetente === v.senderValue) {
      projetosEncontrados.add(v.projetoId);
      if (!primeiraCorrespondencia) primeiraCorrespondencia = { projetoId: v.projetoId, senderField: v.senderField, senderValue: v.senderValue };
    }
  }
  if (projetosEncontrados.size === 0) return { ok: false, motivo: 'remetente_nao_permitido' };
  if (projetosEncontrados.size > 1) return { ok: false, motivo: 'vinculo_ambiguo' };
  return {
    ok: true,
    projetoId: primeiraCorrespondencia.projetoId,
    senderField: primeiraCorrespondencia.senderField,
    senderValue: primeiraCorrespondencia.senderValue,
  };
}

/** Ordena recursivamente as chaves de objetos (preserva ordem de arrays) antes de
 * serializar — assim o hash de conteúdo não muda com reordenação de propriedades
 * JSON equivalentes, o que seria uma forma barata de escapar do dedup por hash.
 * `resultado` usa Object.create(null) de propósito: um objeto `{}` comum trata a
 * atribuição `obj['__proto__'] = valor` como troca de protótipo (via o setter de
 * Object.prototype), nunca cria uma propriedade própria chamada "__proto__" — então
 * uma chave JSON literalmente chamada "__proto__" desapareceria do hash (bypass de
 * dedup/integridade) e ainda poluiria o protótipo do objeto intermediário. Sem
 * protótipo nenhum, a atribuição sempre cria uma propriedade própria normal. */
function canonicalizarJson(valor) {
  if (Array.isArray(valor)) return valor.map(canonicalizarJson);
  if (valor && typeof valor === 'object') {
    const chaves = Object.keys(valor).sort();
    const resultado = Object.create(null);
    for (const chave of chaves) resultado[chave] = canonicalizarJson(valor[chave]);
    return resultado;
  }
  return valor;
}

function hashConteudo(item) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalizarJson(item))).digest('hex');
}

/** Monta o rascunho para revisão humana. Nunca interpreta o texto — nunca extrai endereço, equipe ou horário por conta própria. */
function construirRascunho(item, vinculo) {
  const msg = item.message;
  const conversation = item.conversation && typeof item.conversation === 'object' ? item.conversation : null;
  const conversationId = conversation && isNonEmptyString(conversation.id) ? conversation.id : null;
  const ehTexto = msg.type === 'text';
  const textoBruto = ehTexto && msg.text && typeof msg.text.body === 'string' ? msg.text.body : null;

  const camposAusentes = [];
  if (!conversationId) camposAusentes.push('conversationId');
  if (ehTexto && textoBruto === null) camposAusentes.push('texto');

  return {
    dedupeKey: `${item.phone_number_id}::${msg.id}`,
    phoneNumberId: item.phone_number_id,
    projetoId: vinculo.projetoId,
    remetenteCampo: vinculo.senderField,
    remetente: vinculo.senderValue,
    conversationId,
    mensagemId: msg.id,
    tipoMensagem: msg.type,
    textoBruto,
    timestampMensagemOrigem: msg.timestamp,
    camposAusentes,
    status: 'aguardando_revisao_humana',
    criadoEm: new Date().toISOString(),
  };
}

/** Tenta uma operação de armazenamento; nunca deixa uma rejeição escapar sem resultado estruturado. */
async function tentarStore(op) {
  try {
    const valor = await op();
    return { ok: true, valor };
  } catch {
    return { ok: false };
  }
}

/**
 * Processa uma entrega de webhook já recebida pelo transporte HTTP do
 * host. `headers` é {nome: valor}; `rawBody` precisa ser o Buffer dos
 * bytes originais — a assinatura é verificada sobre eles antes de
 * `JSON.parse`. `X-Webhook-Event` é OBRIGATÓRIO: sem ele, a entrega é
 * rejeitada (nunca processada "pela forma do corpo").
 *
 * Status possíveis: 'bloqueado_configuracao', 'payload_excede_limite',
 * 'assinatura_invalida', 'evento_ausente', 'payload_invalido',
 * 'ignorado', 'falha_armazenamento', 'ok'. Só 'ok'/'ignorado' devem
 * virar 200 — todo o resto exige que o host nunca confirme ao Kapso.
 */
async function processarEntregaWebhook({ headers, rawBody }, config, store) {
  const configValidada = validarConfig(config);
  if (!configValidada.ok) return { status: 'bloqueado_configuracao', erros: configValidada.erros };
  if (!store || typeof store.enqueueRascunho !== 'function' || typeof store.quarentenar !== 'function') {
    return { status: 'bloqueado_configuracao', erros: ['store ausente ou não implementa enqueueRascunho/quarentenar.'] };
  }
  if (!Buffer.isBuffer(rawBody)) return { status: 'payload_invalido' };

  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (rawBody.length > maxBodyBytes) return { status: 'payload_excede_limite', motivo: 'corpo_excede_limite' };

  const assinatura = lerHeader(headers, 'x-webhook-signature');
  if (!isValidSignature(rawBody, assinatura, config.webhookSecret)) return { status: 'assinatura_invalida' };

  const eventoHeader = lerHeader(headers, 'x-webhook-event');
  if (eventoHeader === undefined) return { status: 'evento_ausente' };

  if (eventoHeader !== EVENTO_MENSAGEM_RECEBIDA) {
    // Outro tipo de evento (status de entrega, conversa, contato, standby de thread, etc.) — reconhecido e ignorado, nunca um erro.
    return { status: 'ignorado', motivo: `evento_nao_processado:${eventoHeader}` };
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 'payload_invalido' };
  }

  const normalizado = normalizarEntrega(body);
  if (!normalizado.ok) return { status: 'payload_invalido' };
  // O header afirmou "mensagem recebida"; um lote PRECISA declarar seu
  // próprio `type` IGUAL ao header — ausente ou discordante é uma
  // inconsistência que não se resolve escolhendo um dos dois, e a
  // entrega inteira é inválida (só se aplica a corpos de lote; uma
  // entrega de mensagem única não tem `type` próprio para comparar).
  if (normalizado.ehLote && normalizado.tipoDoLote !== eventoHeader) {
    return { status: 'payload_invalido', motivo: 'evento_lote_incompatível' };
  }

  const maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  if (normalizado.itens.length > maxBatchSize) return { status: 'payload_excede_limite', motivo: 'lote_excede_limite' };

  const maxFutureSkewSeconds = config.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS;
  const resultadosItens = [];

  for (const item of normalizado.itens) {
    const validacao = validarItem(item);
    if (!validacao.ok) {
      const q = await tentarStore(() => store.quarentenar('item_malformado', { motivo: validacao.motivo }));
      if (!q.ok) return { status: 'falha_armazenamento', processadosAntesDaFalha: resultadosItens };
      resultadosItens.push({ ok: false, motivo: validacao.motivo });
      continue;
    }

    const classificacao = classificarItem(item);
    if (classificacao.acao === 'ignorar') {
      resultadosItens.push({ ok: true, ignorado: true, motivo: classificacao.motivo });
      continue;
    }
    if (classificacao.acao === 'quarentena') {
      const q = await tentarStore(() => store.quarentenar(classificacao.motivo, { phoneNumberId: item.phone_number_id, mensagemId: item.message.id }));
      if (!q.ok) return { status: 'falha_armazenamento', processadosAntesDaFalha: resultadosItens };
      resultadosItens.push({ ok: false, motivo: classificacao.motivo });
      continue;
    }

    const tsSegundos = Number(item.message.timestamp);
    if (tsSegundos - Date.now() / 1000 > maxFutureSkewSeconds) {
      // Política de plausibilidade explícita — NUNCA uma prova de hora
      // de entrega: só recusa o absurdamente distante no futuro.
      const q = await tentarStore(() => store.quarentenar('timestamp_futuro_implausivel', { phoneNumberId: item.phone_number_id, mensagemId: item.message.id }));
      if (!q.ok) return { status: 'falha_armazenamento', processadosAntesDaFalha: resultadosItens };
      resultadosItens.push({ ok: false, motivo: 'timestamp_futuro_implausivel' });
      continue;
    }
    if (config.maxMessageAgeSeconds !== undefined) {
      const idadeSegundos = Date.now() / 1000 - tsSegundos;
      if (idadeSegundos > config.maxMessageAgeSeconds) {
        const q = await tentarStore(() => store.quarentenar('mensagem_mais_velha_que_o_limite_configurado', { phoneNumberId: item.phone_number_id, mensagemId: item.message.id }));
        if (!q.ok) return { status: 'falha_armazenamento', processadosAntesDaFalha: resultadosItens };
        resultadosItens.push({ ok: false, motivo: 'mensagem_muito_antiga' });
        continue;
      }
    }

    const vinculo = resolverVinculo(item, config.vinculosPermitidos);
    if (!vinculo.ok) {
      // Remetente ausente, desconhecido, phone sem esse remetente
      // cadastrado, OU vínculos que bateram mas discordam de projeto
      // (ambíguo): NUNCA vira rascunho — sempre quarentena.
      const q = await tentarStore(() => store.quarentenar(vinculo.motivo, { phoneNumberId: item.phone_number_id, mensagemId: item.message.id }));
      if (!q.ok) return { status: 'falha_armazenamento', processadosAntesDaFalha: resultadosItens };
      resultadosItens.push({ ok: false, motivo: vinculo.motivo });
      continue;
    }

    const rascunho = construirRascunho(item, vinculo);
    const gravado = await tentarStore(() => store.enqueueRascunho(rascunho.dedupeKey, rascunho, hashConteudo(item)));
    if (!gravado.ok) {
      // Falha de armazenamento: este item NUNCA é confirmado. A entrega
      // inteira falha aqui; itens já persistidos nesta mesma chamada
      // permanecem persistidos, e uma nova tentativa reenvia o lote
      // inteiro — o dedup garante que só o que faltou é persistido de
      // novo, nada se perde nem duplica.
      return { status: 'falha_armazenamento', processadosAntesDaFalha: resultadosItens };
    }
    resultadosItens.push({ ok: true, novo: gravado.valor.novo, dedupeKey: rascunho.dedupeKey });
  }

  return { status: 'ok', itens: resultadosItens };
}

module.exports = {
  EVENTO_MENSAGEM_RECEBIDA,
  CAMPOS_REMETENTE_VALIDOS,
  ORIGENS_PERMITIDAS_PARA_RASCUNHO,
  validarConfig,
  normalizarEntrega,
  validarItem,
  classificarItem,
  resolverVinculo,
  hashConteudo,
  construirRascunho,
  processarEntregaWebhook,
};
