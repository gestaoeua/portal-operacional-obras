import { describe, expect, it } from 'vitest';
import { validarPayloadBruto } from '../validarPayloadBruto';
import { PAYLOAD_INVALIDO_SEM_MESSAGE_ID_FICTICIO, PAYLOAD_TEXTO_PRIVADO_FICTICIO } from '../fixturesWebhookRecebido';

describe('validarPayloadBruto — só confirma forma, nunca autenticidade nem grupo/mídia', () => {
  it('aceita um envelope bem formado', () => {
    expect(validarPayloadBruto(PAYLOAD_TEXTO_PRIVADO_FICTICIO).ok).toBe(true);
  });

  it('rejeita quando falta um campo string obrigatório', () => {
    const r = validarPayloadBruto(PAYLOAD_INVALIDO_SEM_MESSAGE_ID_FICTICIO);
    expect(r.ok).toBe(false);
  });

  it('rejeita quando isGroup não é booleano', () => {
    const r = validarPayloadBruto({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, isGroup: 'false' });
    expect(r.ok).toBe(false);
  });

  it('rejeita quando moment não é número', () => {
    const r = validarPayloadBruto({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, moment: '1700000001' });
    expect(r.ok).toBe(false);
  });

  it('rejeita quando sender.id está ausente', () => {
    const r = validarPayloadBruto({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, sender: {} });
    expect(r.ok).toBe(false);
  });

  it('não exige msgContent.extendedTextMessage — isso é decidido depois, no adaptador', () => {
    const r = validarPayloadBruto({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, msgContent: { imageMessage: {} } });
    expect(r.ok).toBe(true);
  });
});
