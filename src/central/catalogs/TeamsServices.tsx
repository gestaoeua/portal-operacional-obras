import { useMemo, useState } from 'react';
import { validarConjunto } from './model';

export type TeamsServicesView = 'teams' | 'services';

/**
 * Estado discriminado desta fatia. `dataset` é `unknown` de propósito: o
 * componente nunca assume que quem o integra já validou o conjunto.
 * `not_integrated` é o estado padrão — até existir uma fonte real, é isto
 * que deve ser passado (integração fora desta fatia, em src/central/App.tsx).
 * Um dataset `ready` com listas vazias só deve ocorrer quando uma fonte
 * explícita e válida de fato confirmou "nenhum registro" — nunca como
 * substituto de not_integrated.
 */
export type TeamsServicesState =
  | { kind: 'not_integrated' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; dataset: unknown };

export interface TeamsServicesProps {
  projetoId: string;
  state?: TeamsServicesState;
  /**
   * Quando fornecida, CONTROLA a view exibida (ex.: rotas separadas
   * /equipes e /servicos) e o alternador interno não é renderizado — quem
   * integra decide a navegação, este componente só obedece. Quando
   * ausente, preserva o comportamento de antes: alternador próprio,
   * começando em "teams".
   */
  view?: TeamsServicesView;
}

/**
 * Componente puro: tudo que mostra vem de `props` neste render — os únicos
 * estados próprios são a aba selecionada (teams/services) e o texto de
 * busca, ambos interação de tela, nunca dado. Nunca busca dados, nunca
 * persiste nada, nunca trata `Usuarios` como equipe nem `WorkAction` como
 * catálogo de serviço. Reutiliza só classes já existentes em
 * src/central/App.css (panel, panel-title, filters, table-scroll, empty,
 * accent, muted) — nenhum CSS novo é criado aqui.
 */
export default function TeamsServices({
  projetoId,
  state = { kind: 'not_integrated' },
  view: viewProp,
}: TeamsServicesProps) {
  const [internalView, setInternalView] = useState<TeamsServicesView>('teams');
  const controlada = viewProp !== undefined;
  const view = controlada ? viewProp : internalView;
  const [search, setSearch] = useState('');
  const resultado = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return validarConjunto(state.dataset, projetoId);
  }, [state, projetoId]);

  if (state.kind === 'loading') {
    return (
      <section className="panel" aria-label="Equipes e serviços" aria-busy="true">
        <p role="status">Consultando equipes e serviços…</p>
      </section>
    );
  }

  if (state.kind === 'not_integrated') {
    return (
      <section className="panel" aria-label="Equipes e serviços">
        <div className="empty">
          <span>○</span>
          <h2>Equipes e serviços ainda não integrados</h2>
          <p>
            Este projeto ainda não tem uma fonte autenticada de equipes e serviços. Nenhum cadastro é
            criado nem estimado aqui.
          </p>
        </div>
      </section>
    );
  }

  if (state.kind === 'error') {
    // Nunca renderiza `state.message` diretamente: é texto que pode vir do
    // backend/integração e não é confiável para mostrar como está. A tela
    // sempre mostra uma mensagem genérica e segura, qualquer que seja o
    // conteúdo recebido.
    return (
      <section className="panel" aria-label="Equipes e serviços">
        <p role="alert" className="alert">
          Não foi possível consultar equipes e serviços agora. Tente novamente mais tarde.
        </p>
      </section>
    );
  }

  // state.kind === 'ready'
  if (!resultado || !resultado.ok) {
    const detalhe = resultado && !resultado.ok ? resultado.erro.detalhe : 'Conjunto de equipes e serviços inválido.';
    return (
      <section className="panel" aria-label="Equipes e serviços">
        <p role="alert" className="alert">
          Equipes e serviços não exibidos: {detalhe}
        </p>
      </section>
    );
  }

  const { teams, services } = resultado.dataset;
  const termo = search.trim().toLocaleLowerCase();
  const equipesFiltradas = teams.filter((t) => {
    if (!termo) return true;
    const membros = t.members.map((m) => m.name).join(' ');
    return `${t.teamId} ${t.name} ${membros}`.toLocaleLowerCase().includes(termo);
  });
  const servicosFiltrados = services.filter((s) => {
    if (!termo) return true;
    return `${s.serviceId} ${s.name} v${s.version} ${s.description}`.toLocaleLowerCase().includes(termo);
  });

  return (
    <section className="panel" aria-label="Equipes e serviços">
      <div className="panel-title">
        <h2>Equipes e serviços</h2>
        <input
          aria-label="Buscar equipe ou serviço"
          placeholder="Buscar equipe ou serviço"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!controlada && (
        <div className="filters">
          <button aria-pressed={view === 'teams'} onClick={() => setInternalView('teams')}>
            Equipes
          </button>
          <button aria-pressed={view === 'services'} onClick={() => setInternalView('services')}>
            Serviços
          </button>
        </div>
      )}
      {view === 'teams' ? (
        teams.length === 0 ? (
          <div className="empty">
            <span>○</span>
            <h2>Nenhuma equipe registrada neste projeto</h2>
            <p>A fonte confirmou que este projeto ainda não tem equipes cadastradas.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Equipe</th>
                  <th>ID</th>
                  <th>Membros</th>
                </tr>
              </thead>
              <tbody>
                {equipesFiltradas.map((t) => (
                  <tr key={t.teamId}>
                    <td>{t.name || 'Não informado'}</td>
                    <td className="accent">{t.teamId}</td>
                    <td>{t.members.length ? t.members.map((m) => m.name || 'Nao informado').join(', ') : 'Sem membros cadastrados'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!equipesFiltradas.length && <p className="muted">Nenhuma equipe encontrada para esta busca.</p>}
          </div>
        )
      ) : services.length === 0 ? (
        <div className="empty">
          <span>○</span>
          <h2>Nenhum serviço registrado neste projeto</h2>
          <p>A fonte confirmou que este projeto ainda não tem serviços cadastrados.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Serviço</th>
                <th>Versão</th>
                <th>ID</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {servicosFiltrados.map((s) => (
                <tr key={`${s.serviceId}::${s.version}`}>
                  <td>{s.name || 'Não informado'}</td>
                  <td className="accent">v{s.version}</td>
                  <td className="accent">{s.serviceId}</td>
                  <td>{s.description || 'Não informado'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!servicosFiltrados.length && <p className="muted">Nenhum serviço encontrado para esta busca.</p>}
        </div>
      )}
    </section>
  );
}
