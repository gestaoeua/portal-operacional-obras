import { describe, expect, it } from 'vitest';
import { decidirIngestaoAutomatica } from '../decidirIngestaoAutomatica';
import { processarWebhookRecebido } from '../processarWebhookRecebido';
import {
  PAYLOAD_TEXTO_PRIVADO_FICTICIO,
  PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO,
} from '../fixturesWebhookRecebido';

describe('decidirIngestaoAutomatica — FAIL-CLOSED DEFINITIVO: não existe NENHUM caminho de código até elegivel:true', () => {
  it('[teste direto] não-eco (fromMe:false) com autenticidade NAO_VERIFICADA (o caso "normal" hoje) é INELEGÍVEL, com motivo de autenticidade não verificada', () => {
    const r = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FICTICIO);
    if (r.tipo !== 'normalizado') throw new Error('esperado normalizado');
    expect(r.evento.fromMe).toBe(false);
    expect(r.evento.autenticidade).toBe('NAO_VERIFICADA');

    const decisao = decidirIngestaoAutomatica(r.evento);
    expect(decisao.elegivel).toBe(false);
    if (decisao.elegivel) throw new Error('esperado não elegível (fail-closed)');
    expect(decisao.motivo).toMatch(/autenticidade/i);
    expect(decisao.motivo).toMatch(/não verificad/i);
    expect(decisao.motivo).not.toMatch(/fornecedor.*(verific|garant)/i); // nunca inventar verificador do fornecedor
    expect(decisao.auditoria.autenticidadeObservada).toBe('NAO_VERIFICADA');
  });

  it('[teste de fluxo] payload bruto fictício de não-eco, do bruto até a decisão, nunca resulta em elegível', () => {
    const normalizado = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FICTICIO);
    expect(normalizado.tipo).toBe('normalizado');
    if (normalizado.tipo !== 'normalizado') return;
    const decisao = decidirIngestaoAutomatica(normalizado.evento);
    expect(decisao.elegivel).toBe(false);
  });

  it('não-eco inelegível preserva os metadados de auditoria observados, com fromMe:false explícito', () => {
    const r = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FICTICIO);
    if (r.tipo !== 'normalizado') throw new Error('esperado normalizado');
    const decisao = decidirIngestaoAutomatica(r.evento);
    if (decisao.elegivel) throw new Error('esperado não elegível');
    expect(decisao.auditoria).toEqual({
      instanceId: r.evento.instanceId,
      messageId: r.evento.messageId,
      remetenteId: r.evento.remetenteId,
      momentoUnix: r.evento.momentoUnix,
      fromMe: false,
      autenticidadeObservada: 'NAO_VERIFICADA',
    });
  });

  it('eco de mensagem enviada pela própria instância (fromMe:true) também é INELEGÍVEL — motivo específico de política, não de autenticidade', () => {
    const r = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO);
    if (r.tipo !== 'normalizado') throw new Error('esperado normalizado (a normalização em si não filtra fromMe)');
    const decisao = decidirIngestaoAutomatica(r.evento);
    expect(decisao.elegivel).toBe(false);
    if (decisao.elegivel) throw new Error('esperado não elegível');
    expect(decisao.motivo).toContain('política');
    expect(decisao.motivo).not.toMatch(/fornecedor.*(garant|filtr)/i);
  });

  it('eco inelegível preserva os metadados de auditoria observados, com fromMe:true', () => {
    const r = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO);
    if (r.tipo !== 'normalizado') throw new Error('esperado normalizado');
    const decisao = decidirIngestaoAutomatica(r.evento);
    if (decisao.elegivel) throw new Error('esperado não elegível');
    expect(decisao.auditoria).toEqual({
      instanceId: r.evento.instanceId,
      messageId: r.evento.messageId,
      remetenteId: r.evento.remetenteId,
      momentoUnix: r.evento.momentoUnix,
      fromMe: true,
      autenticidadeObservada: 'NAO_VERIFICADA',
    });
  });

  it('teste de regressão do pipeline completo: payload de eco fictício, do bruto até a decisão, nunca resulta em rascunho elegível', () => {
    const normalizado = processarWebhookRecebido(PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO);
    expect(normalizado.tipo).toBe('normalizado');
    if (normalizado.tipo !== 'normalizado') return;
    const decisao = decidirIngestaoAutomatica(normalizado.evento);
    expect(decisao.elegivel).toBe(false);
  });

  describe('entrada em runtime que não corresponde ao tipo TypeScript declarado — nunca lança erro, nunca elegível', () => {
    const entradasMalformadas: Array<{ nome: string; valor: unknown }> = [
      { nome: 'null', valor: null },
      { nome: 'undefined', valor: undefined },
      { nome: 'string qualquer', valor: 'não sou um evento' },
      { nome: 'número', valor: 42 },
      { nome: 'array vazio', valor: [] },
      { nome: 'objeto vazio', valor: {} },
      { nome: 'objeto sem nenhum campo esperado', valor: { algumCampoQueNaoExiste: true } },
      {
        nome: 'autenticidade ausente (objeto com outros campos válidos, mas sem autenticidade)',
        valor: { instanceId: 'x', messageId: 'y', remetenteId: 'z', momentoUnix: 1, fromMe: false },
      },
      {
        nome: 'autenticidade forjada tentando simular status verificado',
        valor: { instanceId: 'x', messageId: 'y', remetenteId: 'z', momentoUnix: 1, fromMe: false, autenticidade: 'VERIFICADA' },
      },
      {
        nome: 'autenticidade forjada com outro texto arbitrário',
        valor: { instanceId: 'x', messageId: 'y', remetenteId: 'z', momentoUnix: 1, fromMe: false, autenticidade: 'confirmada-pelo-fornecedor' },
      },
      { nome: 'autenticidade de tipo errado (número em vez de string)', valor: { fromMe: false, autenticidade: 1 } },
      { nome: 'fromMe de tipo errado (string em vez de boolean)', valor: { fromMe: 'false', autenticidade: 'NAO_VERIFICADA' } },
    ];

    for (const { nome, valor } of entradasMalformadas) {
      it(`${nome}: não lança erro e resulta elegivel:false`, () => {
        expect(() => decidirIngestaoAutomatica(valor)).not.toThrow();
        const decisao = decidirIngestaoAutomatica(valor);
        expect(decisao.elegivel).toBe(false);
      });
    }

    it('preserva o que for observável com segurança mesmo em entrada malformada, sem atribuir confiança', () => {
      const decisao = decidirIngestaoAutomatica({ instanceId: 'instancia-observada', autenticidade: 'string-forjada' });
      if (decisao.elegivel) throw new Error('esperado não elegível');
      expect(decisao.auditoria.instanceId).toBe('instancia-observada');
      expect(decisao.auditoria.autenticidadeObservada).toBe('string-forjada');
      expect(decisao.auditoria.messageId).toBeUndefined();
    });
  });

  it('[regressão exaustiva] nenhuma combinação de entrada testada nesta suíte produz elegivel:true — não há caminho true nesta função', () => {
    const entradas: unknown[] = [
      PAYLOAD_TEXTO_PRIVADO_FICTICIO,
      PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO,
      null,
      undefined,
      {},
      [],
      'string',
      42,
      { autenticidade: 'VERIFICADA' },
      { fromMe: false, autenticidade: 'NAO_VERIFICADA' },
      { fromMe: true, autenticidade: 'NAO_VERIFICADA' },
    ];
    for (const e of entradas) {
      const decisao = decidirIngestaoAutomatica(e);
      expect(decisao.elegivel).toBe(false);
    }
  });
});
