// Validação estrutural do corpo do despacho, já com JSON.parse feito, contra
// a forma exata declarada em despacho.md. Nunca lança erro — qualquer coisa
// que não bata com o formato é `ok:false`, com motivo.
import type { DespachoBrutoIndividual, MensagemDespachoBruta } from './tipos';

export type ResultadoValidacaoDespacho =
  | { ok: true; despacho: DespachoBrutoIndividual }
  | { ok: false; motivo: string };

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringNaoVazia(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Parse seguro do corpo cru — nunca lança, mesmo com JSON inválido. */
export function parsearCorpoCruSemLancar(corpoCru: string): { ok: true; valor: unknown } | { ok: false; motivo: string } {
  try {
    return { ok: true, valor: JSON.parse(corpoCru) };
  } catch {
    return { ok: false, motivo: 'corpo cru não é um JSON válido' };
  }
}

/**
 * Valida a FORMA do despacho já parseado — não decide duplicata, não decide
 * conteúdo processável, isso é do adaptador (`processarDespachoIndividual.ts`).
 */
export function validarDespachoBruto(valor: unknown): ResultadoValidacaoDespacho {
  if (!ehObjeto(valor)) return { ok: false, motivo: 'corpo do despacho não é um objeto' };

  if (!stringNaoVazia(valor.dispatchId)) return { ok: false, motivo: "campo 'dispatchId' ausente ou vazio" };

  if (!ehObjeto(valor.organization) || !stringNaoVazia(valor.organization.id)) {
    return { ok: false, motivo: "campo 'organization.id' ausente ou inválido" };
  }

  if (
    !ehObjeto(valor.conversation) ||
    !stringNaoVazia(valor.conversation.id) ||
    !stringNaoVazia(valor.conversation.channel) ||
    typeof valor.conversation.aiEnabled !== 'boolean' ||
    typeof valor.conversation.windowOpen !== 'boolean'
  ) {
    return { ok: false, motivo: "campo 'conversation' ausente ou com forma inválida (id/channel/aiEnabled/windowOpen)" };
  }

  if (!ehObjeto(valor.contact) || !stringNaoVazia(valor.contact.id) || !stringNaoVazia(valor.contact.identity)) {
    return { ok: false, motivo: "campo 'contact' ausente ou com forma inválida (id/identity)" };
  }

  if (!Array.isArray(valor.messages)) {
    return { ok: false, motivo: "campo 'messages' não é um array" };
  }
  // despacho.md é explícito: "messages nunca llega vacío".
  if (valor.messages.length === 0) {
    return { ok: false, motivo: "campo 'messages' está vazio — contrato declara que isso nunca acontece num despacho de verdade" };
  }
  for (const [i, m] of valor.messages.entries()) {
    const msg = m as Partial<MensagemDespachoBruta>;
    if (!ehObjeto(msg) || !stringNaoVazia(msg.id) || !stringNaoVazia(msg.at) || !stringNaoVazia(msg.type)) {
      return { ok: false, motivo: `mensagem [${i}] de 'messages' tem forma inválida (id/at/type)` };
    }
  }

  if (!stringNaoVazia(valor.firstMessageAt) || !stringNaoVazia(valor.lastMessageAt)) {
    return { ok: false, motivo: "campo 'firstMessageAt' ou 'lastMessageAt' ausente ou inválido" };
  }

  return { ok: true, despacho: valor as unknown as DespachoBrutoIndividual };
}
