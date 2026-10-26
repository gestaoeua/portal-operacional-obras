import { useEffect, useState } from "react";
import { post, ApiError } from "./transport";
import type { UserSession, WorkOrder } from "./types";

export default function WorkOrders({
  session,
  revision,
  onExpired,
}: {
  session: UserSession;
  revision: number;
  onExpired: () => void;
}) {
  const [orders, setOrders] = useState<WorkOrder[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [selectedId, setSelectedId] = useState(""),
    [localRevision, setLocalRevision] = useState(0),
    [updated, setUpdated] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    post({ action: "listWorkOrders", token: session.token })
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data.workOrders))
          throw Error("Resposta de OS inválida.");
        setOrders(data.workOrders);
        setUpdated(new Date().toLocaleTimeString("pt-BR"));
      })
      .catch((e) => {
        if (!cancelled) {
          if (e instanceof ApiError && e.code === "SESSION_EXPIRED") {
            onExpired();
            return;
          }
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, revision, localRevision, onExpired]);
  const selected = orders.find((o) => o.id === selectedId);
  const sync = (
    <div className="sync">
      <span>
        {loading
          ? "Consultando OS…"
          : updated
            ? `OS: consulta confirmada às ${updated}`
            : "OS: consulta pendente"}
      </span>
      <button disabled={loading} onClick={() => setLocalRevision((v) => v + 1)}>
        ↻ Consultar OS
      </button>
    </div>
  );
  if (selected)
    return (
      <>
        {sync}
        {error && (
          <p role="alert" className="alert">
            {error} Os detalhes abaixo pertencem à última consulta confirmada.
          </p>
        )}
        <button className="back" onClick={() => setSelectedId("")}>
          ← Todas as ordens de serviço
        </button>
        <section className="panel">
          <p className="eyebrow">ORDEM DE SERVIÇO · {selected.id}</p>
          <h1>{selected.address}</h1>
          <p>
            {selected.city} ·{" "}
            <strong>{selected.status || "Status não informado"}</strong>
          </p>
          <div className="order-grid">
            {[
              ["Escopo", selected.scope],
              ["Proteções / Não remover", selected.protections],
              ["Dependências / Observações", selected.dependencies],
              ["Evidências registradas", selected.evidenceNotes],
            ].map(([label, value]) => (
              <article key={label}>
                <h2>{label}</h2>
                <p>{value || "Não informado na fonte"}</p>
              </article>
            ))}
          </div>
          <p className="muted">
            Atualização na fonte: {selected.updatedAt || "Não informada"}.
            Evidências em texto não confirmam anexos nem aprovação de entrega.
          </p>
        </section>
        <section className="notice">
          Esta OS preserva o identificador e o status originais. Não possui
          vínculo confirmado com os MARKs da clínica ou com os projetos de
          custo.
        </section>
      </>
    );
  return (
    <>
      {sync}
      <section className="panel">
        <div className="panel-title">
          <h2>Ordens de serviço</h2>
          <button
            disabled={loading}
            onClick={() => setLocalRevision((v) => v + 1)}
          >
            ↻ Consultar fonte
          </button>
        </div>
        <p className="muted">
          Leitura da planilha original de OS, sem alterar histórico ou criar
          vínculos automáticos.
        </p>
        {error && (
          <p role="alert" className="alert">
            {error} Nenhum dado de demonstração é utilizado.
          </p>
        )}
        {loading ? (
          <p role="status">Consultando ordens de serviço…</p>
        ) : (
          !error && (
            <>
              <input
                aria-label="Buscar ordens de serviço"
                placeholder="Buscar OS, endereço ou cidade"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>OS</th>
                      <th>Endereço</th>
                      <th>Cidade</th>
                      <th>Status original</th>
                      <th>Atualização</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders
                      .filter((o) =>
                        `${o.id} ${o.address} ${o.city}`
                          .toLocaleLowerCase()
                          .includes(search.toLocaleLowerCase()),
                      )
                      .map((o) => (
                        <tr key={o.id}>
                          <td className="accent">{o.id}</td>
                          <td>{o.address}</td>
                          <td>{o.city}</td>
                          <td>{o.status || "Não informado"}</td>
                          <td>{o.updatedAt || "—"}</td>
                          <td>
                            <button
                              aria-label={`Ver ${o.id}`}
                              onClick={() => setSelectedId(o.id)}
                            >
                              Ver OS →
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!orders.length && (
                <p className="muted">Nenhuma OS cadastrada nesta fonte.</p>
              )}
            </>
          )
        )}
      </section>
      <section className="notice">
        Prazos, prioridade, equipe designada e aprovação de Ready to Rent ainda
        não estão registrados como campos próprios. Esses indicadores não são
        estimados.
      </section>
    </>
  );
}
