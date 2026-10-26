'use strict';
/**
 * Verificação de assinatura de webhook do Kapso — HMAC-SHA256 em hex,
 * sobre os BYTES ORIGINAIS do corpo, exatamente como documentado em
 * https://docs.kapso.ai/docs/platform/webhooks/security. Nunca sobre um
 * JSON re-serializado (reserializar pode mudar espaçamento/ordem de
 * chaves e invalidar uma assinatura legítima, ou — pior — mascarar uma
 * alteração real do corpo). Comparação em tempo constante; cabeçalho
 * ausente, malformado ou que não bate é SEMPRE inválido, nunca "aceito
 * por omissão".
 */
const crypto = require('node:crypto');

/**
 * @param {Buffer} rawBody bytes exatos recebidos na requisição (antes de qualquer JSON.parse).
 * @param {string|undefined} signatureHeader valor do header X-Webhook-Signature.
 * @param {string} secret segredo de assinatura deste webhook — configuração obrigatória do host; este módulo nunca tem um valor padrão.
 * @returns {boolean}
 */
function isValidSignature(rawBody, signatureHeader, secret) {
  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError('rawBody precisa ser um Buffer dos bytes originais recebidos (nunca uma string já decodificada/reformatada).');
  }
  if (typeof secret !== 'string' || !secret) {
    throw new TypeError('secret de assinatura ausente — bloqueio de configuração do host, não um valor com que este módulo deva seguir.');
  }
  if (typeof signatureHeader !== 'string' || !signatureHeader.trim()) return false;
  const esperado = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const recebido = signatureHeader.trim().toLowerCase();
  // Confere forma (hex) e tamanho ANTES de comparar byte a byte — nunca o
  // conteúdo nessa etapa, só para não passar um valor de tamanho diferente
  // para crypto.timingSafeEqual (que lança nesse caso em vez de retornar
  // false, o que por si só não vaza informação sobre o conteúdo).
  if (!/^[0-9a-f]+$/.test(recebido) || recebido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(recebido, 'hex'));
}

module.exports = { isValidSignature };
