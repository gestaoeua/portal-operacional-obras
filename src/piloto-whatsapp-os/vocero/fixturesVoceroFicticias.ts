// Fixtures INTEIRAMENTE FICTÍCIAS, no formato exato de despacho.md (ordem de
// chaves inclusive — é contrato, segundo a própria doc). Nenhum valor aqui
// copia os exemplos reais da documentação (que usava "Ana", um telefone
// mexicano de exemplo, "¿tienen disponible el modelo azul?" etc.) — tudo
// abaixo foi inventado, no tema deste piloto (obra/pintura), só para
// exercitar o adaptador.
import { createHmac } from 'node:crypto';

/**
 * Segredo HMAC EXPLICITAMENTE fictício, só para estes testes locais. NUNCA é,
 * e nunca deve ser tratado como, um segredo real de produção (BOT_API_KEY) —
 * ver aviso em `verificarAssinaturaDespacho.ts`. Gerado só para este piloto,
 * não reaproveitado de nenhum segredo real nem de nada anterior nesta
 * conversa.
 */
export const SEGREDO_HMAC_DE_TESTE_NUNCA_REAL = 'segredo-ficticio-de-teste-piloto-vocero-2026-nao-usar-em-producao';

/** Assina um corpo cru com o segredo de TESTE — nunca usar fora de fixtures/testes. */
export function assinarParaTeste(corpoCru: string, segredo: string = SEGREDO_HMAC_DE_TESTE_NUNCA_REAL): string {
  return 'sha256=' + createHmac('sha256', segredo).update(corpoCru, 'utf8').digest('hex');
}

function construirCorpo(obj: Record<string, unknown>): string {
  // JSON.stringify preserva a ordem de inserção das chaves do objeto — a
  // mesma ordem usada abaixo é a ordem declarada em despacho.md.
  return JSON.stringify(obj);
}

// --- Despacho 1: individual, só texto, válido --------------------------------
const corpo1 = construirCorpo({
  dispatchId: 'dsp-ficticio-001',
  organization: { id: 'org-ficticio-pintura', slug: 'obra-exemplo-pintura' },
  conversation: {
    id: 'cv-ficticio-001',
    channel: 'whatsapp',
    aiEnabled: true,
    windowOpen: true,
    windowExpiresAt: '2026-10-20T04:12:00.000Z',
  },
  contact: { id: 'ct-ficticio-001', displayName: 'Cliente Exemplo Um', identity: 'identidade-ficticia-001' },
  messages: [
    {
      id: 'msg-ficticio-d1-a',
      at: '2026-10-19T14:00:00.000Z',
      type: 'text',
      text: 'Gostaria de saber o prazo para pintura da fachada, por favor.',
      mediaId: null,
    },
  ],
  firstMessageAt: '2026-10-19T14:00:00.000Z',
  lastMessageAt: '2026-10-19T14:00:00.000Z',
});
export const DESPACHO_INDIVIDUAL_TEXTO_FICTICIO = {
  corpoCru: corpo1,
  cabecalhos: {
    assinatura: assinarParaTeste(corpo1),
    dispatchId: 'dsp-ficticio-001',
    organization: 'obra-exemplo-pintura',
  },
};

// --- Despacho 2: individual, só imagem (sem texto processável) --------------
const corpo2 = construirCorpo({
  dispatchId: 'dsp-ficticio-002',
  organization: { id: 'org-ficticio-pintura', slug: 'obra-exemplo-pintura' },
  conversation: {
    id: 'cv-ficticio-002',
    channel: 'whatsapp',
    aiEnabled: true,
    windowOpen: true,
    windowExpiresAt: '2026-10-20T04:12:00.000Z',
  },
  contact: { id: 'ct-ficticio-002', displayName: 'Cliente Exemplo Dois', identity: 'identidade-ficticia-002' },
  messages: [
    {
      id: 'msg-ficticio-d2-a',
      at: '2026-10-19T15:00:00.000Z',
      type: 'image',
      text: null,
      mediaId: 'media-ficticio-001',
      mimeType: 'image/jpeg',
      caption: 'foto fictícia da fachada',
    },
  ],
  firstMessageAt: '2026-10-19T15:00:00.000Z',
  lastMessageAt: '2026-10-19T15:00:00.000Z',
});
export const DESPACHO_INDIVIDUAL_SO_IMAGEM_FICTICIO = {
  corpoCru: corpo2,
  cabecalhos: { assinatura: assinarParaTeste(corpo2), dispatchId: 'dsp-ficticio-002', organization: 'obra-exemplo-pintura' },
};

// --- Despacho 3: individual, texto + imagem na mesma ráfaga ------------------
const corpo3 = construirCorpo({
  dispatchId: 'dsp-ficticio-003',
  organization: { id: 'org-ficticio-pintura', slug: 'obra-exemplo-pintura' },
  conversation: {
    id: 'cv-ficticio-003',
    channel: 'whatsapp',
    aiEnabled: true,
    windowOpen: true,
    windowExpiresAt: '2026-10-20T04:12:00.000Z',
  },
  contact: { id: 'ct-ficticio-003', displayName: 'Cliente Exemplo Três', identity: 'identidade-ficticia-003' },
  messages: [
    {
      id: 'msg-ficticio-d3-a',
      at: '2026-10-19T16:00:00.000Z',
      type: 'text',
      text: 'Segue uma foto do local para orçamento.',
      mediaId: null,
    },
    {
      id: 'msg-ficticio-d3-b',
      at: '2026-10-19T16:00:05.000Z',
      type: 'image',
      text: null,
      mediaId: 'media-ficticio-002',
      mimeType: 'image/jpeg',
      caption: null,
    },
  ],
  firstMessageAt: '2026-10-19T16:00:00.000Z',
  lastMessageAt: '2026-10-19T16:00:05.000Z',
});
export const DESPACHO_INDIVIDUAL_TEXTO_E_IMAGEM_FICTICIO = {
  corpoCru: corpo3,
  cabecalhos: { assinatura: assinarParaTeste(corpo3), dispatchId: 'dsp-ficticio-003', organization: 'obra-exemplo-pintura' },
};

