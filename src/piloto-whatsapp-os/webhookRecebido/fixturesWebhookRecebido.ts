// Fixtures INTEIRAMENTE FICTÍCIAS, no formato do envelope declarado pela
// fonte citada (ver tipos.ts), mas sem copiar nenhum número, ID ou nome dos
// exemplos reais (ex.: moment/messageId/sender.id/texto de exemplo da
// documentação). Todo valor abaixo foi inventado só para exercitar o
// validador/adaptador.

export const PAYLOAD_TEXTO_PRIVADO_FICTICIO = {
  event: 'webhookReceived',
  instanceId: 'instancia-ficticia-001',
  connectedPhone: 'numero-conectado-ficticio-001',
  messageId: 'msg-callback-ficticia-A1',
  isGroup: false,
  fromMe: false,
  chat: { id: 'conversa-ficticia-A1', profilePicture: undefined },
  sender: {
    id: 'remetente-ficticio-A1',
    pushName: 'Pintor Exemplo Ficticio',
    verifiedBizName: undefined,
  },
  moment: 1700000001,
  msgContent: {
    extendedTextMessage: { text: 'Cheguei na obra fictícia, começando a pintura da sala.' },
  },
};

/** fromMe:true — deve normalizar igual, só com o campo diferente (não é um gate, é metadado). */
export const PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO = {
  ...PAYLOAD_TEXTO_PRIVADO_FICTICIO,
  messageId: 'msg-callback-ficticia-A2',
  fromMe: true,
  msgContent: { extendedTextMessage: { text: 'Confirmando que recebi o recado.' } },
};

/** isGroup:true — deve ser recusado/quarentenado, nunca normalizado (gate G2). */
export const PAYLOAD_GRUPO_FICTICIO = {
  ...PAYLOAD_TEXTO_PRIVADO_FICTICIO,
  messageId: 'msg-callback-ficticia-B1',
  isGroup: true,
  chat: { id: 'grupo-obra-ficticio-B1' },
};

/** msgContent de imagem (não extendedTextMessage) — deve ser quarentenado, nunca processado como texto (gate G3). */
export const PAYLOAD_IMAGEM_FICTICIO = {
  ...PAYLOAD_TEXTO_PRIVADO_FICTICIO,
  messageId: 'msg-callback-ficticia-C1',
  msgContent: {
    imageMessage: {
      mimetype: 'image/jpeg',
      caption: 'foto fictícia da obra',
      fileLength: '0',
      height: 0,
      width: 0,
    },
  },
};

/** Falta um campo obrigatório (messageId) — deve ser 'invalido'. */
export const PAYLOAD_INVALIDO_SEM_MESSAGE_ID_FICTICIO = {
  event: 'webhookReceived',
  instanceId: 'instancia-ficticia-002',
  connectedPhone: 'numero-conectado-ficticio-002',
  isGroup: false,
  fromMe: false,
  chat: { id: 'conversa-ficticia-D1' },
  sender: { id: 'remetente-ficticio-D1' },
  moment: 1700000002,
  msgContent: { extendedTextMessage: { text: 'Payload fictício sem messageId.' } },
};
