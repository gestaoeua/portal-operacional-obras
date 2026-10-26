import { describe, expect, it } from 'vitest';
import { validarConjunto, type ServiceEntry, type TeamEntry } from './model';

const PROJ = 'proj-1';

function equipe(partial: Partial<TeamEntry> & { teamId: string }): TeamEntry {
  return { projetoId: PROJ, name: 'Equipe Norte', members: [], ...partial };
}
function servico(partial: Partial<ServiceEntry> & { serviceId: string; version: number }): ServiceEntry {
  return { projetoId: PROJ, name: 'Pintura interna', description: 'Pintura de paredes internas', ...partial };
}

describe('validarConjunto', () => {
  it('aceita dataset vazio autenticado como válido (estado vazio explícito)', () => {
    const resultado = validarConjunto({ teams: [], services: [] }, PROJ);
    expect(resultado).toEqual({ ok: true, dataset: { teams: [], services: [] } });
  });

  it('aceita equipes com membros e serviços válidos do mesmo projeto', () => {
    const dataset = {
      teams: [
        equipe({ teamId: 't1', members: [{ memberId: 'm1', name: 'Ana' }, { memberId: 'm2', name: 'Bruno' }] }),
      ],
      services: [servico({ serviceId: 's1', version: 1 })],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dataset.teams[0].members.length).toBe(2);
      expect(resultado.dataset.services.length).toBe(1);
    }
  });

  it('aceita versões distintas do mesmo serviceId como entradas separadas (chave composta)', () => {
    const dataset = {
      teams: [],
      services: [servico({ serviceId: 's1', version: 1 }), servico({ serviceId: 's1', version: 2 })],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dataset.services.length).toBe(2);
  });

  it('rejeita formato inesperado', () => {
    expect(validarConjunto(null, PROJ).ok).toBe(false);
    expect(validarConjunto({ teams: [] }, PROJ).ok).toBe(false);
    expect(validarConjunto({ teams: 'x', services: [] }, PROJ).ok).toBe(false);
    const resultado = validarConjunto({ teams: [{ teamId: 't1' }], services: [] }, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('formato');
  });

  it('rejeita equipe de outro projeto, sem revelar o ID da linha', () => {
    const dataset = {
      teams: [equipe({ teamId: 't1' }), equipe({ teamId: 'equipe-sigilosa-outro-projeto', projetoId: 'outro-projeto' })],
      services: [],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro.motivo).toBe('projeto_misto');
      expect(resultado.erro.detalhe).not.toContain('equipe-sigilosa-outro-projeto');
    }
  });

  it('rejeita serviço de outro projeto, sem revelar o ID da linha', () => {
    const dataset = {
      teams: [],
      services: [servico({ serviceId: 'servico-sigiloso-outro-projeto', version: 1, projetoId: 'outro-projeto' })],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro.motivo).toBe('projeto_misto');
      expect(resultado.erro.detalhe).not.toContain('servico-sigiloso-outro-projeto');
    }
  });

  it('rejeita TeamId duplicada', () => {
    const dataset = { teams: [equipe({ teamId: 'dup' }), equipe({ teamId: 'dup' })], services: [] };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('equipe_duplicada');
  });

  it('rejeita membro duplicado dentro da mesma equipe', () => {
    const dataset = {
      teams: [equipe({ teamId: 't1', members: [{ memberId: 'm1', name: 'Ana' }, { memberId: 'm1', name: 'Ana (outra entrada)' }] })],
      services: [],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('membro_duplicado_na_equipe');
  });

  it('aceita o MESMO memberId em equipes diferentes (duplicidade só é checada dentro da mesma equipe)', () => {
    const dataset = {
      teams: [
        equipe({ teamId: 't1', members: [{ memberId: 'm1', name: 'Ana' }] }),
        equipe({ teamId: 't2', members: [{ memberId: 'm1', name: 'Ana' }] }),
      ],
      services: [],
    };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(true);
  });

  it('rejeita versão de serviço que não é inteiro positivo', () => {
    const casos = [0, -1, 1.5, Number.NaN];
    for (const version of casos) {
      const resultado = validarConjunto({ teams: [], services: [servico({ serviceId: 's1', version })] }, PROJ);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.erro.motivo).toBe('versao_invalida');
    }
  });

  it('rejeita versão fora da faixa de inteiro seguro (Number.isSafeInteger, não só Number.isInteger)', () => {
    const inseguro = Number.MAX_SAFE_INTEGER + 2; // ainda Number.isInteger, mas não isSafeInteger
    const resultado = validarConjunto({ teams: [], services: [servico({ serviceId: 's1', version: inseguro })] }, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('versao_invalida');
  });

  it('rejeita teamId, memberId e serviceId só com espaços (whitespace-only não é um ID válido)', () => {
    const r1 = validarConjunto({ teams: [equipe({ teamId: '   ' })], services: [] }, PROJ);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.erro.motivo).toBe('formato');

    const r2 = validarConjunto(
      { teams: [equipe({ teamId: 't1', members: [{ memberId: '   ', name: 'Ana' }] })], services: [] },
      PROJ,
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.erro.motivo).toBe('formato');

    const r3 = validarConjunto({ teams: [], services: [servico({ serviceId: '   ', version: 1 })] }, PROJ);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.erro.motivo).toBe('formato');
  });

  it('nunca repassa a referência original: mutar o dataset retornado não altera a entrada recebida', () => {
    const entrada = {
      teams: [equipe({ teamId: 't1', members: [{ memberId: 'm1', name: 'Ana' }] })],
      services: [servico({ serviceId: 's1', version: 1 })],
    };
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    resultado.dataset.teams[0].name = 'Nome alterado só na cópia';
    resultado.dataset.teams[0].members[0].name = 'Membro alterado só na cópia';
    resultado.dataset.services[0].name = 'Serviço alterado só na cópia';
    expect(entrada.teams[0].name).toBe('Equipe Norte');
    expect(entrada.teams[0].members[0].name).toBe('Ana');
    expect(entrada.services[0].name).toBe('Pintura interna');
  });

  it('copia só os campos declarados: um campo extra em equipe, membro ou serviço nunca atravessa a validação', () => {
    const entrada = {
      teams: [
        {
          teamId: 't1',
          projetoId: PROJ,
          name: 'Equipe Norte',
          members: [{ memberId: 'm1', name: 'Ana', cargoInterno: 'segredo-nao-deveria-vazar' }],
          campoSecretoDaEquipe: 'segredo-nao-deveria-vazar',
        },
      ],
      services: [{ ...servico({ serviceId: 's1', version: 1 }), custoInternoNaoDeveriaVazar: 999 }],
    };
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(Object.keys(resultado.dataset.teams[0]).sort()).toEqual(['members', 'name', 'projetoId', 'teamId']);
    expect(Object.keys(resultado.dataset.teams[0].members[0]).sort()).toEqual(['memberId', 'name']);
    expect(Object.keys(resultado.dataset.services[0]).sort()).toEqual([
      'description',
      'name',
      'projetoId',
      'serviceId',
      'version',
    ]);
  });

  it('IDs nunca são renormalizados na cópia; name/description só são aparados (trim) para fallback visual', () => {
    const entrada = {
      teams: [
        {
          teamId: 't1',
          projetoId: PROJ,
          name: '  Equipe Norte  ',
          members: [{ memberId: 'm1', name: '  Ana  ' }],
        },
      ],
      services: [{ ...servico({ serviceId: 's1', version: 1, name: '  Pintura  ', description: '  Interna  ' }) }],
    };
    const resultado = validarConjunto(entrada, PROJ);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // IDs idênticos aos recebidos, char a char — nunca aparados.
    expect(resultado.dataset.teams[0].teamId).toBe('t1');
    expect(resultado.dataset.teams[0].members[0].memberId).toBe('m1');
    expect(resultado.dataset.services[0].serviceId).toBe('s1');
    // name/description aparados — só para habilitar o fallback visual já
    // existente na tela, nunca uma exigência nova (string vazia continua
    // um dataset válido, como os testes de formato acima confirmam).
    expect(resultado.dataset.teams[0].name).toBe('Equipe Norte');
    expect(resultado.dataset.teams[0].members[0].name).toBe('Ana');
    expect(resultado.dataset.services[0].name).toBe('Pintura');
    expect(resultado.dataset.services[0].description).toBe('Interna');
  });

  it('rejeita (serviceId, version) repetidos — a mesma versão do mesmo serviço duas vezes', () => {
    const dataset = { teams: [], services: [servico({ serviceId: 's1', version: 1 }), servico({ serviceId: 's1', version: 1 })] };
    const resultado = validarConjunto(dataset, PROJ);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro.motivo).toBe('servico_versao_duplicada');
  });

  it('rejeita projeto vazio/inválido como parâmetro', () => {
    expect(validarConjunto({ teams: [], services: [] }, '').ok).toBe(false);
  });
});
