import { useMemo } from 'react';
import { OS_STAGES, calcularIndicadores, formatarInstante, validarConjunto } from './model';

/**
 * Estado discriminado desta fatia. `orders` é `unknown` de propósito: este
 * componente nunca assume que quem o integra já validou o conjunto — ele
 * mesmo rejeita projeto misto, OsId duplicada ou status inválido antes de
 * calcular qualquer indicador. `not_integrated` é um estado À PARTE de
 * `ready` com zero OS: zero é um número real da fonte e é sempre exibido
 * como tal, nunca escondido atrás de uma mensagem de "sem integração".
 */
export type OsIndicatorsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not_integrated' }
  | { kind: 'ready'; orders: unknown; carregadoEm: string | null };

export interface OsIndicatorsProps {
  projetoId: string;
  state: OsIndicatorsState;
}

/**
 * Componente puro: tudo que mostra vem só de `props` neste render, sem
 * `useState`/`useEffect` próprios. Ao trocar de `state.kind` a tela
 * anterior inteira desaparece — nunca ficam números de um estado anterior
 * sobrepostos ao novo (loading/error/not_integrated nunca mostram dados).
 * Reutiliza somente classes CSS já existentes em src/central/App.css
 * (panel, panel-title, kpis, kpi-symbol, bar-row, muted, alert, empty) —
 * nenhum CSS novo é criado aqui.
 */
export default function OsIndicators({ projetoId, state }: OsIndicatorsProps) {
  const resultado = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return validarConjunto(state.orders, projetoId);
  }, [state, projetoId]);

  if (state.kind === 'loading') {
    return (
      <section className="panel" aria-label="Indicadores de OS" aria-busy="true">
        <p role="status">Consultando indicadores…</p>
      </section>
    );
  }

  if (state.kind === 'not_integrated') {
    return (
      <section className="panel" aria-label="Indicadores de OS">
        <div className="empty">
          <span>○</span>
          <h2>Indicadores ainda não integrados</h2>
          <p>
            Este projeto ainda não tem uma fonte autenticada ligada aos indicadores. Nenhum número é
            estimado enquanto isso não for confirmado.
          </p>
        </div>
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="panel" aria-label="Indicadores de OS">
        <p role="alert" className="alert">
          {state.message}
        </p>
      </section>
    );
  }

  // state.kind === 'ready'
  if (!resultado || !resultado.ok) {
    const detalhe = resultado && !resultado.ok ? resultado.erro.detalhe : 'Conjunto de OS inválido.';
    return (
      <section className="panel" aria-label="Indicadores de OS">
        <p role="alert" className="alert">
          Indicadores não exibidos: {detalhe} Recarregue a lista de OS antes de tentar novamente.
        </p>
      </section>
    );
  }

  const indicadores = calcularIndicadores(resultado.ordens);
  const maiorEstagio = Math.max(1, ...OS_STAGES.map((stage) => indicadores.porEstagio[stage]));

  return (
    <section className="panel" aria-label="Indicadores de OS">
      <div className="panel-title">
        <h2>Indicadores de OS</h2>
        <small>{indicadores.total} OS neste projeto</small>
      </div>
      {indicadores.total === 0 && (
        <p className="muted">Nenhuma OS registrada neste projeto até o momento.</p>
      )}
      <div className="kpis">
        <article>
          <div className="kpi-symbol">☷</div>
          <span>Total</span>
          <strong>{indicadores.total}</strong>
          <small>OS no projeto</small>
        </article>
        <article>
          <div className="kpi-symbol">◷</div>
          <span>Abertas</span>
          <strong>{indicadores.abertas}</strong>
          <small>ainda não concluídas</small>
        </article>
        <article>
          <div className="kpi-symbol">✓</div>
          <span>Concluídas</span>
          <strong>{indicadores.concluidas}</strong>
          <small>etapa Concluída</small>
        </article>
        <article>
          <div className="kpi-symbol">▤</div>
          <span>Sem responsável</span>
          <strong>{indicadores.semResponsavelAbertas}</strong>
          <small>entre as abertas</small>
        </article>
      </div>
      <h3>Por etapa</h3>
      {OS_STAGES.map((stage) => (
        <div className="bar-row" key={stage}>
          <span>{stage}</span>
          <div>
            <i style={{ width: `${(indicadores.porEstagio[stage] / maiorEstagio) * 100}%` }} />
          </div>
          <strong>{indicadores.porEstagio[stage]}</strong>
        </div>
      ))}
      <p className="muted">
        Atualizado na fonte: {formatarInstante(indicadores.atualizadoEmFonte)} · Consultado nesta tela
        em: {formatarInstante(state.carregadoEm)}
      </p>
    </section>
  );
}
