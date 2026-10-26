// Adaptador OFFLINE do despacho individual do Vocero → rascunho de OS. NUNCA
// cria OS real, NUNCA envia nada (não há, neste módulo, nenhuma chamada a
// `/api/bot/messages` nem a qualquer outro endpoint — ver guarda estrutural
// em `__tests__/semBackendRealVocero.test.ts`), NUNCA conecta rede. Fail-closed
// na assinatura: sem segredo ou assinatura inválida, nada é processado.
import type { ArmazenamentoDurabilidadeOffline } from './armazenamentoDurabilidadeOffline';
import type {
  CabecalhosDespachoBrutos,
  MensagemTextoValidada,
  RascunhoOSVocero,
  ResultadoProcessamentoDespacho,
} from './tipos';
import { parsearCorpoCruSemLancar, validarDespachoBruto } from './validarDespachoBruto';
import { verificarAssinaturaDespacho } from './verificarAssinaturaDespacho';

export interface EntradaProcessamentoDespacho {
  /** Os bytes/string EXATOS recebidos — a assinatura é sobre isto, nunca sobre um JSON re-serializado. */
  corpoCru: string;
  cabecalhos: CabecalhosDespachoBrutos;
  /** Fail-closed se ausente — ver `verificarAssinaturaDespacho`. Em teste, use um segredo explicitamente fictício (nunca um real). */
  segredoHmac: string | undefined;
  armazenamento: ArmazenamentoDurabilidadeOffline;
}

function gerarIdRascunho(dispatchId: string): string {
  return `rascunho-vocero-${dispatchId}`;
}

/**
 * Processa UM despacho (ráfaga de uma conversa individual) do Vocero.
 * Produz, no máximo, UM rascunho de OS, sempre `pendente_aprovacao` — nunca
 * uma OS real, nunca enviado a lugar nenhum. Ordem: assinatura (fail-closed)
 * → parse → forma → duplicata por dispatchId → deduplicação por
 * messages[].id → separação texto/mídia (mídia nunca processada aqui, V2) →
 * rascunho ou quarentena.
 */
export function processarDespachoIndividual(entrada: EntradaProcessamentoDespacho): ResultadoProcessamentoDespacho {
  const verificacao = verificarAssinaturaDespacho(entrada.corpoCru, entrada.cabecalhos.assinatura, entrada.segredoHmac);
  if (!verificacao.valida) {
    return { tipo: 'assinatura_invalida', motivo: verificacao.motivo };
  }

  const parse = parsearCorpoCruSemLancar(entrada.corpoCru);
  if (!parse.ok) {
    return { tipo: 'invalido', motivo: parse.motivo };
  }

  const validacao = validarDespachoBruto(parse.valor);
  if (!validacao.ok) {
    return { tipo: 'invalido', motivo: validacao.motivo };
  }
  const despacho = validacao.despacho as unknown as {
    dispatchId: string;
    organization: { id: string; slug?: string };
    conversation: { id: string; channel: string; aiEnabled: boolean; windowOpen: boolean };
    contact: { id: string; identity: string; displayName?: string };
    messages: Array<{ id: string; at: string; type: string; text?: string | null; mediaId?: string | null }>;
    firstMessageAt: string;
    lastMessageAt: string;
  };

  const dispatchId = despacho.dispatchId;

  if (entrada.cabecalhos.dispatchId && entrada.cabecalhos.dispatchId !== dispatchId) {
    return {
      tipo: 'invalido',
      motivo: "X-Vocero-Dispatch-Id do cabeçalho não corresponde ao 'dispatchId' do corpo",
    };
  }

  const consulta = entrada.armazenamento.dispatchJaProcessado(dispatchId);
  if (consulta.processado) {
    return {
      tipo: 'duplicado',
      motivo: `dispatchId '${dispatchId}' já foi processado antes — dispatchId é a chave de idempotência do despacho (despacho.md); nenhum rascunho novo foi criado`,
      dispatchId,
    };
  }

  const mensagensTextoNovas: MensagemTextoValidada[] = [];
  const midiasNaoProcessadas: string[] = [];
  const idsRealmenteNovos: string[] = [];

  for (const m of despacho.messages) {
    if (entrada.armazenamento.mensagemJaVista(m.id)) {
      // Já apareceu num despacho anterior (burst repete mensagens — despacho.md) — não reprocessar.
      continue;
    }
    idsRealmenteNovos.push(m.id);
    if (m.type === 'text' && typeof m.text === 'string' && m.text.length > 0) {
      mensagensTextoNovas.push({ id: m.id, at: m.at, texto: m.text });
    } else if (typeof m.mediaId === 'string' && m.mediaId) {
      // V2: IA embutida e este piloto são texto-apenas — mídia precisa de tratamento próprio, nunca inventado aqui.
      midiasNaoProcessadas.push(m.mediaId);
    }
  }

  if (mensagensTextoNovas.length === 0) {
    entrada.armazenamento.registrarProcessado(dispatchId, null, idsRealmenteNovos);
    return {
      tipo: 'quarentena_sem_texto_processavel',
      motivo:
        'nenhuma mensagem de texto nova nesta ráfaga (só mídia, e/ou tudo já visto num despacho anterior) — ' +
        'nenhum rascunho criado; mídia precisa de tratamento próprio, nunca inventado aqui (gate V2)',
      dispatchId,
    };
  }

  const rascunho: RascunhoOSVocero = {
    origem: 'vocero_despacho_individual_nao_autenticado_em_producao',
    dispatchId,
    organizationRef: despacho.organization.slug ?? despacho.organization.id,
    conversationId: despacho.conversation.id,
    contatoId: despacho.contact.id,
    contatoIdentidade: despacho.contact.identity,
    contatoNome: despacho.contact.displayName,
    canal: despacho.conversation.channel,
    mensagens: mensagensTextoNovas,
    midiasNaoProcessadas,
    primeiraMensagemEm: despacho.firstMessageAt,
    ultimaMensagemEm: despacho.lastMessageAt,
    status: 'pendente_aprovacao',
  };

  entrada.armazenamento.registrarProcessado(dispatchId, gerarIdRascunho(dispatchId), idsRealmenteNovos);

  return { tipo: 'rascunho_criado', rascunho };
}
