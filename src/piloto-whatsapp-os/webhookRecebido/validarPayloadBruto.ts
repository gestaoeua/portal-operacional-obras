// Validação estrutural do payload bruto do callback 'webhookReceived', ANTES
// de qualquer normalização. Só confirma formato (tipos/presença dos campos
// declarados pela fonte citada em `tipos.ts`) — nunca confirma autenticidade
// (gate G1, ver tipos.ts) nem decide se é grupo/mídia (isso é feito depois,
// em `processarWebhookRecebido.ts`, com o payload já validado).
import type { PayloadWebhookRecebidoBrutoTexto } from './tipos';

export type ResultadoValidacaoBruto =
  | { ok: true; payload: PayloadWebhookRecebidoBrutoTexto }
  | { ok: false; motivo: string };

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Valida só a FORMA do envelope bruto — não decide se é texto/grupo/mídia válido para processar. */
export function validarPayloadBruto(entrada: unknown): ResultadoValidacaoBruto {
  if (!ehObjeto(entrada)) {
    return { ok: false, motivo: 'payload bruto não é um objeto' };
  }

  const camposString: Array<keyof PayloadWebhookRecebidoBrutoTexto> = [
    'event',
    'instanceId',
    'connectedPhone',
    'messageId',
  ];
  for (const campo of camposString) {
    if (typeof entrada[campo] !== 'string' || entrada[campo] === '') {
      return { ok: false, motivo: `campo '${campo}' ausente ou não é uma string não vazia` };
    }
  }

  if (typeof entrada.isGroup !== 'boolean') {
    return { ok: false, motivo: "campo 'isGroup' ausente ou não é booleano" };
  }
  if (typeof entrada.fromMe !== 'boolean') {
    return { ok: false, motivo: "campo 'fromMe' ausente ou não é booleano" };
  }
  if (typeof entrada.moment !== 'number' || !Number.isFinite(entrada.moment)) {
    return { ok: false, motivo: "campo 'moment' ausente ou não é um número" };
  }
  if (!ehObjeto(entrada.chat) || typeof entrada.chat.id !== 'string' || entrada.chat.id === '') {
    return { ok: false, motivo: "campo 'chat.id' ausente ou não é uma string não vazia" };
  }
  if (!ehObjeto(entrada.sender) || typeof entrada.sender.id !== 'string' || entrada.sender.id === '') {
    return { ok: false, motivo: "campo 'sender.id' ausente ou não é uma string não vazia" };
  }
  if (!ehObjeto(entrada.msgContent)) {
    return { ok: false, motivo: "campo 'msgContent' ausente ou não é um objeto" };
  }

  return {
    ok: true,
    payload: entrada as unknown as PayloadWebhookRecebidoBrutoTexto,
  };
}
