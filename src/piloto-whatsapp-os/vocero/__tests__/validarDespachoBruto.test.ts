import { describe, expect, it } from 'vitest';
import { parsearCorpoCruSemLancar, validarDespachoBruto } from '../validarDespachoBruto';
import {
  CABECALHOS_JSON_INVALIDO_FICTICIO,
  CORPO_CRU_JSON_INVALIDO_FICTICIO,
  DESPACHO_INDIVIDUAL_TEXTO_FICTICIO,
  DESPACHO_MESSAGES_VAZIO_FICTICIO,
  DESPACHO_SEM_CONTACT_FICTICIO,
} from '../fixturesVoceroFicticias';

describe('parsearCorpoCruSemLancar — nunca lança mesmo com JSON malformado', () => {
  it('faz parse de um corpo válido', () => {
    const resultado = parsearCorpoCruSemLancar(DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru);
    expect(resultado.ok).toBe(true);
  });

  it('rejeita JSON malformado sem lançar erro', () => {
    const resultado = parsearCorpoCruSemLancar(CORPO_CRU_JSON_INVALIDO_FICTICIO);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('JSON');
    // confirma que a fixture de cabeçalhos correspondente existe e tem assinatura própria
    expect(CABECALHOS_JSON_INVALIDO_FICTICIO.assinatura).toMatch(/^sha256=/);
  });
});

describe('validarDespachoBruto — forma exata do contrato despacho.md, nunca lança (dados fictícios)', () => {
  it('aceita um despacho individual de texto bem formado', () => {
    const parse = parsearCorpoCruSemLancar(DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru);
    if (!parse.ok) throw new Error('parse deveria ter funcionado');
    const resultado = validarDespachoBruto(parse.valor);
    expect(resultado.ok).toBe(true);
  });

  it('rejeita quando não é um objeto', () => {
    expect(validarDespachoBruto(null).ok).toBe(false);
    expect(validarDespachoBruto('string qualquer').ok).toBe(false);
    expect(validarDespachoBruto(undefined).ok).toBe(false);
    expect(validarDespachoBruto([1, 2, 3]).ok).toBe(false);
  });

  it("rejeita quando falta o campo 'dispatchId'", () => {
    const resultado = validarDespachoBruto({ organization: { id: 'x' } });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('dispatchId');
  });

  it("rejeita quando falta 'contact' — campo exigido pela forma do contrato", () => {
    const parse = parsearCorpoCruSemLancar(DESPACHO_SEM_CONTACT_FICTICIO.corpoCru);
    if (!parse.ok) throw new Error('parse deveria ter funcionado');
    const resultado = validarDespachoBruto(parse.valor);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('contact');
  });

  it("rejeita quando 'messages' está vazio — despacho.md declara que isso nunca acontece num despacho de verdade", () => {
    const parse = parsearCorpoCruSemLancar(DESPACHO_MESSAGES_VAZIO_FICTICIO.corpoCru);
    if (!parse.ok) throw new Error('parse deveria ter funcionado');
    const resultado = validarDespachoBruto(parse.valor);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('messages');
  });

  it("rejeita quando 'conversation' está com forma inválida (faltando aiEnabled/windowOpen booleanos)", () => {
    const resultado = validarDespachoBruto({
      dispatchId: 'dsp-x',
      organization: { id: 'org-x' },
      conversation: { id: 'cv-x', channel: 'whatsapp' },
      contact: { id: 'ct-x', identity: 'id-x' },
      messages: [{ id: 'm1', at: '2026-01-01T00:00:00.000Z', type: 'text' }],
      firstMessageAt: '2026-01-01T00:00:00.000Z',
      lastMessageAt: '2026-01-01T00:00:00.000Z',
    });
    expect(resultado.ok).toBe(false);
  });

  it('rejeita quando uma mensagem individual tem forma inválida (falta id/at/type)', () => {
    const resultado = validarDespachoBruto({
      dispatchId: 'dsp-x',
      organization: { id: 'org-x' },
      conversation: { id: 'cv-x', channel: 'whatsapp', aiEnabled: true, windowOpen: true },
      contact: { id: 'ct-x', identity: 'id-x' },
      messages: [{ id: 'm1' }],
      firstMessageAt: '2026-01-01T00:00:00.000Z',
      lastMessageAt: '2026-01-01T00:00:00.000Z',
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('esperado inválido');
    expect(resultado.motivo).toContain('messages');
  });

  it("rejeita quando falta 'firstMessageAt'/'lastMessageAt'", () => {
    const resultado = validarDespachoBruto({
      dispatchId: 'dsp-x',
      organization: { id: 'org-x' },
      conversation: { id: 'cv-x', channel: 'whatsapp', aiEnabled: true, windowOpen: true },
      contact: { id: 'ct-x', identity: 'id-x' },
      messages: [{ id: 'm1', at: '2026-01-01T00:00:00.000Z', type: 'text' }],
    });
    expect(resultado.ok).toBe(false);
  });
});
