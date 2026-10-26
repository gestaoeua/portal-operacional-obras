/**
 * Locais e unidades por projeto — lógica pura, sem fetch e sem componente.
 *
 * Fonte de verdade: um dataset explícito fornecido por quem integra esta
 * fatia (nunca buscado por este módulo, nunca inferido de `Salas` nem de
 * `projetoId`). Falha fechado: um conjunto malformado, misturado entre
 * projetos, com IDs duplicados ou com uma unidade sem propriedade válida
 * é rejeitado por inteiro — nunca filtrado ou corrigido em silêncio, e
 * nunca revela o ID de uma linha de outro projeto na mensagem de erro.
 */

export interface PropertyEntry {
  propertyId: string;
  projetoId: string;
  name: string;
}

export interface UnitEntry {
  unitId: string;
  propertyId: string;
  projetoId: string;
  label: string;
}

/** Dataset explícito esperado como entrada — nunca construído a partir de `Salas` ou de `projetoId`. */
export interface PropertiesUnitsDataset {
  properties: PropertyEntry[];
  units: UnitEntry[];
}

export type ConjuntoInvalido =
  | { motivo: 'formato'; detalhe: string }
  | { motivo: 'projeto_misto'; detalhe: string }
  | { motivo: 'propriedade_duplicada'; detalhe: string }
  | { motivo: 'unidade_duplicada'; detalhe: string }
  | { motivo: 'unidade_sem_propriedade'; detalhe: string };

export type ValidacaoDataset =
  | { ok: true; dataset: PropertiesUnitsDataset }
  | { ok: false; erro: ConjuntoInvalido };

function isNonEmptyString(value: unknown): value is string {
  // Whitespace-only ("   ") não é um ID válido: `.length > 0` sozinho
  // aceitaria isso, então a checagem real é sobre o texto aparado — mesmo
  // padrão já adotado em src/central/catalogs/model.ts.
  return typeof value === 'string' && value.trim().length > 0;
}

function hasString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === 'string';
}

/**
 * Valida o dataset bruto ANTES de qualquer renderização. As rejeições
 * exigidas, todas fail-closed e com mensagem genérica (nunca expõem o ID
 * de uma linha de outro projeto):
 *   - formato inesperado (`formato`);
 *   - qualquer propriedade ou unidade de outro projeto (`projeto_misto`);
 *   - PropertyId repetido (`propriedade_duplicada`);
 *   - UnitId repetido (`unidade_duplicada`);
 *   - unidade cujo propertyId não existe no conjunto (`unidade_sem_propriedade`).
 */
export function validarConjunto(value: unknown, projetoId: string): ValidacaoDataset {
  if (typeof projetoId !== 'string' || !projetoId.trim()) {
    return { ok: false, erro: { motivo: 'formato', detalhe: 'Projeto inválido para locais e unidades.' } };
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as Record<string, unknown>).properties) ||
    !Array.isArray((value as Record<string, unknown>).units)
  ) {
    return {
      ok: false,
      erro: { motivo: 'formato', detalhe: 'Conjunto de locais e unidades não tem o formato esperado.' },
    };
  }
  const rawProperties = (value as { properties: unknown[] }).properties;
  const rawUnits = (value as { units: unknown[] }).units;

  const properties: PropertyEntry[] = [];
  const propertyIds = new Set<string>();
  for (const item of rawProperties) {
    if (
      !item ||
      typeof item !== 'object' ||
      !isNonEmptyString((item as Record<string, unknown>).propertyId) ||
      !hasString(item as Record<string, unknown>, 'projetoId') ||
      !hasString(item as Record<string, unknown>, 'name')
    ) {
      return { ok: false, erro: { motivo: 'formato', detalhe: 'Uma propriedade tem formato inesperado.' } };
    }
    const property = item as PropertyEntry;
    if (property.projetoId !== projetoId) {
      return {
        ok: false,
        erro: { motivo: 'projeto_misto', detalhe: 'O conjunto recebido contém uma propriedade de outro projeto.' },
      };
    }
    if (propertyIds.has(property.propertyId)) {
      return {
        ok: false,
        erro: { motivo: 'propriedade_duplicada', detalhe: 'Uma propriedade aparece mais de uma vez no conjunto.' },
      };
    }
    propertyIds.add(property.propertyId);
    // Cópia defensiva: nunca empurra o objeto bruto `property` (que pode
    // trazer campos extras do que o integrador enviou) para o dataset
    // validado — só os campos declarados de PropertyEntry são copiados.
    // Isso garante que mutar o resultado depois nunca altera a entrada
    // original, e que um campo extra nunca atravessa a validação.
    // propertyId é copiado exatamente como recebido (nunca renormalizado
    // após a checagem de duplicidade acima); name só é aparado para o
    // fallback visual já existente na tela ("Não informado"), nunca vira
    // exigência nova.
    properties.push({ propertyId: property.propertyId, projetoId: property.projetoId, name: property.name.trim() });
  }

  const units: UnitEntry[] = [];
  const unitIds = new Set<string>();
  for (const item of rawUnits) {
    if (
      !item ||
      typeof item !== 'object' ||
      !isNonEmptyString((item as Record<string, unknown>).unitId) ||
      !hasString(item as Record<string, unknown>, 'propertyId') ||
      !hasString(item as Record<string, unknown>, 'projetoId') ||
      !hasString(item as Record<string, unknown>, 'label')
    ) {
      return { ok: false, erro: { motivo: 'formato', detalhe: 'Uma unidade tem formato inesperado.' } };
    }
    const unit = item as UnitEntry;
    if (unit.projetoId !== projetoId) {
      return {
        ok: false,
        erro: { motivo: 'projeto_misto', detalhe: 'O conjunto recebido contém uma unidade de outro projeto.' },
      };
    }
    if (unitIds.has(unit.unitId)) {
      return {
        ok: false,
        erro: { motivo: 'unidade_duplicada', detalhe: 'Uma unidade aparece mais de uma vez no conjunto.' },
      };
    }
    unitIds.add(unit.unitId);
    // Mesma cópia defensiva do lado de propriedades: nunca empurra o
    // objeto bruto `unit` para o dataset validado — só os campos
    // declarados de UnitEntry são copiados. unitId e propertyId ficam
    // exatamente como recebidos (propertyId precisa continuar idêntico ao
    // da propriedade correspondente para o vínculo abaixo continuar
    // funcionando); label só é aparado para o fallback visual.
    units.push({
      unitId: unit.unitId,
      propertyId: unit.propertyId,
      projetoId: unit.projetoId,
      label: unit.label.trim(),
    });
  }

  // Checado por último: nesta altura toda propriedade e unidade restante já
  // é confirmada deste mesmo projeto, então uma referência válida aqui
  // também já garante "do mesmo projeto" — sem checagem extra duplicada.
  for (const unit of units) {
    if (!propertyIds.has(unit.propertyId)) {
      return {
        ok: false,
        erro: {
          motivo: 'unidade_sem_propriedade',
          detalhe: 'Uma unidade referencia uma propriedade que não existe neste conjunto.',
        },
      };
    }
  }

  return { ok: true, dataset: { properties, units } };
}
