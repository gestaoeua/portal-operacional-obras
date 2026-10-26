const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { processarEntregaWebhook } = require('../integration/kapso/webhook.cjs');
const { criarMemoryStore } = require('../integration/kapso/memory-store.cjs');

const SECRET = 'segredo-fixture-nao-real';
const CONFIG = {
  webhookSecret: SECRET,
  vinculosPermitidos: [
    { phoneNumberId: 'pn-ficticio-a', senderField: 'from', senderValue: '+10000000000', projetoId: 'proj-ficticio-a' },
  ],
};

function assinar(bodyBuffer, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex');
}

function entregar(body) {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  return { headers: { 'X-Webhook-Signature': assinar(rawBody), 'X-Webhook-Event': 'whatsapp.message.received' }, rawBody };
}

function mensagem(id) {
  return {
    phone_number_id: 'pn-ficticio-a',
    conversation: { id: 'conv-ficticio-1' },
    message: {
      id,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      from: '+10000000000',
      text: { body: `Mensagem fictícia ${id}` },
      kapso: { direction: 'inbound', origin: 'cloud_api' },
    },
  };
}

test('memory-store é claramente um fixture: perde conteúdo se recriado (nunca confundir com armazenamento real)', () => {
  const store1 = criarMemoryStore();
  store1.listarRascunhos(); // só confirma que a API existe antes de "reiniciar"
  const store2 = criarMemoryStore();
  assert.deepEqual(store2.listarRascunhos(), []);
});

test('falha simulada de armazenamento: a entrega inteira falha, nada é confirmado antes de persistir', async () => {
  const store = criarMemoryStore();
  store.simularFalha(1);
  const resultado = await processarEntregaWebhook(entregar(mensagem('wamid.FALHA-1')), CONFIG, store);
  assert.equal(resultado.status, 'falha_armazenamento');
  assert.equal(store.listarRascunhos().length, 0);
});

test('depois de uma falha simulada, repetir a MESMA entrega persiste normalmente (retry simples se recupera)', async () => {
  const store = criarMemoryStore();
  store.simularFalha(1);
  const entrega = entregar(mensagem('wamid.RETRY-1'));
  const primeira = await processarEntregaWebhook(entrega, CONFIG, store);
  assert.equal(primeira.status, 'falha_armazenamento');
  assert.equal(store.listarRascunhos().length, 0);

  const segunda = await processarEntregaWebhook(entrega, CONFIG, store);
  assert.equal(segunda.status, 'ok');
  assert.equal(store.listarRascunhos().length, 1);
  assert.equal(store.listarRascunhos()[0].mensagemId, 'wamid.RETRY-1');
});

test('lote com falha de armazenamento no meio: itens já persistidos antes da falha permanecem; reentregar o LOTE INTEIRO não perde nem duplica nada', async () => {
  const store = criarMemoryStore();
  const lote = {
    type: 'whatsapp.message.received',
    batch: true,
    data: [mensagem('wamid.LOTE-A'), mensagem('wamid.LOTE-B'), mensagem('wamid.LOTE-C')],
  };
  const entrega = entregar(lote);

  // Falha simulada só na 2ª gravação deste lote: LOTE-A já deve ter sido persistido antes da falha.
  store.simularFalha(0); // garante estado conhecido
  let chamadas = 0;
  const storeComFalhaNoMeio = {
    ...store,
    async enqueueRascunho(...args) {
      chamadas += 1;
      if (chamadas === 2) throw new Error('falha simulada de armazenamento (fixture) no segundo item do lote');
      return store.enqueueRascunho(...args);
    },
  };

  const primeiraTentativa = await processarEntregaWebhook(entrega, CONFIG, storeComFalhaNoMeio);
  assert.equal(primeiraTentativa.status, 'falha_armazenamento');
  // LOTE-A (processado antes da falha) já está persistido; LOTE-B e LOTE-C ainda não.
  assert.equal(store.listarRascunhos().length, 1);
  assert.equal(store.listarRascunhos()[0].mensagemId, 'wamid.LOTE-A');

  // O Kapso reentrega o LOTE INTEIRO (comportamento real documentado em /advanced): repetir a mesma
  // entrega, agora sem falha, precisa persistir só o que faltou — nunca duplicar LOTE-A.
  const segundaTentativa = await processarEntregaWebhook(entrega, CONFIG, store);
  assert.equal(segundaTentativa.status, 'ok');
  const ids = store.listarRascunhos().map((r) => r.mensagemId).sort();
  assert.deepEqual(ids, ['wamid.LOTE-A', 'wamid.LOTE-B', 'wamid.LOTE-C']);
  assert.equal(store.listarRascunhos().length, 3);
});

test('reentregar a mesma mensagem já persistida com sucesso nunca cria uma segunda cópia', async () => {
  const store = criarMemoryStore();
  const entrega = entregar(mensagem('wamid.IDEMPOTENTE-1'));
  await processarEntregaWebhook(entrega, CONFIG, store);
  await processarEntregaWebhook(entrega, CONFIG, store);
  await processarEntregaWebhook(entrega, CONFIG, store);
  assert.equal(store.listarRascunhos().length, 1);
});
