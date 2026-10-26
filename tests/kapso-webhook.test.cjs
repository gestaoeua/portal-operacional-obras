const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { processarEntregaWebhook, hashConteudo } = require('../integration/kapso/webhook.cjs');
const { criarMemoryStore } = require('../integration/kapso/memory-store.cjs');

const SECRET = 'segredo-fixture-nao-real';
const PROJ_A = 'proj-ficticio-a';
const PROJ_B = 'proj-ficticio-b';
const CONFIG = {
  webhookSecret: SECRET,
  vinculosPermitidos: [
    { phoneNumberId: 'pn-ficticio-a', senderField: 'from', senderValue: '+10000000000', projetoId: PROJ_A },
    { phoneNumberId: 'pn-ficticio-b', senderField: 'from', senderValue: '+10000000000', projetoId: PROJ_B },
  ],
};

function assinar(bodyBuffer, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex');
}

function entregar(body, { headers = {}, secret = SECRET } = {}) {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const assinatura = assinar(rawBody, secret);
  return { headers: { 'X-Webhook-Signature': assinatura, 'X-Webhook-Event': 'whatsapp.message.received', ...headers }, rawBody };
}

function mensagemRecebida(partial = {}) {
  // Desestrutura message/conversation à parte: um spread de `...partial`
  // no nível de cima, depois de já ter montado `message`, substituiria o
  // objeto message inteiro (perdendo os defaults) em vez de mesclar —
  // por isso cada parte é mesclada no seu próprio nível.
  const { message: messageOverride, conversation: conversationOverride, ...resto } = partial;
  const temConversationOverride = Object.prototype.hasOwnProperty.call(partial, 'conversation');
  return {
    phone_number_id: 'pn-ficticio-a',
    is_new_conversation: false,
    conversation: temConversationOverride ? conversationOverride : { id: 'conv-ficticio-1' },
    message: {
      id: 'wamid.FICTICIO-1',
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      from: '+10000000000',
      text: { body: 'Olá, preciso de um orçamento para a cozinha.' },
      kapso: { direction: 'inbound', origin: 'cloud_api' },
      ...messageOverride,
    },
    ...resto,
  };
}

test('mensagem recebida válida: assinatura ok, vira rascunho "aguardando_revisao_humana" com texto bruto', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida());
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ok');
  assert.equal(resultado.itens.length, 1);
  assert.equal(resultado.itens[0].novo, true);
  const [rascunho] = store.listarRascunhos();
  assert.equal(rascunho.status, 'aguardando_revisao_humana');
  assert.equal(rascunho.textoBruto, 'Olá, preciso de um orçamento para a cozinha.');
  assert.equal(rascunho.projetoId, PROJ_A);
  assert.equal(rascunho.phoneNumberId, 'pn-ficticio-a');
  assert.equal(store.listarQuarentena().length, 0);
});

test('assinatura ausente: rejeitado antes de qualquer tentativa de JSON.parse ou gravação', async () => {
  const store = criarMemoryStore();
  const rawBody = Buffer.from(JSON.stringify(mensagemRecebida()), 'utf8');
  const resultado = await processarEntregaWebhook(
    { headers: { 'X-Webhook-Event': 'whatsapp.message.received' }, rawBody },
    CONFIG,
    store,
  );
  assert.equal(resultado.status, 'assinatura_invalida');
  assert.equal(store.listarRascunhos().length, 0);
});

test('corpo alterado depois de assinado: assinatura não bate, rejeitado', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida());
  const rawBodyAlterado = Buffer.from(rawBody.toString('utf8').replace('cozinha', 'banheiro'), 'utf8');
  const resultado = await processarEntregaWebhook({ headers, rawBody: rawBodyAlterado }, CONFIG, store);
  assert.equal(resultado.status, 'assinatura_invalida');
  assert.equal(store.listarRascunhos().length, 0);
});

test('payload com JSON inválido (depois de uma assinatura válida sobre esses mesmos bytes): rejeitado, nunca processado como mensagem', async () => {
  const store = criarMemoryStore();
  const rawBody = Buffer.from('{ isto não é json válido', 'utf8');
  const assinatura = assinar(rawBody);
  const resultado = await processarEntregaWebhook(
    { headers: { 'X-Webhook-Signature': assinatura, 'X-Webhook-Event': 'whatsapp.message.received' }, rawBody },
    CONFIG,
    store,
  );
  assert.equal(resultado.status, 'payload_invalido');
  assert.equal(store.listarRascunhos().length, 0);
});

