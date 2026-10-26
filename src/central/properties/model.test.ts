import { describe, expect, it } from 'vitest';
import { validarConjunto, type PropertyEntry, type UnitEntry } from './model';

const PROJ = 'proj-1';

function propriedade(partial: Partial<PropertyEntry> & { propertyId: string }): PropertyEntry {
  return { projetoId: PROJ, name: 'Edifício A', ...partial };
}
function unidade(partial: Partial<UnitEntry> & { unitId: string; propertyId: string }): UnitEntry {
  return { projetoId: PROJ, label: 'Unidade 101', ...partial };
}

describe('validarConjunto', () => {
  it('aceita dataset vazio autenticado como válido (estado vazio explícito)', () => {
    const resultado = validarConjunto({ properties: [], units: [] }, PROJ);
    expect(resultado).toEqual({ ok: true, dataset: { properties: [], units: [] } });
  });

  it('aceita propriedades e unidades válidas do mesmo projeto, vinculadas corretamente', () => {
    const dataset = {
      properties: [propriedade({ propertyId: 'p1' }), propriedade({ propertyId: 'p2', name: 'Edifício B' })],
      units: [unidade({ unitId: 'u1', propertyId: 'p1' }), unidade({ unitId: 'u2', propertyId: 'p1' })],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dataset.properties.length).toBe(2);
      expect(resultado.dataset.units.length).toBe(2);
    }
  });

  it('rejeita formato inesperado (properties/units ausentes ou não-array)', () => {
    expect(validarConjunto(null, PROJ).ok).toBe(false);
    expect(validarConjunto({ properties: [] }, PROJ).ok).toBe(false);
    expect(validarConjunto({ properties: 'x', units: [] }, PROJ).ok).toBe(false);
    const resultado = validarConjunto({ properties: [{ propertyId: 'p1' }], units: [] }, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('formato');
  });

  it('rejeita projeto misto numa propriedade, sem revelar o ID da linha de outro projeto', () => {
    const dataset = {
      properties: [
        propriedade({ propertyId: 'p1' }),
        propriedade({ propertyId: 'propriedade-sigilosa-outro-projeto', projetoId: 'outro-projeto' }),
      ],
      units: [],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro.motivo).toBe('projeto_misto');
      expect(resultado.erro.detalhe).not.toContain('propriedade-sigilosa-outro-projeto');
    }
  });

  it('rejeita projeto misto numa unidade, sem revelar o ID da linha de outro projeto', () => {
    const dataset = {
      properties: [propriedade({ propertyId: 'p1' })],
      units: [unidade({ unitId: 'unidade-sigilosa-outro-projeto', propertyId: 'p1', projetoId: 'outro-projeto' })],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro.motivo).toBe('projeto_misto');
      expect(resultado.erro.detalhe).not.toContain('unidade-sigilosa-outro-projeto');
    }
  });

  it('rejeita PropertyId duplicada', () => {
    const dataset = {
      properties: [propriedade({ propertyId: 'dup' }), propriedade({ propertyId: 'dup' })],
      units: [],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('propriedade_duplicada');
  });

  it('rejeita UnitId duplicada', () => {
    const dataset = {
      properties: [propriedade({ propertyId: 'p1' })],
      units: [unidade({ unitId: 'dup', propertyId: 'p1' }), unidade({ unitId: 'dup', propertyId: 'p1' })],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('unidade_duplicada');
  });

  it('rejeita unidade que referencia propriedade inexistente no conjunto (vínculo inválido)', () => {
    const dataset = {
      properties: [propriedade({ propertyId: 'p1' })],
      units: [unidade({ unitId: 'u1', propertyId: 'propriedade-que-nao-existe' })],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('unidade_sem_propriedade');
  });

  it('rejeita propertyId e unitId só com espaços (whitespace-only não é um ID válido)', () => {
    const r1 = validarConjunto({ properties: [propriedade({ propertyId: '   ' })], units: [] }, PROJ);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.erro.motivo).toBe('formato');

    const r2 = validarConjunto(
      { properties: [propriedade({ propertyId: 'p1' })], units: [unidade({ unitId: '   ', propertyId: 'p1' })] },
      PROJ,
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.erro.motivo).toBe('formato');
  });

  it('nunca repassa a referência original: mutar o dataset retornado não altera a entrada recebida', () => {
    const entrada = {
      properties: [propriedade({ propertyId: 'p1' })],
      units: [unidade({ unitId: 'u1', propertyId: 'p1' })],
    };
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    resultado.dataset.properties[0].name = 'Nome alterado só na cópia';
    resultado.dataset.units[0].label = 'Rótulo alterado só na cópia';
    expect(entrada.properties[0].name).toBe('Edifício A');
    expect(entrada.units[0].label).toBe('Unidade 101');
  });

  it('copia só os campos declarados: um campo extra em propriedade ou unidade nunca atravessa a validação', () => {
    const entrada = {
      properties: [
        { propertyId: 'p1', projetoId: PROJ, name: 'Edifício A', custoInternoNaoDeveriaVazar: 999 },
      ],
      units: [
        { unitId: 'u1', propertyId: 'p1', projetoId: PROJ, label: 'Unidade 101', chaveMestraNaoDeveriaVazar: 'segredo' },
      ],
    };
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(Object.keys(resultado.dataset.properties[0]).sort()).toEqual(['name', 'projetoId', 'propertyId']);
    expect(Object.keys(resultado.dataset.units[0]).sort()).toEqual(['label', 'projetoId', 'propertyId', 'unitId']);
  });

  it('IDs nunca são renormalizados na cópia; name/label só são aparados (trim) para fallback visual', () => {
    const entrada = {
      properties: [{ propertyId: 'p1', projetoId: PROJ, name: '  Edifício A  ' }],
      units: [{ unitId: 'u1', propertyId: 'p1', projetoId: PROJ, label: '  Unidade 101  ' }],
    };
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // IDs idênticos aos recebidos, char a char — nunca aparados.
    expect(resultado.dataset.properties[0].propertyId).toBe('p1');
    expect(resultado.dataset.units[0].unitId).toBe('u1');
    expect(resultado.dataset.units[0].propertyId).toBe('p1');
    // name/label aparados — só para habilitar o fallback visual já
    // existente na tela, nunca uma exigência nova (string vazia continua
    // um dataset válido).
    expect(resultado.dataset.properties[0].name).toBe('Edifício A');
    expect(resultado.dataset.units[0].label).toBe('Unidade 101');
  });

  it('rejeita projeto vazio/invalido como parâmetro', () => {
    expect(validarConjunto({ properties: [], units: [] }, '').ok).toBe(false);
  });
});
