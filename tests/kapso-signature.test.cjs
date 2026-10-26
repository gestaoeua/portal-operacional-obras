const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isValidSignature } = require('../integration/kapso/signature.cjs');

const SECRET = 'segredo-fixture-nao-real';

function assinar(bodyBuffer, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex');
}

test('aceita uma assinatura HMAC-SHA256 hex válida sobre os bytes originais', () => {
  const corpo = Buffer.from(JSON.stringify({ a: 1, b: 'texto fictício' }), 'utf8');
  const assinatura = assinar(corpo);
  assert.equal(isValidSignature(corpo, assinatura, SECRET), true);
});

test('rejeita quando o corpo foi alterado depois de assinado (mesma assinatura, corpo diferente)', () => {
  const corpoOriginal = Buffer.from(JSON.stringify({ a: 1 }), 'utf8');
  const assinatura = assinar(corpoOriginal);
  const corpoAlterado = Buffer.from(JSON.stringify({ a: 2 }), 'utf8');
  assert.equal(isValidSignature(corpoAlterado, assinatura, SECRET), false);
});

test('rejeita quando o header de assinatura está totalmente ausente', () => {
  const corpo = Buffer.from(JSON.stringify({ a: 1 }), 'utf8');
  assert.equal(isValidSignature(corpo, undefined, SECRET), false);
  assert.equal(isValidSignature(corpo, '', SECRET), false);
});

test('rejeita uma assinatura com o segredo errado', () => {
  const corpo = Buffer.from(JSON.stringify({ a: 1 }), 'utf8');
  const assinatura = assinar(corpo, 'outro-segredo');
  assert.equal(isValidSignature(corpo, assinatura, SECRET), false);
});

test('rejeita um header que não é hex válido, ou de tamanho diferente do esperado, sem lançar', () => {
  const corpo = Buffer.from(JSON.stringify({ a: 1 }), 'utf8');
  assert.equal(isValidSignature(corpo, 'não-é-hex', SECRET), false);
  assert.equal(isValidSignature(corpo, 'ab', SECRET), false);
  assert.equal(isValidSignature(corpo, 'a'.repeat(1000), SECRET), false);
});

test('exige rawBody como Buffer (nunca aceita string já decodificada/reformatada) e secret presente', () => {
  assert.throws(() => isValidSignature('{"a":1}', 'qualquer', SECRET), TypeError);
  const corpo = Buffer.from('{"a":1}', 'utf8');
  assert.throws(() => isValidSignature(corpo, 'qualquer', ''), TypeError);
  assert.throws(() => isValidSignature(corpo, 'qualquer', undefined), TypeError);
});

test('comparação é insensível a maiúsculas/minúsculas no hex recebido', () => {
  const corpo = Buffer.from(JSON.stringify({ a: 1 }), 'utf8');
  const assinatura = assinar(corpo);
  assert.equal(isValidSignature(corpo, assinatura.toUpperCase(), SECRET), true);
});
