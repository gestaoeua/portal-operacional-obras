import { useCallback, useEffect, useRef, useState } from "react";
import { loadRooms } from "./api";
import { enterRoom, exitRoom, getVisits, login, logout } from "./fieldApi";
import { ApiError } from "./transport";
import type { Room, Status, UserSession, WorkAction, WorkVisit } from "./types";
import { STATUS_LABEL, STATUS_ORDER } from "./types";
import "./App.css";
import OsOperacional from "./OsOperacional";
import OsIndicatorsPage from "./OsIndicatorsPage";
import SchedulePage from "./SchedulePage";
import KapsoDrafts from "./KapsoDrafts";
import PropertiesUnits from "./properties/PropertiesUnits";
import TeamsServices from "./catalogs/TeamsServices";
import WhoIsWorking, { WorkOverview } from "./WhoIsWorking";
import logo from "./rsf-logo.jpeg";
import { IS_FIXTURE } from "./config";

const actions: Array<[WorkAction, string]> = [
  ["preparacao", "Preparação"],
  ["primeira_mao", "Primeira mão"],
  ["segunda_mao", "Segunda mão"],
  ["touch_up", "Touch-up"],
  ["portas", "Portas"],
  ["limpeza", "Limpeza"],
  ["inspecao", "Inspeção"],
];
const pages = [
  ["dashboard", "Visão geral", "◫"],
  ["working", "Quem está trabalhando", "●"],
  ["properties", "Propriedades", "⌂"],
  ["units", "Unidades", "▣"],
  ["locations", "Locais de campo", "⌂"],
  ["orders", "Ordens de serviço", "☷"],
  ["messages", "Mensagens", "✉"],
  ["calendar", "Calendário", "▦"],
  ["teams", "Equipes", "♧"],
  ["services", "Serviços", "◇"],
  ["field", "Execução de campo", "▶"],
  ["handover", "Antes e depois", "▧"],
  ["analytics", "Indicadores", "▥"],
] as const;
type Page = (typeof pages)[number][0];
function requestedPage(): Page {
  const view = new URLSearchParams(window.location.search).get('view');
  return pages.some(([id])=>id===view) ? view as Page : 'orders';
}
const roles = { executor: "Execução", gestor: "Gestão", diretor: "Diretoria" };
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Não foi possível concluir a operação.";
function duration(v: WorkVisit) {
  const end = v.endedAt ? Date.parse(v.endedAt) : Date.now();
  const start = Date.parse(v.startedAt);
  if (!Number.isFinite(end - start) || end < start) return "Data a conferir";
  const m = Math.floor((end - start) / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}
function date(value?: string) {
  const d = value && new Date(value);
  return d && Number.isFinite(d.getTime())
    ? d.toLocaleString("pt-BR")
    : value || "—";
}
function Badge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span>○</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (s: UserSession) => void }) {
  const [user, setUser] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      onLogin(await login(user, password));
      setPassword("");
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section>
        <div className="wordmark">
          <img src={logo} alt="RSF Clean Services LLC" style={{width:150,borderRadius:6}} />
        </div>
        <p className="eyebrow">PORTAL OPERACIONAL</p>
        {IS_FIXTURE && <p className="notice">Prévia local com dados fictícios. Não use sua senha real. A origem de cada teste é indicada na tela.</p>}
        <h1>Bem-vindo à operação</h1>
        <p>Seus locais, serviços e registros em um só lugar</p>
        <form onSubmit={submit}>
          <label>
            Usuário
            <input
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={256}
            />
          </label>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar com segurança →"}
          </button>
        </form>
        <small>Acesso autorizado · Dados da operação protegidos</small>
      </section>
    </main>
  );
}
function RoomList({ rooms }: { rooms: Room[] }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  const filtered = rooms.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      `${r.mark} ${r.name} ${r.service}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>
          Locais cadastrados <small>{rooms.length}</small>
        </h2>
        <input
          aria-label="Buscar locais"
          placeholder="Buscar MARK, local ou serviço"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filters">
        <button
          aria-pressed={status === "all"}
          onClick={() => setStatus("all")}
        >
          Todos
        </button>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>MARK</th>
              <th>Local</th>
              <th>Serviço</th>
              <th>Status</th>
              <th>Observação</th>
              <th>Atualização</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.mark}>
                <td className="accent">{r.mark}</td>
                <td>{r.name || "Não informado"}</td>
                <td>{r.service || "—"}</td>
                <td>
                  <Badge status={r.status} />
                </td>
                <td>{r.note || "—"}</td>
                <td>{r.updatedAt || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <Empty title="Nenhum local encontrado">
          Altere os filtros ou confira o cadastro na fonte de dados.
        </Empty>
      )}
    </section>
  );
}
function History({ visits }: { visits: WorkVisit[] }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Histórico de campo</h2>
        <span>{visits.length} registros</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Local</th>
              <th>Responsável</th>
              <th>Serviço</th>
              <th>Entrada</th>
              <th>Saída</th>
              <th>Duração</th>
            </tr>
          </thead>
          <tbody>
            {[...visits]
              .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
              .map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.roomMark} · {v.roomName}
                  </td>
                  <td>{v.userName}</td>
                  <td>
                    {actions.find((a) => a[0] === v.action)?.[1] ||
                      "Em execução"}
                  </td>
                  <td>{date(v.startedAt)}</td>
                  <td>{date(v.endedAt)}</td>
                  <td>{duration(v)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!visits.length && (
        <Empty title="Sem registros nesta fonte">
          Os apontamentos de campo aparecerão aqui após serem confirmados pelo
          servidor.
        </Empty>
      )}
    </section>
  );
}
function Field({
  session,
  rooms,
  visits,
  onChange,
}: {
  session: UserSession;
  rooms: Room[];
  visits: WorkVisit[];
  onChange: () => Promise<void>;
}) {
  const active = visits.find((v) => v.userId === session.userId && !v.endedAt),
    [selected, setSelected] = useState(""),
    [action, setAction] = useState<WorkAction>(),
    [status, setStatus] = useState<Status>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (active && action && status)
        await exitRoom(session, active.id, action, status);
      else if (!active && selected) await enterRoom(session, selected);
      await onChange();
      setSelected("");
      setAction(undefined);
      setStatus(undefined);
    } catch (e) {
      setError(message(e));
      try {
        await onChange();
      } catch {
        /* preserve the original error */
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (session.role !== "executor")
    return (
      <>
        <section className="panel">
          <div className="panel-title">
            <h2>Equipe em campo</h2>
            <span>
              {visits.filter((v) => !v.endedAt).length} atendimentos abertos
            </span>
          </div>
          <div className="worker-grid">
            {visits
              .filter((v) => !v.endedAt)
              .map((v) => (
                <article key={v.id}>
                  <div className="avatar">{v.userName.slice(0, 1)}</div>
                  <h3>{v.userName}</h3>
                  <p>
                    {v.roomMark} · {v.roomName}
                  </p>
                  <strong>{duration(v)}</strong>
                </article>
              ))}
          </div>
          {!visits.some((v) => !v.endedAt) && (
            <Empty title="Nenhum atendimento aberto">
              Acompanhe aqui as entradas confirmadas pela equipe.
            </Empty>
          )}
        </section>
        <History visits={visits} />
      </>
    );
  return (
    <section className="panel field">
      <p className="eyebrow">REGISTRO DE EXECUÇÃO</p>
      <h2>
        {active
          ? `${active.roomMark} · ${active.roomName}`
          : "Onde você vai trabalhar?"}
      </h2>
      {active ? (
        <>
          <p>
            Entrada: {date(active.startedAt)} · {duration(active)}
          </p>
          <h3>1. Serviço executado</h3>
          <div className="choices">
            {actions.map(([id, label]) => (
              <button
                key={id}
                aria-pressed={action === id}
                disabled={busy}
                onClick={() => setAction(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <h3>2. Situação do local</h3>
          <div className="choices">
            {STATUS_ORDER.filter((s) => s !== "nao_cadastrada").map((s) => (
              <button
                key={s}
                aria-pressed={status === s}
                disabled={busy}
                onClick={() => setStatus(s)}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <label>
          Selecione o local
          <select
            value={selected}
            disabled={busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Escolha um local</option>
            {rooms.map((r) => (
              <option value={r.mark} key={r.mark}>
                {r.mark} · {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || (active ? !action || !status : !selected)}
        onClick={save}
      >
        {busy
          ? "Confirmando…"
          : active
            ? "Finalizar e salvar"
            : "Iniciar atendimento"}
      </button>
      <p className="muted">
        O registro só é confirmado após a resposta do servidor. Em caso de falha
        de conexão, confira o histórico antes de repetir.
      </p>
    </section>
  );
}
function Dashboard({ rooms, visits }: { rooms: Room[]; visits: WorkVisit[] }) {
  const counts = STATUS_ORDER.map((s) => ({
    s,
    n: rooms.filter((r) => r.status === s).length,
  }));
  return (
    <>
      <div className="kpis">
        {counts.map(({ s, n }) => (
          <article key={s} className={s}>
            <div className="kpi-symbol">
              {s === "finalizado" ? "✓" : s === "em_andamento" ? "◷" : "▤"}
            </div>
            <span>{STATUS_LABEL[s]}</span>
            <strong>{n}</strong>
            <small>locais cadastrados</small>
          </article>
        ))}
      </div>
      <div className="two-columns">
        <section className="panel">
          <div className="panel-title">
            <h2>Distribuição dos locais</h2>
            <span>{rooms.length} no total</span>
          </div>
          {counts.map(({ s, n }) => (
            <div className="bar-row" key={s}>
              <span>{STATUS_LABEL[s]}</span>
              <div>
                <i
                  className={s}
                  style={{
                    width: `${rooms.length ? (n / rooms.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <strong>{n}</strong>
            </div>
          ))}
        </section>
        <section className="panel summary">
          <h2>Operação de campo</h2>
          <strong>{visits.filter((v) => !v.endedAt).length}</strong>
          <p>Atendimentos abertos</p>
          <hr />
          <b>
            {visits.filter((v) => v.endedAt).length} atendimentos concluídos
          </b>
          <p className="muted">
            Finalização do local não equivale à liberação para locação. Essa
            etapa exige inspeção e aprovação próprias.
          </p>
        </section>
      </div>
      <History visits={visits} />
    </>
  );
}
export default function App() {
  // Deliberately memory-only: credentials and tokens are not persisted in web storage.
  const [session, setSession] = useState<UserSession | null>(null),
    [page, setPage] = useState<Page>(requestedPage),
    [rooms, setRooms] = useState<Room[]>([]),
    [visits, setVisits] = useState<WorkVisit[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [loaded, setLoaded] = useState(false),
    [updated, setUpdated] = useState(""),
    [logoutBusy, setLogoutBusy] = useState(false),
    [osRevision, setOsRevision] = useState(0);
  const [osLocked,setOsLocked] = useState(false);
  const [scheduleLocked,setScheduleLocked] = useState(false);
  const request = useRef(0);
  const expireSession = useCallback(() => {
    request.current++;
    setSession(null);
    setRooms([]);
    setVisits([]);
    setLoaded(false);
    setError("");
  }, []);
  const refresh = useCallback(async () => {
    if (!session) return;
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const [r, v] = await Promise.all([
        loadRooms(session),
        getVisits(session),
      ]);
      if (id !== request.current) return;
      setRooms(r.rooms);
      setVisits(v);
      setUpdated(new Date().toLocaleTimeString("pt-BR"));
      setLoaded(true);
    } catch (e) {
      if (id !== request.current) return;
      setError(message(e));
      if (
        e instanceof ApiError &&
        ["SESSION_EXPIRED", "UNAUTHORIZED", "AUTH_REQUIRED"].includes(e.code)
      ) {
        setSession(null);
        setRooms([]);
        setVisits([]);
        setLoaded(false);
      }
      throw e;
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [session]);
  useEffect(() => {
    if (session) {
      setPage(requestedPage());
    }
    return () => {
      request.current++;
    };
  }, [session, refresh]);
  useEffect(() => { if(session && ["dashboard","locations","field","handover"].includes(page)) refresh().catch(() => {}); },[page,session,refresh]);
  async function signOut() {
    if (!session || logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logout(session);
      request.current++;
      setSession(null);
      setRooms([]);
      setVisits([]);
      setLoaded(false);
      setError("");
    } catch (e) {
      setError(`Não foi possível encerrar a sessão no servidor: ${message(e)}`);
    } finally {
      setLogoutBusy(false);
    }
  }
  if (!session) return <Login onLogin={setSession} />;
  const current = pages.find((p) => p[0] === page)!;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="wordmark">
          <img src={logo} alt="RSF Clean Services LLC" style={{width:150,borderRadius:6}} />
        </div>
        <p>Da execução à entrega</p>
        <nav aria-label="Navegação principal">
          {pages
            .filter(
              (p) =>
                session.role !== "executor" ||
                ["field", "locations", "orders"].includes(p[0]),
            )
            .map(([id, label, icon]) => (
              <button
                key={id}
                aria-current={page === id ? "page" : undefined}
                disabled={osLocked || scheduleLocked}
                onClick={() => setPage(id)}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
        </nav>
        <div className="sidebar-foot">
          <b>Portal operacional</b>
          <p>
            Histórico preservado
            <br />
            Fonte: {IS_FIXTURE ? 'Fixtures fictícias locais' : 'Google Sheets'}
          </p>
        </div>
      </aside>
      <main className="content">
        {IS_FIXTURE && <p role="status" className="alert">AMBIENTE LOCAL — backend de teste com dados fictícios. Arquivos privados selecionados são somente revisão local. Sem conexão com produção.</p>}
        <header>
          <div>
            <p className="eyebrow">RSF / OPERAÇÃO</p>
            <h1>{current[1]}</h1>
            <p>Acompanhe a operação e a disponibilidade das fontes</p>
          </div>
          <div className="account">
            <div className="avatar">{session.name.slice(0, 1)}</div>
            <div>
              <b>{session.name}</b>
              <small>{roles[session.role]}</small>
            </div>
            <button onClick={signOut} disabled={logoutBusy || scheduleLocked}>
              {logoutBusy ? "Saindo…" : "Sair"}
            </button>
          </div>
        </header>
        <div className="sync">
          <span>
            {page === "working" ? "Ponto de hoje no QuickBooks Time" : page === "messages" ? "Rascunhos recebidos — origem indicada abaixo" : ["orders","analytics","calendar"].includes(page) ? "Ordens de serviço por projeto autorizado" : loading
              ? "Consultando a operação…"
              : updated
                ? `Locais e campo: consulta às ${updated}`
                : "Conexão pendente"}
          </span>
          <button
            disabled={loading || osLocked || scheduleLocked}
            onClick={() => {
              setOsRevision((v) => v + 1);
              if(["dashboard","locations","field","handover"].includes(page)) refresh().catch(() => {});
            }}
          >
            ↻ Atualizar
          </button>
        </div>
        {error && ["dashboard","locations","field","handover"].includes(page) && (
          <div role="alert" className="alert">
            {error}
            {loaded &&
              " Os dados abaixo pertencem à última consulta confirmada."}
          </div>
        )}
        {page === "working" ? <WhoIsWorking key={session.token} token={session.token} revision={osRevision} onExpired={expireSession}/> : page === "messages" ? <KapsoDrafts key={session.token} token={session.token} onOpenOrders={()=>setPage("orders")} onPendingChange={setOsLocked}/> : page === "orders" ? <OsOperacional session={session} revision={osRevision} onExpired={expireSession} onPendingChange={setOsLocked} /> : page === "analytics" ? <OsIndicatorsPage token={session.token} revision={osRevision} onExpired={expireSession}/> : page === "calendar" ? <SchedulePage token={session.token} onExpired={expireSession} onPendingChange={setScheduleLocked}/> : page === "teams" || page === "services" ? <TeamsServices key={page} view={page} projetoId=""/> : page === "properties" || page === "units" ? <PropertiesUnits projetoId=""/> : page === "dashboard" && !loaded ? (
          <>
            {session.role !== "executor" && <WorkOverview key={session.token} token={session.token} revision={osRevision} onExpired={expireSession} onOpen={() => setPage("working")} />}
            <Empty title={loading ? "Carregando locais e campo" : "Locais e campo ainda não disponíveis"}>
              {loading ? "Aguarde a confirmação do servidor." : "Confira a conexão e tente atualizar. Nenhum dado de demonstração é utilizado."}
            </Empty>
          </>
        ) : !loaded ? (
          <Empty
            title={
              loading ? "Carregando seus dados" : "Dados ainda não disponíveis"
            }
          >
            {loading
              ? "Aguarde a confirmação do servidor."
              : "Confira a conexão e tente atualizar. Nenhum dado de demonstração é utilizado."}
          </Empty>
        ) : (
          <>
            {page === "dashboard" && (
              <>
                {session.role !== "executor" && <WorkOverview key={session.token} token={session.token} revision={osRevision} onExpired={expireSession} onOpen={() => setPage("working")} />}
                <Dashboard rooms={rooms} visits={visits} />
              </>
            )}{" "}
            {page === "locations" && <RoomList rooms={rooms} />}{" "}
            {page === "field" && (
              <Field
                session={session}
                rooms={rooms}
                visits={visits}
                onChange={refresh}
              />
            )}{" "}
            {page === "handover" && (
              <Empty title="Entrega com evidências">
                Fotos, checklist e aprovação serão vinculados à OS original.
                Nenhum local é marcado como pronto para locação apenas por
                concluir um serviço.
              </Empty>
            )}
          </>
        )}
        <footer>
          © {new Date().getFullYear()} RSF Clean Services LLC · Portal
          operacional
        </footer>
      </main>
    </div>
  );
}
