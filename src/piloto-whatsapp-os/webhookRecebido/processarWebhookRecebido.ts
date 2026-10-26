// Adaptador OFFLINE do callback 'webhookReceived' — escopo: só TEXTO PRIVADO
// (ver gates G1–G5 em tipos.ts). Nenhuma chamada de rede acontece aqui; isto
// só transforma um payload já recebido (ex.: em fixture, nunca em produção
// real) em um evento normalizado, ou o recusa/coloca em quarentena.
import type { EventoTextoPrivadoNormalizado, ResultadoProcessamentoWebhookRecebido } from './tipos';
import { validarPayloadBruto } from './validarPayloadBruto';

function extrairTextoSeSuportado(msgContent: unknown): string | undefined {
  if (typeof msgContent !== 'object' || msgContent === null) return undefined;
  const extended = (msgContent as Record<string, unknown>).extendedTextMessage;
  if (typeof extended !== 'object' || extended === null) return undefined;
  const texto = (extended as Record<string, unknown>).text;
  return typeof texto === 'string' ? texto : undefined;
}

/**
 * Processa um payload bruto de callback. NUNCA produz um evento "autenticado"
 * — o campo `autenticidade` do evento normalizado é sempre 'NAO_VERIFICADA'
 * (gate G1). Grupos (isGroup !== false) e qualquer conteúdo que não seja
 * `extendedTextMessage` (ex.: imagem — gate G3) vão para quarentena, nunca
 * são normalizados como texto.
 */
export function processarWebhookRecebido(entradaBruta: unknown): ResultadoProcessamentoWebhookRecebido {
  const validacao = validarPayloadBruto(entradaBruta);
  if (!validacao.ok) {
    return { tipo: 'invalido', motivo: validacao.motivo };
  }
  const payload = validacao.payload;

  // Gate G2: só isGroup === false (estritamente) é aceito. Qualquer outra
  // coisa — true, ou algo que não seja exatamente false — vai para
  // quarentena, porque não existe payload de grupo verificado contra esta
  // fonte (e o próprio usuário citou ambiguidade de `sender.id` em grupos).
  if ((payload as unknown as { isGroup: unknown }).isGroup !== false) {
    return {
      tipo: 'quarentena_grupo_nao_suportado',
      motivo: 'isGroup não é exatamente false — contrato de grupo ainda não verificado (gate G2)',
    };
  }

  const texto = extrairTextoSeSuportado(payload.msgContent);
  if (texto === undefined) {
    return {
      tipo: 'quarentena_tipo_de_conteudo_nao_suportado',
      motivo: 'msgContent não é um extendedTextMessage com texto — outros tipos (ex.: imagem) não são processados nesta etapa (gate G3)',
    };
  }

  const sender = payload.sender as { id: string; pushName?: unknown };
  const remetenteNome = typeof sender.pushName === 'string' ? sender.pushName : undefined;

  const evento: EventoTextoPrivadoNormalizado = {
    origem: 'webhook_w_api_callback_nao_autenticado',
    instanceId: payload.instanceId as string,
    connectedPhone: payload.connectedPhone as string,
    messageId: payload.messageId as string,
    remetenteId: sender.id,
    remetenteNome,
    fromMe: payload.fromMe as boolean,
    momentoUnix: payload.moment as number,
    texto,
    autenticidade: 'NAO_VERIFICADA',
  };

  return { tipo: 'normalizado', evento };
}