// --- Despacho 4: ráfaga seguinte que REPETE a mensagem do despacho 1,
//     mais uma mensagem nova de verdade (simula o comportamento descrito em
//     despacho.md: "o despacho seguinte repete as mensagens anteriores junto
//     com a nova"). Usar DEPOIS de processar o despacho 1 no mesmo
//     armazenamento, para testar deduplicação por messages[].id entre
//     dispatchIds diferentes.
const corpo4 = construirCorpo({
  dispatchId: 'dsp-ficticio-004',
  organization: { id: 'org-ficticio-pintura', slug: 'obra-exemplo-pintura' },
  conversation: {
    id: 'cv-ficticio-001',
    channel: 'whatsapp',
    aiEnabled: true,
    windowOpen: true,
    windowExpiresAt: '2026-10-20T04:12:00.000Z',
  },
  contact: { id: 'ct-ficticio-001', displayName: 'Cliente Exemplo Um', identity: 'identidade-ficticia-001' },
  messages: [
    {
      id: 'msg-ficticio-d1-a', // repetida do despacho 1 — não deve virar conteúdo novo
      at: '2026-10-19T14:00:00.000Z',
      type: 'text',
      text: 'Gostaria de saber o prazo para pintura da fachada, por favor.',
      mediaId: null,
    },
    {
      id: 'msg-ficticio-d4-novo',
      at: '2026-10-19T14:05:00.000Z',
      type: 'text',
      text: 'E para os fundos, dá para fazer junto?',
      mediaId: null,
    },
  ],
  firstMessageAt: '2026-10-19T14:00:00.000Z',
  lastMessageAt: '2026-10-19T14:05:00.000Z',
});
export const DESPACHO_RAFAGA_COM_MENSAGEM_REPETIDA_FICTICIO = {
  corpoCru: corpo4,
  cabecalhos: { assinatura: assinarParaTeste(corpo4), dispatchId: 'dsp-ficticio-004', organization: 'obra-exemplo-pintura' },
};

// --- Corpo com JSON malformado (assinatura válida PARA ESTE corpo cru, para
//     isolar o teste de "JSON inválido" do teste de "assinatura inválida"). --
export const CORPO_CRU_JSON_INVALIDO_FICTICIO = '{"dispatchId": "dsp-ficticio-900", "organization": ';
export const CABECALHOS_JSON_INVALIDO_FICTICIO = {
  assinatura: assinarParaTeste(CORPO_CRU_JSON_INVALIDO_FICTICIO),
  dispatchId: 'dsp-ficticio-900',
  organization: 'obra-exemplo-pintura',
};

// --- JSON válido, mas faltando o campo 'contact' (forma inválida) -----------
const corpoSemContact = construirCorpo({
  dispatchId: 'dsp-ficticio-901',
  organization: { id: 'org-ficticio-pintura', slug: 'obra-exemplo-pintura' },
  conversation: { id: 'cv-ficticio-901', channel: 'whatsapp', aiEnabled: true, windowOpen: true },
  messages: [{ id: 'msg-ficticio-901-a', at: '2026-10-19T17:00:00.000Z', type: 'text', text: 'oi', mediaId: null }],
  firstMessageAt: '2026-10-19T17:00:00.000Z',
  lastMessageAt: '2026-10-19T17:00:00.000Z',
});
export const DESPACHO_SEM_CONTACT_FICTICIO = {
  corpoCru: corpoSemContact,
  cabecalhos: { assinatura: assinarParaTeste(corpoSemContact), dispatchId: 'dsp-ficticio-901', organization: 'obra-exemplo-pintura' },
};

// --- JSON válido, mas messages:[] vazio (despacho.md diz que isso nunca
//     acontece num despacho de verdade — testa que a validação rejeita). ----
const corpoMessagesVazio = construirCorpo({
  dispatchId: 'dsp-ficticio-902',
  organization: { id: 'org-ficticio-pintura', slug: 'obra-exemplo-pintura' },
  conversation: { id: 'cv-ficticio-902', channel: 'whatsapp', aiEnabled: true, windowOpen: true },
  contact: { id: 'ct-ficticio-902', displayName: 'Cliente Exemplo Nove', identity: 'identidade-ficticia-902' },
  messages: [],
  firstMessageAt: '2026-10-19T18:00:00.000Z',
  lastMessageAt: '2026-10-19T18:00:00.000Z',
});
export const DESPACHO_MESSAGES_VAZIO_FICTICIO = {
  corpoCru: corpoMessagesVazio,
  cabecalhos: { assinatura: assinarParaTeste(corpoMessagesVazio), dispatchId: 'dsp-ficticio-902', organization: 'obra-exemplo-pintura' },
};
