import { useEffect, useRef, useState } from "react";
import { ApiError } from "./transport";
import { loadTodayAttendance, PERIODS, type Period, type TodayAttendance } from "./whoIsWorkingApi";

const PALETTE = ["#2563eb", "#c81e1e", "#1f9d55", "#d97706", "#7c3aed", "#0891b2", "#db2777"];
const OTHERS_COLOR = "#94a3b8";
const MAX_SLICES = 7;

export function hoursLabel(h: number) {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min`;
}
function dayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

type Slice = { label: string; value: number; color: string };
function slicesOf(rows: { cliente: string; horas: number }[]): Slice[] {
  const sorted = [...rows].sort((a, b) => b.horas - a.horas);
  const top = sorted.slice(0, sorted.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES);
  const rest = sorted.slice(top.length).reduce((s, r) => s + r.horas, 0);
  const out = top.map((r, i) => ({ label: r.cliente, value: r.horas, color: PALETTE[i % PALETTE.length] }));
  if (rest > 0) out.push({ label: "Outros", value: rest, color: OTHERS_COLOR });
  return out;
}

function arc(cx: number, cy: number, r: number, ri: number, a0: number, a1: number) {
  const p = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1), [x2, y2] = p(ri, a1), [x3, y3] = p(ri, a0);
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${large} 0 ${x3} ${y3}Z`;
}

export function ClientPie({ rows }: { rows: { cliente: string; horas: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const slices = slicesOf(rows);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return <p className="muted">Sem horas registradas no período.</p>;
  let angle = 0;
  const shown = hover === null ? null : slices[hover];
  return (
    <div className="pie-wrap">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Horas por cliente: ${slices.map((s) => `${s.label} ${hoursLabel(s.value)}`).join(", ")}`}>
        {slices.length === 1 ? (
          <circle cx="100" cy="100" r="78" fill="none" stroke={slices[0].color} strokeWidth="44" />
        ) : (
          slices.map((s, i) => {
            const a0 = angle, a1 = angle + (s.value / total) * Math.PI * 2;
            angle = a1;
            return (
              <path key={s.label} d={arc(100, 100, 100, 56, a0, a1)} fill={s.color}
                opacity={hover === null || hover === i ? 1 : 0.35} stroke="#fff" strokeWidth="1.5"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            );
          })
        )}
        <text x="100" y="96" textAnchor="middle" className="pie-total">{hoursLabel(shown ? shown.value : total)}</text>
        <text x="100" y="116" textAnchor="middle" className="pie-sub">{shown ? `${Math.round((shown.value / total) * 100)}% do total` : "total no período"}</text>
      </svg>
      <ul className="pie-legend">
        {slices.map((s, i) => (
          <li key={s.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? "on" : undefined}>
            <i style={{ background: s.color }} aria-hidden="true" />
            <span title={s.label}>{s.label}</span>
            <b>{hoursLabel(s.value)}</b>
            <small>{Math.round((s.value / total) * 100)}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PersonHours({ rows }: { rows: { pessoa: string; horas: number }[] }) {
  if (!rows.length) return <p className="muted">Sem horas registradas no período.</p>;
  const sorted = [...rows].sort((a, b) => b.horas - a.horas);
  const max = sorted[0].horas || 1;
  return (
    <div>
      {sorted.map((r) => (
        <div className="bar-row who-bar who-hours" key={r.pessoa}>
          <span title={r.pessoa}>{r.pessoa}</span>
          <div><i className="em_andamento" style={{ width: `${(r.horas / max) * 100}%` }} /></div>
          <strong>{hoursLabel(r.horas)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Pizza de horas por cliente + horas por funcionário, com seletor de período. */
export default function WorkCharts({ token, today, onExpired }: { token: string; today: TodayAttendance | null; onExpired: () => void }) {
  const [period, setPeriod] = useState<Period>("hoje"),
    [other, setOther] = useState<TodayAttendance | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    if (period === "hoje") { request.current++; setError(""); setLoading(false); return; }
    const id = ++request.current;
    setLoading(true);
    setError("");
    loadTodayAttendance(token, period)
      .then((d) => { if (id === request.current) setOther(d); })
      .catch((e) => {
        if (id !== request.current) return;
        if (e instanceof ApiError && ["SESSION_EXPIRED", "UNAUTHORIZED", "AUTH_REQUIRED"].includes(e.code)) return onExpired();
        setError(e instanceof Error ? e.message : "Não foi possível consultar as horas.");
      })
      .finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current++; };
  }, [period, token, onExpired]);

  const data = period === "hoje" ? today : other && other.periodo === period ? other : null;
  const range = data ? (data.inicio === data.fim ? dayLabel(data.fim) : `${dayLabel(data.inicio)} a ${dayLabel(data.fim)}`) : "";
  return (
    <>
      <div className="filters who-periods" role="group" aria-label="Período das horas">
        {PERIODS.map(([id, label]) => (
          <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>
        ))}
        <span className="muted">{loading ? "Consultando…" : range && `${range} · inclui quem ainda está com ponto aberto`}</span>
      </div>
      {error && <p role="alert" className="alert">{error}</p>}
      <div className="two-columns who-charts">
        <section className="panel">
          <div className="panel-title"><h2>Horas por cliente</h2><span>{data ? `${data.horasPorCliente.length} clientes` : ""}</span></div>
          {data ? <ClientPie rows={data.horasPorCliente} /> : <p className="muted">{loading ? "Carregando…" : "Sem dados para o período."}</p>}
        </section>
        <section className="panel">
          <div className="panel-title"><h2>Horas por funcionário</h2><span>{data ? `${data.horasPorPessoa.length} pessoas` : ""}</span></div>
          {data ? <PersonHours rows={data.horasPorPessoa} /> : <p className="muted">{loading ? "Carregando…" : "Sem dados para o período."}</p>}
        </section>
      </div>
    </>
  );
}