test('payload com forma inesperada (não é entrega única nem lote), mas o header prometia mensagem recebida: inválido', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar({ isto: 'não tem message nem batch' });
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'payload_invalido');
});

test('evento que não é whatsapp.message.received (ex.: status de entrega) é ignorado, nunca um erro, nunca gravado', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida(), { headers: { 'X-Webhook-Event': 'whatsapp.message.delivered' } });
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ignorado');
  assert.equal(resultado.motivo, 'evento_nao_processado:whatsapp.message.delivered');
  assert.equal(store.listarRascunhos().length, 0);
});

test('thread.standby é reconhecido e ignorado, nunca tratado como mensagem', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida(), { headers: { 'X-Webhook-Event': 'whatsapp.thread.standby' } });
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ignorado');
  assert.equal(store.listarRascunhos().length, 0);
});

test('mensagem com origin "history_sync" é ignorada (backfill de histórico, não recebimento em tempo real)', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ message: { kapso: { direction: 'inbound', origin: 'history_sync' } } }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ok');
  assert.equal(resultado.itens[0].ignorado, true);
  assert.equal(resultado.itens[0].motivo, 'history_sync');
  assert.equal(store.listarRascunhos().length, 0);
});

test('mensagem outbound (enviada por nós, não recebida) é ignorada', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ message: { kapso: { direction: 'outbound', origin: 'cloud_api' } } }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.itens[0].ignorado, true);
  assert.equal(store.listarRascunhos().length, 0);
});

test('mensagem de número passivo (kapso.passive) é ignorada', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(
    mensagemRecebida({ message: { kapso: { direction: 'inbound', origin: 'cloud_api', passive: true } } }),
  );
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.itens[0].ignorado, true);
  assert.equal(resultado.itens[0].motivo, 'numero_passivo');
  assert.equal(store.listarRascunhos().length, 0);
});

test('lote (batch:true, data:[...], type igual ao header) processa cada item e persiste todos', async () => {
  const store = criarMemoryStore();
  const lote = {
    type: 'whatsapp.message.received',
    batch: true,
    data: [
      mensagemRecebida({ message: { id: 'wamid.LOTE-1' } }),
      mensagemRecebida({ message: { id: 'wamid.LOTE-2' } }),
      mensagemRecebida({ phone_number_id: 'pn-ficticio-b', message: { id: 'wamid.LOTE-3' } }),
    ],
    batch_info: { size: 3, window_ms: 5000, first_sequence: 1, last_sequence: 3, conversation_id: 'conv-ficticio-1' },
  };
  const { headers, rawBody } = entregar(lote);
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ok');
  assert.equal(resultado.itens.length, 3);
  assert.equal(store.listarRascunhos().length, 3);
  const projetos = store.listarRascunhos().map((r) => r.projetoId).sort();
  assert.deepEqual(projetos, [PROJ_A, PROJ_A, PROJ_B]);
});

test('lote com body.type explicitamente diferente do header X-Webhook-Event: entrega inteira inválida', async () => {
  const store = criarMemoryStore();
  const lote = { type: 'whatsapp.message.delivered', batch: true, data: [mensagemRecebida({ message: { id: 'wamid.LOTE-TYPE-DIFERENTE' } })] };
  const { headers, rawBody } = entregar(lote);
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'payload_invalido');
  assert.equal(resultado.motivo, 'evento_lote_incompatível');
  assert.equal(store.listarRascunhos().length, 0);
});

test('lote sem campo type: nunca processado como se concordasse com o header por padrão — inválido', async () => {
  const store = criarMemoryStore();
  const lote = { batch: true, data: [mensagemRecebida({ message: { id: 'wamid.LOTE-SEM-TYPE' } })] };
  const { headers, rawBody } = entregar(lote);
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'payload_invalido');
  assert.equal(resultado.motivo, 'evento_lote_incompatível');
  assert.equal(store.listarRascunhos().length, 0);
});

