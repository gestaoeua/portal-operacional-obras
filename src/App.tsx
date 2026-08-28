import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiConfigError, loadRooms } from './api';
import type { Room, Status } from './types';
import { STATUS_CLASS, STATUS_LABEL, STATUS_ORDER } from './types';
import './App.css';

type LoadState = 'loading' | 'ready' | 'error';

const SUMMARY_TILES: Array<{ key: 'all' | Status; label: string }> = [
  { key: 'all', label: 'Total de áreas' },
  { key: 'finalizado', label: 'Finalizados' },
  { key: 'em_andamento', label: 'Em andamento' },
  { key: 'touch_up', label: 'Touch-up' },
  { key: 'pendente', label: 'Pendentes' },
  { key: 'nao_cadastrada', label: 'Não cadastradas' },
];

function formatTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function App() {
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [isConfigError, setIsConfigError] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sheetUpdatedAt, setSheetUpdatedAt] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const [filter, setFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [selectedMark, setSelectedMark] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setState('loading');
    setErrorMessage('');
    setIsConfigError(false);
    try {
      const { rooms: loaded, updatedAt } = await loadRooms();
      setRooms(loaded);
      setSheetUpdatedAt(updatedAt);
      setLoadedAt(new Date());
      setState('ready');
    } catch (err) {
      setIsConfigError(err instanceof ApiConfigError);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar os dados do painel agora.'
      );
      setState('error');
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const mapped = useMemo(() => rooms.filter((r) => r.x !== undefined && r.y !== undefined), [rooms]);
  const unmapped = useMemo(() => rooms.filter((r) => r.x === undefined || r.y === undefined), [rooms]);

  const visible = useMemo(
    () =>
      mapped.filter(
        (r) =>
          (filter === 'all' || r.status === filter) &&
          `${r.mark} ${r.name} ${r.service}`.toLowerCase().includes(query.toLowerCase())
      ),
    [mapped, filter, query]
  );

  const visibleUnmapped = useMemo(
    () =>
      unmapped.filter(
        (r) =>
          (filter === 'all' || r.status === filter) &&
          `${r.mark} ${r.name} ${r.service}`.toLowerCase().includes(query.toLowerCase())
      ),
    [unmapped, filter, query]
  );

  const selected = useMemo(
    () => rooms.find((r) => r.mark === selectedMark) ?? null,
    [rooms, selectedMark]
  );

  const countAll = rooms.length;
  const countBy = (s: Status) => rooms.filter((r) => r.status === s).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">GESTÃO À VISTA • PINTURA</span>
          <h1>Mapa de Progresso</h1>
          <p>
            {state === 'error'
              ? 'Não foi possível atualizar os dados agora.'
              : sheetUpdatedAt
              ? `Última atualização na planilha: ${sheetUpdatedAt}`
              : loadedAt
              ? `Dados carregados em ${formatTime(loadedAt)}`
              : 'Carregando dados...'}
            {loadedAt && state !== 'error' && (
              <span className="loaded-at"> · Painel consultado em {formatTime(loadedAt)}</span>
            )}
          </p>
        </div>
        <div className="legend">
          {STATUS_ORDER.map((s) => (
            <span key={s}>
              <i className={`dot ${STATUS_CLASS[s]}`} />
              {STATUS_LABEL[s]}
            </span>
          ))}
        </div>
      </header>

      <section className="summary">
        {SUMMARY_TILES.map((tile) => {
          const value = tile.key === 'all' ? countAll : countBy(tile.key);
          const pct = countAll > 0 ? Math.round((value / countAll) * 100) : 0;
          const cls = tile.key === 'all' ? '' : STATUS_CLASS[tile.key];
          return (
            <button
              key={tile.key}
              type="button"
              className={`${cls} ${filter === tile.key ? 'active' : ''}`}
              onClick={() => setFilter(tile.key)}
            >
              <span>{tile.label}</span>
              <strong>{value}</strong>
              <small>{tile.key === 'all' ? '100% mapeado' : `${pct}% do total`}</small>
            </button>
          );
        })}
      </section>

      <section className="workspace">
        <div className="map-card">
          <div className="tools">
            <label>
              <span>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar MARK, sala ou serviço"
                aria-label="Buscar MARK, sala ou serviço"
              />
            </label>
            <div className="filter-row">
              <button
                type="button"
                className={filter === 'all' ? 'on' : ''}
                onClick={() => setFilter('all')}
              >
                Todos
              </button>
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={filter === s ? 'on' : ''}
                  onClick={() => setFilter(s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="zoom">
              <button type="button" onClick={() => setZoom((z) => Math.max(0.65, z - 0.15))} aria-label="Diminuir zoom">
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))} aria-label="Aumentar zoom">
                +
              </button>
            </div>
          </div>

          <div className="map-viewport">
            {state === 'loading' && (
              <div className="status-card">
                <div className="spinner" aria-hidden="true" />
                <p>Carregando dados do painel…</p>
              </div>
            )}

            {state === 'error' && (
              <div className="status-card error">
                <p className="status-card-title">
                  {isConfigError ? 'Painel ainda não configurado' : 'Não foi possível carregar os dados'}
                </p>
                <p>{errorMessage}</p>
                {!isConfigError && (
                  <button type="button" onClick={fetchData} className="retry-btn">
                    Tentar novamente
                  </button>
                )}
              </div>
            )}

            {state === 'ready' && (
              <div className="map-stage" style={{ transform: `scale(${zoom})` }}>
                <img
                  src={`${import.meta.env.BASE_URL}floor-plan.png`}
                  alt="Planta baixa do projeto com salas identificadas"
                />
                {visible.map((r) => (
                  <button
                    key={r.mark}
                    type="button"
                    className={`marker ${STATUS_CLASS[r.status]} ${selected?.mark === r.mark ? 'selected' : ''}`}
                    style={{ left: `${r.x}%`, top: `${r.y}%` }}
                    onClick={() => setSelectedMark(r.mark)}
                    aria-label={`${r.mark} ${r.name}`}
                  >
                    <span>{r.mark}</span>
                  </button>
                ))}
                {!visible.length && <div className="empty">Nenhuma sala corresponde ao filtro.</div>}
              </div>
            )}
          </div>
        </div>

        <aside className="detail">
          {selected ? (
            <>
              <div className="detail-head">
                <div>
                  <span>ÁREA SELECIONADA</span>
                  <h2>{selected.mark}</h2>
                </div>
                <i className={`status-pill ${STATUS_CLASS[selected.status]}`}>
                  {STATUS_LABEL[selected.status]}
                </i>
              </div>
              <h3>{selected.name || 'Sem nome cadastrado'}</h3>
              <dl>
                <div>
                  <dt>MARK</dt>
                  <dd>{selected.mark}</dd>
                </div>
                <div>
                  <dt>Serviço a fazer</dt>
                  <dd>{selected.service || '—'}</dd>
                </div>
                <div>
                  <dt>Identificada em campo</dt>
                  <dd>{selected.identified ? 'Sim' : 'Não'}</dd>
                </div>
                <div>
                  <dt>Última atualização</dt>
                  <dd>{selected.updatedAt || '—'}</dd>
                </div>
                <div>
                  <dt>Observação</dt>
                  <dd>{selected.note || 'Sem observações.'}</dd>
                </div>
              </dl>
              <div className="readonly-note">
                <p>👁 Painel somente leitura. A edição é feita diretamente na planilha por pessoas autorizadas.</p>
              </div>
            </>
          ) : (
            <div className="placeholder">
              <p>Clique em um marcador no mapa ou em um item da lista para ver os detalhes da sala.</p>
            </div>
          )}

          <div className="quick-list">
            <h4>
              Áreas exibidas <span>{visible.length}</span>
            </h4>
            {visible.slice(0, 8).map((r) => (
              <button key={r.mark} type="button" onClick={() => setSelectedMark(r.mark)}>
                <i className={`dot ${STATUS_CLASS[r.status]}`} />
                <span>
                  <b>{r.mark}</b>
                  {r.name}
                </span>
                <em>›</em>
              </button>
            ))}
          </div>

          {visibleUnmapped.length > 0 && (
            <div className="quick-list unmapped">
              <h4>
                Sem marcação no mapa <span>{visibleUnmapped.length}</span>
              </h4>
              <p className="unmapped-hint">
                Estas salas estão cadastradas na planilha, mas ainda não têm PosicaoX/PosicaoY definidos.
              </p>
              {visibleUnmapped.map((r) => (
                <button key={r.mark} type="button" onClick={() => setSelectedMark(r.mark)}>
                  <i className={`dot ${STATUS_CLASS[r.status]}`} />
                  <span>
                    <b>{r.mark}</b>
                    {r.name}
                  </span>
                  <em>›</em>
                </button>
              ))}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
