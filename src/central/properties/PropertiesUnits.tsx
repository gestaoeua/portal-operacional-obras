import { useMemo, useState } from 'react';
import { validarConjunto } from './model';

/**
 * Estado discriminado desta fatia. `dataset` é `unknown` de propósito: o
 * componente nunca assume que quem o integra já validou o conjunto — ele
 * mesmo rejeita formato inesperado, projeto misto, ID duplicado ou unidade
 * sem propriedade antes de renderizar qualquer linha. `not_integrated` é o
 * estado padrão: até existir uma fonte real, é isto que deve ser passado
 * (ver integração em src/central/App.tsx, fora desta fatia). Um dataset
 * `ready` vazio ({properties:[],units:[]}) só deve ocorrer quando uma fonte
 * explícita e válida de fato confirmou "nenhum registro" — nunca como
 * substituto de not_integrated.
 */
export type PropertiesUnitsState =
  | { kind: 'not_integrated' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; dataset: unknown };

export interface PropertiesUnitsProps {
  projetoId: string;
  state?: PropertiesUnitsState;
}

/**
 * Componente puro: tudo que mostra vem de `props` neste render — o único
 * estado próprio é o texto de busca (interação de tela, não dado). Nunca
 * busca dados, nunca persiste nada, nunca cria cadastro, nunca usa `Salas`
 * nem converte `projetoId` em propriedade. Reutiliza só classes já
 * existentes em src/central/App.css (panel, panel-title, table-scroll,
 * empty, accent, muted) — nenhum CSS novo é criado aqui.
 */
export default function PropertiesUnits({
  projetoId,
  state = { kind: 'not_integrated' },
}: PropertiesUnitsProps) {
  const [search, setSearch] = useState('');
  const resultado = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return validarConjunto(state.dataset, projetoId);
  }, [state, projetoId]);

  if (state.kind === 'loading') {
    return (
      <section className="panel" aria-label="Locais e unidades" aria-busy="true">
        <p role="status">Consultando locais e unidades…</p>
      </section>
    );
  }

  if (state.kind === 'not_integrated') {
    return (
      <section className="panel" aria-label="Locais e unidades">
        <div className="empty">
          <span>○</span>
          <h2>Locais e unidades ainda não integrados</h2>
          <p>
            Este projeto ainda não tem uma fonte autenticada de propriedades e unidades. Nenhum
            cadastro é criado nem estimado aqui.
          </p>
        </div>
      </section>
    );
  }

  if (state.kind === 'error') {
    // Nunca renderiza `state.message` diretamente: é texto que pode vir do
    // backend/integração e não é confiável para mostrar como está — mesmo
    // princípio já adotado em src/central/catalogs/TeamsServices.tsx. A
    // tela sempre mostra uma mensagem genérica e segura, qualquer que seja
    // o conteúdo recebido.
    return (
      <section className="panel" aria-label="Locais e unidades">
        <p role="alert" className="alert">
          Não foi possível consultar locais e unidades agora. Tente novamente mais tarde.
        </p>
      </section>
    );
  }

  // state.kind === 'ready'
  if (!resultado || !resultado.ok) {
    const detalhe = resultado && !resultado.ok ? resultado.erro.detalhe : 'Conjunto de locais e unidades inválido.';
    return (
      <section className="panel" aria-label="Locais e unidades">
        <p role="alert" className="alert">
          Locais e unidades não exibidos: {detalhe}
        </p>
      </section>
    );
  }

  const { properties, units } = resultado.dataset;
  const termo = search.trim().toLocaleLowerCase();
  const unidadesPorPropriedade = new Map<string, number>();
  units.forEach((u) => unidadesPorPropriedade.set(u.propertyId, (unidadesPorPropriedade.get(u.propertyId) || 0) + 1));
  const nomePropriedadePorId = new Map(properties.map((p) => [p.propertyId, p.name]));

  const propriedadesFiltradas = properties.filter(
    (p) => !termo || `${p.propertyId} ${p.name}`.toLocaleLowerCase().includes(termo),
  );
  const unidadesFiltradas = units.filter((u) => {
    if (!termo) return true;
    const nomePropriedade = nomePropriedadePorId.get(u.propertyId) || '';
    return `${u.unitId} ${u.label} ${nomePropriedade}`.toLocaleLowerCase().includes(termo);
  });

  return (
    <section className="panel" aria-label="Locais e unidades">
      <div className="panel-title">
        <h2>
          Locais e unidades <small>{properties.length}</small>
        </h2>
        <input
          aria-label="Buscar propriedade ou unidade"
          placeholder="Buscar propriedade ou unidade"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {properties.length === 0 && units.length === 0 ? (
        <div className="empty">
          <span>○</span>
          <h2>Nenhuma propriedade registrada neste projeto</h2>
          <p>A fonte confirmou que este projeto ainda não tem propriedades nem unidades.</p>
        </div>
      ) : (
        <>
          <h3>Propriedades</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Propriedade</th>
                  <th>ID</th>
                  <th>Unidades</th>
                </tr>
              </thead>
              <tbody>
                {propriedadesFiltradas.map((p) => (
                  <tr key={p.propertyId}>
                    <td>{p.name || 'Não informado'}</td>
                    <td className="accent">{p.propertyId}</td>
                    <td>{unidadesPorPropriedade.get(p.propertyId) || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!propriedadesFiltradas.length && (
              <p className="muted">Nenhuma propriedade encontrada para esta busca.</p>
            )}
          </div>
          <h3>Unidades</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>ID</th>
                  <th>Propriedade</th>
                </tr>
              </thead>
              <tbody>
                {unidadesFiltradas.map((u) => (
                  <tr key={u.unitId}>
                    <td>{u.label || 'Não informado'}</td>
                    <td className="accent">{u.unitId}</td>
                    <td>{nomePropriedadePorId.get(u.propertyId) || 'Não informado'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!unidadesFiltradas.length && (
              <p className="muted">Nenhuma unidade encontrada para esta busca.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
