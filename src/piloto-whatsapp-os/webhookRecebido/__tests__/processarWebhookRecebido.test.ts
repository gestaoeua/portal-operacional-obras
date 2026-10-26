import { describe, expect, it } from 'vitest';
import { processarWebhookRecebido } from '../processarWebhookRecebido';
import {
  PAYLOAD_GRUPO_FICTICIO,
  PAYLOAD_IMAGEM_FICTICIO,
  PAYLOAD_INVALIDO_SEM_MESSAGE_ID_FICTICIO,
  PAYLOAD_TEXTO_PRIVADO_FICTICIO,
  PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO,
} from '../fixturesWebhookRecebido';

describe('processarWebhookRecebido — escopo só TEXTO PRIVADO, dados inteiramente fictícios', () => {
  it('normaliza um payload de texto privado válido, sempre com autenticidade NAO_VERIFICADA (gate G1)', () => {
    const resultado = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FICTICIO);
    expect(resultado.tipo).toBe('normalizado');
    if (resultado.tipo !== 'normalizado') throw new Error('esperado normalizado');
    expect(resultado.evento.autenticidade).toBe('NAO_VERIFICADA');
    expect(resultado.evento.texto).toBe('Cheguei na obra fictícia, começando a pintura da sala.');
    expect(resultado.evento.remetenteId).toBe('remetente-ficticio-A1');
    expect(resultado.evento.remetenteNome).toBe('Pintor Exemplo Ficticio');
    expect(resultado.evento.origem).toBe('webhook_w_api_callback_nao_autenticado');
  });

  it('normaliza igual quando fromMe:true — a NORMALIZAÇÃO não filtra por fromMe; quem decide se isso é elegível para criar rascunho automaticamente é `decidirIngestaoAutomatica` (ver decidirIngestaoAutomatica.test.ts), não esta função', () => {
    const resultado = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO);
    expect(resultado.tipo).toBe('normalizado');
    if (resultado.tipo !== 'normalizado') throw new Error('esperado normalizado');
    expect(resultado.evento.fromMe).toBe(true);
  });

  it('coloca mensagem de GRUPO em quarentena — nunca normaliza (gate G2, contrato de grupo não verificado)', () => {
    const resultado = processarWebhookRecebido(PAYLOAD_GRUPO_FICTICIO);
    expect(resultado.tipo).toBe('quarentena_grupo_nao_suportado');
  });

  it('coloca conteúdo de IMAGEM em quarentena — nunca tenta baixar/decriptar mídia (gate G3)', () => {
    const resultado = processarWebhookRecebido(PAYLOAD_IMAGEM_FICTICIO);
    expect(resultado.tipo).toBe('quarentena_tipo_de_conteudo_nao_suportado');
  });

  it('rejeita payload estruturalmente inválido com motivo explicativo', () => {
    const resultado = processarWebhookRecebido(PAYLOAD_INVALIDO_SEM_MESSAGE_ID_FICTICIO);
    expect(resultado.tipo).toBe('invalido');
    if (resultado.tipo !== 'invalido') throw new Error('esperado invalido');
    expect(resultado.motivo).toContain('messageId');
  });

  it('rejeita entrada que não é nem um objeto', () => {
    expect(processarWebhookRecebido(null).tipo).toBe('invalido');
    expect(processarWebhookRecebido('string qualquer').tipo).toBe('invalido');
    expect(processarWebhookRecebido(undefined).tipo).toBe('invalido');
  });

  it('nunca existe um caminho de código que produza autenticidade diferente de NAO_VERIFICADA (checagem de regressão do gate G1)', () => {
    const resultados = [
      processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FICTICIO),
      processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO),
    ];
    for (const r of resultados) {
      if (r.tipo === 'normalizado') {
        expect(r.evento.autenticidade).toBe('NAO_VERIFICADA');
      }
    }
  });
});
