import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./transport";
import { loadTodayAttendance, type TodayAttendance } from "./whoIsWorkingApi";
import WorkCharts from "./WorkCharts";

const TZ = "America/New_York";
const AUTO_REFRESH_MS = 2 * 60 * 1000;
const LONG_DAY_MINUTES = 10 * 60;

function clock(iso: string) {
  const d = new Date(iso);
  return iso && Number.isFinite(d.getTime())
    ? d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
    : "—";
}
function minutesSince(iso: string, now: number) {
  const start = Date.parse(iso);
  return Number.isFinite(start) && now >= start ? Math.floor((now - start) / 60000) : null;
}
function hm(minutes: number | null) {
  return minutes === null ? "—" : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}min`;
}
function longDate(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** Ponto de hoje, com atualização automática; compartilhado pela página e pela Visão geral. */
export function useTodayAttendance(token: string, revision: number, onExpired: () => void) {
  const [data, setData] = useState<TodayAttendance | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [now, setNow] = useState(Date.now());
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const result = await loadTodayAttendance(token);
      if (id !== request.current) return;
      setData(result);
      setError("");
      setNow(Date.now());
    } catch (e) {
      if (id !== request.current) return;
      if (e instanceof ApiError && ["SESSION_EXPIRED", "UNAUTHORIZED", "AUTH_REQUIRED"].includes(e.code)) return onExpired();
      setError(e instanceof Error ? e.message : "Não foi possível consultar o ponto de hoje.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [token, onExpired]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, AUTO_REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { request.current++; clearInterval(refresh); clearInterval(tick); };
  }, [load, revision]);
  return { data, error, loading, now };
}

export default function WhoIsWorking({ token, revision, onExpired }: { token: string; revision: number; onExpired: () => void }) {
  const { data, error, loading, now } = useTodayAttendance(token, revision, onExpired);
  if (!data)
    return (
      <section className="panel">
        {error ? <p role="alert" className="alert">{error}</p> : null}
        <div className="empty">
          <span>○</span>
          <h2>{loading ? "Consultando o QuickBooks Time" : "Ponto de hoje indisponível"}</h2>
          <p>{loading ? "Aguarde a confirmação do servidor." : "Tente atualizar. Nenhum dado de demonstração é utilizado."}</p>
        </div>
      </section>
    );

  const working = data.trabalhando;
  const sites = new Map<string, number>();
  working.forEach((w) => sites.set(w.obra || "Sem obra informada", (sites.get(w.obra || "Sem obra informada") || 0) + 1));
  const bySite = [...sites].sort((a, b) => b[1] - a[1]);
  const max = bySite[0]?.[1] || 1;
  const long = working.filter((w) => (minutesSince(w.entrada, now) ?? 0) >= LONG_DAY_MINUTES);
  const first = working[0];

  return (
    <>
      {error && <p role="alert" className="alert">{error} Os dados abaixo são da última consulta confirmada.</p>}
      <p className="muted who-source">
        {longDate(data.data)} · {data.fonte}, consultado às {clock(data.consultadoEm)} · atualiza a cada 2 minutos
      </p>
      <div className="kpis who-kpis">
        <article className="em_andamento">
          <div className="kpi-symbol">●</div>
          <span>Trabalhando agora</span>
          <strong>{working.length}</strong>
          <small>pessoas com ponto aberto</small>
        </article>
        <article className="finalizado">
          <div className="kpi-symbol">⌂</div>
          <span>Obras ativas</span>
          <strong>{bySite.length}</strong>
          <small>com alguém agora</small>
        </article>
        <article className="pendente">
          <div className="kpi-symbol">◷</div>
          <span>Primeira entrada</span>
          <strong>{first ? clock(first.entrada) : "—"}</strong>
          <small>{first ? first.pessoa : "ninguém ainda"}</small>
        </article>
        <article className="touch_up">
          <div className="kpi-symbol">○</div>
          <span>Sem ponto hoje</span>
          <strong>{data.semPonto.length}</strong>
          <small>usuários ativos</small>
        </article>
      </div>

      <div className="two-columns">
        <section className="panel">
          <div className="panel-title">
            <h2>Quem está trabalhando</h2>
            <span>{working.length} com ponto aberto</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Nome</th><th>Obra</th><th>Entrada</th><th>Tempo hoje</th></tr>
              </thead>
              <tbody>
                {working.map((w, i) => {
                  const m = minutesSince(w.entrada, now);
                  return (
                    <tr key={`${w.pessoa}-${w.entrada}-${i}`}>
                      <td><span className="who-dot" aria-hidden="true" />{w.pessoa}</td>
                      <td>{w.obra || "—"}</td>
                      <td>{clock(w.entrada)}</td>
                      <td className={m !== null && m >= LONG_DAY_MINUTES ? "who-long" : undefined}>{hm(m)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!working.length && (
            <div className="empty"><span>○</span><h2>Ninguém com ponto aberto</h2><p>As entradas aparecem aqui assim que a equipe bate o ponto no QuickBooks Time.</p></div>
          )}
          {long.length > 0 && (
            <p className="muted">Em vermelho: mais de {LONG_DAY_MINUTES / 60}h de ponto aberto. Confira se alguém esqueceu de bater a saída.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Pessoas por obra</h2>
            <span>agora</span>
          </div>
          {bySite.map(([site, n]) => (
            <div className="bar-row who-bar" key={site}>
              <span title={site}>{site}</span>
              <div><i className="em_andamento" style={{ width: `${(n / max) * 100}%` }} /></div>
              <strong>{n}</strong>
            </div>
          ))}
          {!bySite.length && <p className="muted">Nenhuma obra com ponto aberto agora.</p>}
          <hr />
          <h3>Sem ponto hoje</h3>
          {data.semPonto.length ? (
            <ul className="who-list">{data.semPonto.map((p) => <li key={p.pessoa}>{p.pessoa}</li>)}</ul>
          ) : (
            <p className="muted">Todos os usuários ativos bateram ponto hoje.</p>
          )}
        </section>
      </div>

      <WorkCharts token={token} today={data} onExpired={onExpired} />

      {data.encerrados.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <h2>Já saíram hoje</h2>
            <span>{data.encerrados.length} registros encerrados</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Nome</th><th>Obra</th><th>Entrada</th><th>Saída</th><th>Duração</th></tr></thead>
              <tbody>
                {data.encerrados.map((w, i) => (
                  <tr key={`${w.pessoa}-${w.entrada}-${i}`}>
                    <td>{w.pessoa}</td>
                    <td>{w.obra || "—"}</td>
                    <td>{clock(w.entrada)}</td>
                    <td>{clock(w.saida)}</td>
                    <td>{hm(Math.round(w.duracaoSegundos / 60))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** Bloco da Visão geral: quem está trabalhando agora, com link para a página completa e os gráficos de horas. */
export function WorkOverview({ token, revision, onExpired, onOpen }: { token: string; revision: number; onExpired: () => void; onOpen: () => void }) {
  const { data, error, loading, now } = useTodayAttendance(token, revision, onExpired);
  const working = data?.trabalhando || [];
  const sites = new Set(working.map((w) => w.obra || "Sem obra informada")).size;
  return (
    <>
      <section className="panel who-overview">
        <div className="panel-title">
          <h2>Quem está trabalhando agora</h2>
          <button className="who-link" onClick={onOpen}>Ver quem está trabalhando →</button>
        </div>
        {error && <p role="alert" className="alert">{error}</p>}
        {!data ? (
          <p className="muted">{loading ? "Consultando o QuickBooks Time…" : "Ponto de hoje indisponível."}</p>
        ) : (
          <>
            <p className="who-headline">
              <strong>{working.length}</strong> {working.length === 1 ? "pessoa" : "pessoas"} com ponto aberto em <strong>{sites}</strong> {sites === 1 ? "obra" : "obras"}
              <span className="muted"> · {data.semPonto.length} sem ponto hoje · consultado às {clock(data.consultadoEm)}</span>
            </p>
            <div className="worker-grid who-mini">
              {working.map((w, i) => (
                <article key={`${w.pessoa}-${w.entrada}-${i}`}>
                  <h3><span className="who-dot" aria-hidden="true" />{w.pessoa}</h3>
                  <p>{w.obra || "Sem obra informada"}</p>
                  <small>desde {clock(w.entrada)} · {hm(minutesSince(w.entrada, now))}</small>
                </article>
              ))}
            </div>
            {!working.length && <p className="muted">Ninguém com ponto aberto agora.</p>}
          </>
        )}
      </section>
      {data && <WorkCharts token={token} today={data} onExpired={onExpired} />}
    </>
  );
}