test('duplicata com X-Idempotency-Key diferente na segunda entrega ainda é deduplicada (nunca confia nesse header para identidade)', async () => {
  const store = criarMemoryStore();
  const msg = mensagemRecebida();
  const entrega1 = entregar(msg, { headers: { 'X-Idempotency-Key': 'idem-key-primeira-tentativa' } });
  const resultado1 = await processarEntregaWebhook(entrega1, CONFIG, store);
  assert.equal(resultado1.itens[0].novo, true);

  const entrega2 = entregar(msg, { headers: { 'X-Idempotency-Key': 'idem-key-TOTALMENTE-diferente' } });
  const resultado2 = await processarEntregaWebhook(entrega2, CONFIG, store);
  assert.equal(resultado2.status, 'ok');
  assert.equal(resultado2.itens[0].novo, false);
  assert.equal(store.listarRascunhos().length, 1);
});

test('hash de conteúdo é canonicalizado: mesma mensagem reentregue com ordem de propriedades diferente no JSON não gera falso conflito de dedup', async () => {
  const store = criarMemoryStore();
  const original = mensagemRecebida({ message: { id: 'wamid.ORDEM-1' } });
  const reordenada = JSON.parse(JSON.stringify(original));
  const invertida = {};
  for (const k of Object.keys(reordenada.message).reverse()) invertida[k] = reordenada.message[k];
  reordenada.message = invertida;

  const r1 = await processarEntregaWebhook(entregar(original), CONFIG, store);
  assert.equal(r1.itens[0].novo, true);

  const r2 = await processarEntregaWebhook(entregar(reordenada), CONFIG, store);
  assert.equal(r2.status, 'ok');
  assert.equal(r2.itens[0].novo, false);
  assert.equal(store.listarRascunhos().length, 1);
  assert.equal(store.listarQuarentena().length, 0, 'reordenação de chaves JSON nunca deve causar conflito_dedup_conteudo_diferente');
});

test('hashConteudo não trata a chave JSON "__proto__" como setter de protótipo: hash muda com o valor, nenhuma poluição de Object.prototype', () => {
  const baseJson = '{"phone_number_id":"pn-ficticio-a","message":{"id":"wamid.PROTO-1","__proto__":"valor-a"}}';
  const alteradoJson = '{"phone_number_id":"pn-ficticio-a","message":{"id":"wamid.PROTO-1","__proto__":"valor-b"}}';
  const itemBase = JSON.parse(baseJson);
  const itemAlterado = JSON.parse(alteradoJson);

  // JSON.parse não popula o protótipo real — a chave "__proto__" fica como
  // propriedade própria normal nestes objetos. O que este teste protege é
  // hashConteudo/canonicalizarJson: eles não podem perder essa chave nem
  // acabar escrevendo no Object.prototype de verdade ao reconstruir o objeto
  // canônico internamente.
  assert.equal(Object.prototype.hasOwnProperty.call(itemBase.message, '__proto__'), true);

  const hashBase = hashConteudo(itemBase);
  const hashAlterado = hashConteudo(itemAlterado);
  assert.notEqual(hashBase, hashAlterado, 'duas mensagens que só diferem no valor de uma chave "__proto__" precisam ter hashes diferentes');

  // Garantia direta de que nada poluiu o protótipo global durante o cálculo.
  assert.equal(Object.prototype.valorPoluidoFicticio, undefined);
  assert.deepEqual(Object.getPrototypeOf({}), Object.prototype);
});

test('phone_number_id desconhecido vai para quarentena, nunca se torna rascunho/OS', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ phone_number_id: 'pn-nao-cadastrado-em-config' }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ok');
  assert.equal(resultado.itens[0].ok, false);
  assert.equal(resultado.itens[0].motivo, 'remetente_nao_permitido');
  assert.equal(store.listarRascunhos().length, 0);
  const quarentena = store.listarQuarentena();
  assert.equal(quarentena.length, 1);
  assert.equal(quarentena[0].motivo, 'remetente_nao_permitido');
});

test('remetente ausente (nem from nem from_user_id presentes na mensagem): quarentena, nunca rascunho', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ message: { id: 'wamid.SEM-REMETENTE-2', from: undefined } }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.itens[0].ok, false);
  assert.equal(resultado.itens[0].motivo, 'remetente_nao_permitido');
  assert.equal(store.listarRascunhos().length, 0);
});

