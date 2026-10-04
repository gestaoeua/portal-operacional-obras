import { describe, expect, it } from 'vitest';
import {
  AutorizacaoProviderDemo,
  filtrarOrdensPorAutorizacao,
  resolverProjetosAutorizados,
} from '../authorization';
import type { OrdemServico } from '../types';

function ordem(os: string, projetoId?: string): OrdemServico {
  return {
    os,
    endereco: '',
    cidade: '',
    statusTexto: '',
    estado: 'NAO_INICIADA',
    escopo: '',
    protecoes: '',
    dependenciasObservacoes: '',
    evidenciasTexto: '',
    ultimaAtualizacao: '',
    isTeste: false,
    temEtapaAplicavel: false,
    aprovacaoQualidade: { resultado: 'pendente', semEvidencia: true },
    projetoId,
  };
}

describe('resolverProjetosAutorizados — exige vínculo explícito, inclusive com zero/um projeto', () => {
  it('sessão/usuário inexistente é bloqueada', async () => {
    const provider = new AutorizacaoProviderDemo([], []);
    const r = await resolverProjetosAutorizados('fulano', provider);
    expect(r.ok).toBe(false);
    expect(r.bloqueio).toBe('SESSAO_INVALIDA');
  });

  it('CORREÇÃO: com ZERO projetos ativos cadastrados, usuário sem a coluna ainda assim é BLOQUEADO (nunca libera por omissão)', async () => {
    const provider = new AutorizacaoProviderDemo([], [{ usuario: 'gestor-exemplo', perfil: 'gestor' }]);
    const r = await resolverProjetosAutorizados('gestor-exemplo', provider);
    expect(r.ok).toBe(false);
    expect(r.bloqueio).toBe('AUTORIZACAO_PROJETO_NAO_CONFIGURADA');
    expect(r.projetosAutorizados).toEqual([]);
  });

  it('CORREÇÃO: com apenas UM projeto ativo, usuário sem a coluna ainda assim é BLOQUEADO (a brecha da 1ª fatia foi removida)', async () => {
    const provider = new AutorizacaoProviderDemo(
      [{ projetoId: 'proj-A', ativo: true }],
      [{ usuario: 'gestor-exemplo', perfil: 'gestor' }] // sem projetosAutorizados
    );
    const r = await resolverProjetosAutorizados('gestor-exemplo', provider);
    expect(r.ok).toBe(false);
    expect(r.bloqueio).toBe('AUTORIZACAO_PROJETO_NAO_CONFIGURADA');
  });

  it('com a coluna presente (mesmo que só 1 projeto exista), autoriza exatamente o vínculo explícito', async () => {
    const provider = new AutorizacaoProviderDemo(
      [{ projetoId: 'proj-A', ativo: true }],
      [{ usuario: 'gestor-exemplo', perfil: 'gestor', projetosAutorizados: ['proj-A'] }]
    );
    const r = await resolverProjetosAutorizados('gestor-exemplo', provider);
    expect(r.ok).toBe(true);
    expect(r.projetosAutorizados).toEqual(['proj-A']);
  });

  it('vínculo explícito vazio ([]) é diferente de ausente: autoriza "nenhum", não bloqueia por falta de configuração', async () => {
    const provider = new AutorizacaoProviderDemo(
      [{ projetoId: 'proj-A', ativo: true }],
      [{ usuario: 'novato', perfil: 'gestor', projetosAutorizados: [] }]
    );
    const r = await resolverProjetosAutorizados('novato', provider);
    expect(r.ok).toBe(true);
    expect(r.bloqueio).toBeUndefined();
    expect(r.projetosAutorizados).toEqual([]);
  });

  it('acesso cruzado: autorizado só para proj-A nunca recebe proj-B, mesmo com múltiplos projetos ativos', async () => {
    const provider = new AutorizacaoProviderDemo(
      [
        { projetoId: 'proj-A', ativo: true },
        { projetoId: 'proj-B', ativo: true },
      ],
      [{ usuario: 'gestor-exemplo', perfil: 'gestor', projetosAutorizados: ['proj-A'] }]
    );
    const r = await resolverProjetosAutorizados('gestor-exemplo', provider);
    expect(r.projetosAutorizados).toEqual(['proj-A']);
    expect(r.projetosAutorizados).not.toContain('proj-B');
  });

  it('projeto inativo nunca é liberado mesmo se listado no vínculo do usuário', async () => {
    const provider = new AutorizacaoProviderDemo(
      [
        { projetoId: 'proj-A', ativo: true },
        { projetoId: 'proj-B', ativo: false },
      ],
      [{ usuario: 'gestor-exemplo', perfil: 'gestor', projetosAutorizados: ['proj-A', 'proj-B'] }]
    );
    const r = await resolverProjetosAutorizados('gestor-exemplo', provider);
    expect(r.projetosAutorizados).toEqual(['proj-A']);
  });
});

describe('filtrarOrdensPorAutorizacao — associação ausente nunca passa por padrão', () => {
  it('OS sem projetoId é excluída e contada em semProjetoAtribuido, nunca exibida por padrão', () => {
    const { autorizadas, semProjetoAtribuido } = filtrarOrdensPorAutorizacao(
      [ordem('OS-1', 'proj-A'), ordem('OS-2', undefined), ordem('OS-3', undefined)],
      ['proj-A']
    );
    expect(autorizadas.map((o) => o.os)).toEqual(['OS-1']);
    expect(semProjetoAtribuido).toBe(2);
  });

  it('acesso cruzado também é aplicado na filtragem de linhas, não só na resolução de usuário', () => {
    const { autorizadas } = filtrarOrdensPorAutorizacao(
      [ordem('OS-1', 'proj-A'), ordem('OS-2', 'proj-B')],
      ['proj-A']
    );
    expect(autorizadas.map((o) => o.os)).toEqual(['OS-1']);
  });

  it('lista de autorizados vazia exclui tudo, mesmo OS com projetoId válido', () => {
    const { autorizadas, semProjetoAtribuido } = filtrarOrdensPorAutorizacao([ordem('OS-1', 'proj-A')], []);
    expect(autorizadas).toEqual([]);
    expect(semProjetoAtribuido).toBe(0); // essa OS tem projetoId — é "não autorizada", não "sem associação"
  });
});