test('remetente desconhecido (valor presente, mas não cadastrado em nenhum vínculo): quarentena, nunca rascunho', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ message: { id: 'wamid.REMETENTE-DESCONHECIDO', from: 'alguem-nao-cadastrado' } }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.itens[0].motivo, 'remetente_nao_permitido');
  assert.equal(store.listarRascunhos().length, 0);
});

test('mesmo phone_number_id cadastrado, mas remetente desta mensagem não é o permitido para esse phone: quarentena, nunca rascunho', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ message: { id: 'wamid.REMETENTE-PROIBIDO', from: '+19999999999' } }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.itens[0].motivo, 'remetente_nao_permitido');
  assert.equal(store.listarRascunhos().length, 0);
  assert.equal(store.listarQuarentena()[0].motivo, 'remetente_nao_permitido');
});

test('vínculo ambíguo: from e from_user_id presentes juntos batendo vínculos de PROJETOS DIFERENTES — nunca escolhe o primeiro, vai para quarentena', async () => {
  const store = criarMemoryStore();
  const configAmbiguo = {
    webhookSecret: SECRET,
    vinculosPermitidos: [
      { phoneNumberId: 'pn-ficticio-ambiguo', senderField: 'from', senderValue: '+10000000000', projetoId: PROJ_A },
      { phoneNumberId: 'pn-ficticio-ambiguo', senderField: 'from_user_id', senderValue: 'user-ficticio-1', projetoId: PROJ_B },
    ],
  };
  const { headers, rawBody } = entregar(
    mensagemRecebida({
      phone_number_id: 'pn-ficticio-ambiguo',
      message: { id: 'wamid.AMBIGUO-1', from: '+10000000000', from_user_id: 'user-ficticio-1' },
    }),
  );
  const resultado = await processarEntregaWebhook({ headers, rawBody }, configAmbiguo, store);
  assert.equal(resultado.status, 'ok');
  assert.equal(resultado.itens[0].ok, false);
  assert.equal(resultado.itens[0].motivo, 'vinculo_ambiguo');
  assert.equal(store.listarRascunhos().length, 0);
  assert.equal(store.listarQuarentena().length, 1);
  assert.equal(store.listarQuarentena()[0].motivo, 'vinculo_ambiguo');
});

test('quarentena indisponível: store.quarentenar falhando produz falha_armazenamento estruturado, nunca uma rejeição sem tratamento', async () => {
  const store = criarMemoryStore();
  const storeQuarentenaIndisponivel = {
    ...store,
    async quarentenar() {
      throw new Error('falha simulada (fixture): quarentena indisponível agora');
    },
  };
  const { headers, rawBody } = entregar(mensagemRecebida({ phone_number_id: 'pn-nao-cadastrado-em-config' }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, storeQuarentenaIndisponivel);
  assert.equal(resultado.status, 'falha_armazenamento');
  assert.deepEqual(resultado.processadosAntesDaFalha, []);
  assert.equal(store.listarQuarentena().length, 0);
  assert.equal(store.listarRascunhos().length, 0);
});

test('X-Webhook-Event ausente: rejeitado explicitamente, nunca processado "pela forma" do corpo', async () => {
  const store = criarMemoryStore();
  const rawBody = Buffer.from(JSON.stringify(mensagemRecebida()), 'utf8');
  const assinatura = assinar(rawBody);
  const resultado = await processarEntregaWebhook({ headers: { 'X-Webhook-Signature': assinatura }, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'evento_ausente');
  assert.equal(store.listarRascunhos().length, 0);
});

test('origin ausente na mensagem: quarentena (nunca ignorado em silêncio, nunca rascunho)', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ message: { id: 'wamid.ORIGIN-AUSENTE', kapso: { direction: 'inbound' } } }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.itens[0].motivo, 'origin_nao_permitida');
  assert.equal(store.listarRascunhos().length, 0);
  assert.equal(store.listarQuarentena()[0].motivo, 'origin_nao_permitida');
});

test('origin reconhecida mas fora da whitelist (cloud_api/business_app): quarentena, nunca rascunho', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(
    mensagemRecebida({ message: { id: 'wamid.ORIGIN-FORA-WHITELIST', kapso: { direction: 'inbound', origin: 'origem-fictícia-nao-documentada' } } }),
  );
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.itens[0].motivo, 'origin_nao_permitida');
  assert.equal(store.listarRascunhos().length, 0);
});

test('isolamento entre projetos: phone_number_id diferentes nunca se misturam no mesmo rascunho/projeto', async () => {
  const store = criarMemoryStore();
  await processarEntregaWebhook(entregar(mensagemRecebida({ message: { id: 'wamid.ISO-A' } })), CONFIG, store);
  await processarEntregaWebhook(
    entregar(mensagemRecebida({ phone_number_id: 'pn-ficticio-b', message: { id: 'wamid.ISO-B' } })),
    CONFIG,
    store,
  );
  const rascunhos = store.listarRascunhos();
  const deA = rascunhos.find((r) => r.mensagemId === 'wamid.ISO-A');
  const deB = rascunhos.find((r) => r.mensagemId === 'wamid.ISO-B');
  assert.equal(deA.projetoId, PROJ_A);
  assert.equal(deB.projetoId, PROJ_B);
  assert.notEqual(deA.projetoId, deB.projetoId);
});

test('revisão humana: conversationId ausente fica explícito no rascunho; remetente vem do vínculo resolvido, nunca interpretado livre', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida({ message: { id: 'wamid.SEM-CONVERSATION' }, conversation: undefined }));
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ok');
  const [rascunho] = store.listarRascunhos();
  assert.equal(rascunho.conversationId, null);
  assert.deepEqual(rascunho.camposAusentes, ['conversationId']);
  assert.equal(rascunho.remetenteCampo, 'from');
  assert.equal(rascunho.remetente, '+10000000000');
  assert.equal(rascunho.status, 'aguardando_revisao_humana');
  // O texto fica bruto — nenhuma chave como "endereco"/"equipe"/"horario" é inventada.
  assert.deepEqual(
    Object.keys(rascunho).sort(),
    [
      'camposAusentes',
      'conversationId',
      'criadoEm',
      'dedupeKey',
      'mensagemId',
      'phoneNumberId',
      'projetoId',
      'remetente',
      'remetenteCampo',
      'status',
      'textoBruto',
      'timestampMensagemOrigem',
      'tipoMensagem',
    ],
  );
});

test('mensagem não textual (ex.: imagem) não tem "texto" listado como campo ausente — é esperado, não um defeito', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(
    mensagemRecebida({ message: { id: 'wamid.IMAGEM-1', type: 'image', text: undefined } }),
  );
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ok');
  const [rascunho] = store.listarRascunhos();
  assert.equal(rascunho.tipoMensagem, 'image');
  assert.equal(rascunho.textoBruto, null);
  assert.ok(!rascunho.camposAusentes.includes('texto'));
});

test('item malformado dentro de um lote vai para quarentena; os demais itens válidos do mesmo lote ainda são persistidos', async () => {
  const store = criarMemoryStore();
  const lote = {
    type: 'whatsapp.message.received',
    batch: true,
    data: [
      mensagemRecebida({ message: { id: 'wamid.VALIDO-1' } }),
      { phone_number_id: 'pn-ficticio-a', message: { id: 'wamid.SEM-TIMESTAMP', type: 'text' } },
    ],
  };
  const { headers, rawBody } = entregar(lote);
  const resultado = await processarEntregaWebhook({ headers, rawBody }, CONFIG, store);
  assert.equal(resultado.status, 'ok');
  assert.equal(store.listarRascunhos().length, 1);
  assert.equal(store.listarQuarentena().length, 1);
  assert.equal(store.listarQuarentena()[0].motivo, 'item_malformado');
});

test('sem configuração (secret ou vínculos ausentes), o adaptador se recusa a processar — nunca um valor fictício', async () => {
  const store = criarMemoryStore();
  const { headers, rawBody } = entregar(mensagemRecebida());
  const semSecret = await processarEntregaWebhook({ headers, rawBody }, { vinculosPermitidos: CONFIG.vinculosPermitidos }, store);
  assert.equal(semSecret.status, 'bloqueado_configuracao');
  const semVinculos = await processarEntregaWebhook({ headers, rawBody }, { webhookSecret: SECRET }, store);
  assert.equal(semVinculos.status, 'bloqueado_configuracao');
  assert.equal(store.listarRascunhos().length, 0);
});
