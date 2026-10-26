import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, post } from './transport';
import type { UserSession } from './types';
import './OsOperacional.css';

const stages = [
  'Recebida',
  'Em conferência',
  'Programada',
  'Em execução',
  'Aguardando validação',
  'Concluída',
] as const;

type Stage = (typeof stages)[number];

type Event = {
  RequestId: string;
  TipoEvento: string;
  StatusNovo: string;
  UsuarioId: string;
  CriadoEm: string;
  Motivo: string;
  ResponsavelNovo: string;
  Revisao: string;
};

type Order = {
  osId: string;
  projetoId: string;
  escopo: string;
  status: string;
  responsavel: string;
  revisao: number;
  atualizadoEm: string;
  historico: Event[];
};

type Project = {
  id: string;
  name: string;
};

type Member = {
  userId: string;
  name: string;
  role: string;
};

type Command = Record<string, unknown>;

function validOrder(value: any, project: string): value is Order {
  return (
    value &&
    typeof value.osId === 'string' &&
    value.projetoId === project &&
    typeof value.escopo === 'string' &&
    stages.includes(value.status as Stage) &&
    typeof value.responsavel === 'string' &&
    Number.isSafeInteger(value.revisao) &&
    value.revisao > 0 &&
    Array.isArray(value.historico)
  );
}

const describe = (e: unknown) =>
  e instanceof Error
    ? e.message
    : 'Não foi possível consultar a OS.';

const uncertain = (e: unknown) =>
  e instanceof ApiError &&
  [
    'WRITE_UNCONFIRMED',
    'TIMEOUT',
    'NETWORK',
    'REQUEST_FAILED',
  ].includes(e.code);

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function statusClass(status: string) {
  return `status-${normalize(status).replace(/\s+/g, '-')}`;
}

function formatDate(value: string) {
  if (!value) return '—';

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleString('pt-BR');
}

export default function OsOperacional({
  session,
  revision,
  onExpired,
  onPendingChange,
}: {
  session: UserSession;
  revision: number;
  onExpired: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState('');

  const [members, setMembers] = useState<Member[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const [selected, setSelected] = useState<Order | null>(null);

  const [scope, setScope] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reason, setReason] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const [pending, setPending] = useState<Command | null>(null);

  const [readOnly, setReadOnly] = useState(false);

  /*
   * Estados exclusivamente visuais.
   * Não alteram nenhuma regra operacional da OS.
   */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<'Todos' | Stage>('Todos');
  const [createOpen, setCreateOpen] = useState(false);

  const operation = useRef(false);
  const generation = useRef(0);

  const manager =
    session.role !== 'executor' && !readOnly;

  useEffect(() => {
    onPendingChange?.(!!pending);

    return () => {
      onPendingChange?.(false);
    };
  }, [pending, onPendingChange]);

  function fail(e: unknown) {
    if (
      e instanceof ApiError &&
      e.code === 'SESSION_EXPIRED'
    ) {
      onExpired();
      return;
    }

    if (
      e instanceof ApiError &&
      e.code === 'PROJECT_FORBIDDEN'
    ) {
      setOrders([]);
      setMembers([]);
      setSelected(null);
    }

    setError(describe(e));
  }

  /*
   * PROJETOS AUTORIZADOS
   */

  useEffect(() => {
    let active = true;

    post({
      action: 'listOsProjects',
      token: session.token,
    })
      .then((data) => {
        if (!active) return;

        if (!Array.isArray(data.projects)) {
          throw Error('Lista de projetos inválida.');
        }

        setProjects(data.projects);
        setProject(data.projects[0]?.id || '');
      })
      .catch((e) => {
        if (active) fail(e);
      });

    return () => {
      active = false;
    };
  }, [session.token]);

  /*
   * RECARREGA OS + MEMBROS
   */

  async function reload(
    projectId = project,
    selectedId = selected?.osId,
    expected = generation.current,
  ) {
    if (!projectId) return;

    setLoading(true);

    try {
      const [list, people] = await Promise.all([
        post({
          action: 'listOsOperacional',
          token: session.token,
          projetoId: projectId,
        }),

        post({
          action: 'listOsMembers',
          token: session.token,
          projetoId: projectId,
        }),
      ]);

      if (expected !== generation.current) return;

      if (
        !Array.isArray(list.workOrders) ||
        !list.workOrders.every((o: any) =>
          validOrder(o, projectId),
        ) ||
        !Array.isArray(people.members)
      ) {
        throw Error(
          'Resposta de OS inválida. Nenhum resultado confirmado.',
        );
      }

      setOrders(list.workOrders);
      setMembers(people.members);
      setReadOnly(list.readOnly === true);

      if (selectedId) {
        const current =
          list.workOrders.find(
            (o: Order) => o.osId === selectedId,
          ) || null;

        setSelected(current);
        setAssignee(current?.responsavel || '');
      }
    } catch (e) {
      if (expected === generation.current) {
        fail(e);
      }
    } finally {
      if (expected === generation.current) {
        setLoading(false);
      }
    }
  }

  /*
   * TROCA DE PROJETO
   */

  useEffect(() => {
    generation.current++;

    setOrders([]);
    setMembers([]);
    setSelected(null);

    setError('');
    setNotice('');

    setScope('');
    setReason('');

    setSearch('');
    setStatusFilter('Todos');
    setCreateOpen(false);

    void reload(
      project,
      undefined,
      generation.current,
    );

    return () => {
      generation.current++;
    };
  }, [project, session.token]);

  /*
   * REVISÃO EXTERNA
   */

  useEffect(() => {
    if (project) {
      void reload();
    }
  }, [revision]);

  /*
   * EVITA SAIR COM COMANDO INCERTO
   */

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener(
      'beforeunload',
      warn,
    );

    return () =>
      window.removeEventListener(
        'beforeunload',
        warn,
      );
  }, [pending]);

  /*
   * DETALHE CONFIRMADO DA OS
   */

  async function open(id: string) {
    if (operation.current || pending) return;

    const currentGeneration =
      generation.current;

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const data = await post({
        action: 'detailOsOperacional',
        token: session.token,
        projetoId: project,
        osId: id,
      });

      if (
        currentGeneration !== generation.current
      ) {
        return;
      }

      if (
        !validOrder(data.workOrder, project) ||
        data.workOrder.osId !== id
      ) {
        throw Error(
          'Detalhe de OS inválido.',
        );
      }

      setSelected(data.workOrder);
      setAssignee(
        data.workOrder.responsavel,
      );
      setReason('');
    } catch (e) {
      if (
        currentGeneration === generation.current
      ) {
        fail(e);
      }
    } finally {
      if (
        currentGeneration === generation.current
      ) {
        setLoading(false);
      }
    }
  }

  /*
   * EXECUÇÃO DE COMANDOS
   *
   * Mantém exatamente o princípio original:
   * nenhuma atualização otimista.
   *
   * A tela só muda depois de receber e validar
   * a Work Order devolvida pelo backend.
   */

  async function execute(command: Command) {
    if (operation.current) return;

    operation.current = true;

    const expected = generation.current;

    try {
      setBusy(true);
      setError('');
      setNotice('');
      setPending(command);

      const data = await post({
        ...command,
        token: session.token,
      });

      if (
        expected !== generation.current
      ) {
        return;
      }

      if (
        !validOrder(
          data.workOrder,
          project,
        )
      ) {
        throw new ApiError(
          'Resposta incompleta. Confira o histórico e reconcilie o mesmo pedido.',
          'WRITE_UNCONFIRMED',
        );
      }

      setPending(null);

      setSelected(data.workOrder);

      setAssignee(
        data.workOrder.responsavel,
      );

      setReason('');
      setScope('');
      setCreateOpen(false);

      setOrders((previous) => [
        data.workOrder,
        ...previous.filter(
          (o) =>
            o.osId !==
            data.workOrder.osId,
        ),
      ]);

      setNotice(
        `OS salva e confirmada. Revisão ${data.workOrder.revisao}.`,
      );
    } catch (e) {
      if (
        expected === generation.current
      ) {
        if (!uncertain(e)) {
          setPending(null);
        }

        fail(e);
      }
    } finally {
      operation.current = false;

      if (
        expected === generation.current
      ) {
        setBusy(false);
      }
    }
  }

  /*
   * CRIA COMANDO
   *
   * requestId e expectedRevision continuam
   * exatamente no contrato original.
   */

  function mutate(
    action: string,
    fields: Command = {},
  ) {
    if (
      pending ||
      operation.current
    ) {
      return;
    }

    const command: Command = {
      action,
      projetoId: project,
      requestId: crypto.randomUUID(),
      ...fields,
    };

    if (
      action !==
        'createOsOperacional' &&
      selected
    ) {
      command.osId = selected.osId;

      command.expectedRevision =
        selected.revisao;
    }

    void execute(command);
  }

  /*
   * DADOS DERIVADOS
   *
   * Não existe nenhum número fictício.
   * Todos os indicadores vêm exclusivamente
   * de "orders", confirmado por listOsOperacional.
   */

  const counts = useMemo(() => {
    const result = {} as Record<
      Stage,
      number
    >;

    stages.forEach((stage) => {
      result[stage] =
        orders.filter(
          (order) =>
            order.status === stage,
        ).length;
    });

    return result;
  }, [orders]);

  /*
   * BUSCA/FILTRO LOCAL
   *
   * Não altera os dados nem consulta outra fonte.
   */

  const filteredOrders =
    useMemo(() => {
      const query = normalize(
        search.trim(),
      );

      return orders.filter(
        (order) => {
          const matchesStatus =
            statusFilter === 'Todos' ||
            order.status ===
              statusFilter;

          if (!matchesStatus) {
            return false;
          }

          if (!query) return true;

          return normalize(
            [
              order.osId,
              order.escopo,
              order.responsavel,
            ].join(' '),
          ).includes(query);
        },
      );
    }, [
      orders,
      search,
      statusFilter,
    ]);

  function memberName(id: string) {
    if (!id) {
      return 'Não atribuído';
    }

    return (
      members.find(
        (member) =>
          member.userId === id,
      )?.name || id
    );
  }

  const disabled =
    busy ||
    !!pending ||
    loading;

  const next = selected
    ? stages[
        stages.indexOf(
          selected.status as Stage,
        ) + 1
      ]
    : undefined;

  const mayAdvance =
    manager ||
    selected?.responsavel ===
      session.userId;

  return (
    <section
      className="os-operacional os-work-orders"
      aria-label="Ordens de serviço"
    >
      {/* CABEÇALHO */}

      <header className="os-page-head">
        <div>
          <p className="os-eyebrow">
            RSF / OPERAÇÃO
          </p>

          <h1>
            Ordens de Serviço
          </h1>

          <p>
            Acompanhe o fluxo das OS com
            informações confirmadas pela
            fonte operacional.
          </p>
        </div>

        {manager && (
          <button
            type="button"
            className="primary os-new"
            disabled={
              !project || disabled
            }
            onClick={() =>
              setCreateOpen(
                (current) =>
                  !current,
              )
            }
          >
            {createOpen
              ? 'Fechar'
              : '＋ Nova OS'}
          </button>
        )}
      </header>

      {/* PROJETO / SINCRONIZAÇÃO */}

      <div className="panel os-controls">
        <label>
          Projeto autorizado

          <select
            aria-label="Projeto autorizado"
            value={project}
            disabled={
              busy || !!pending
            }
            onChange={(e) =>
              setProject(
                e.target.value,
              )
            }
          >
            {!projects.length && (
              <option value="">
                Nenhum projeto autorizado
              </option>
            )}

            {projects.map((p) => (
              <option
                key={p.id}
                value={p.id}
              >
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={
            !project ||
            busy ||
            loading
          }
          onClick={() => {
            setError('');
            void reload();
          }}
        >
          ↻ Recarregar
        </button>

        <span className="muted">
          {loading
            ? 'Consultando a fonte…'
            : `${orders.length} OS confirmada${
                orders.length === 1
                  ? ''
                  : 's'
              } neste projeto`}
        </span>
      </div>

      {/* CARDS DE RESUMO */}

      <div
        className="os-summary"
        aria-label="Resumo das ordens de serviço"
      >
        <button
          type="button"
          className={
            statusFilter === 'Todos'
              ? 'active'
              : ''
          }
          onClick={() =>
            setStatusFilter('Todos')
          }
        >
          <span>Total de OS</span>

          <strong>
            {orders.length}
          </strong>

          <small>
            Fonte atual
          </small>
        </button>

        {stages.map((stage) => {
          const amount =
            counts[stage];

          const percentage =
            orders.length > 0
              ? Math.round(
                  (amount /
                    orders.length) *
                    100,
                )
              : 0;

          return (
            <button
              type="button"
              key={stage}
              className={[
                statusFilter ===
                stage
                  ? 'active'
                  : '',
                statusClass(stage),
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() =>
                setStatusFilter(
                  stage,
                )
              }
            >
              <span>
                {stage}
              </span>

              <strong>
                {amount}
              </strong>

              <small>
                {percentage}% do total
              </small>
            </button>
          );
        })}
      </div>

      {/* AVISO DE INTEGRAÇÃO */}

      <p className="notice">
        WhatsApp automático ainda não
        integrado. Estas ordens são
        registradas pela equipe
        autenticada.
      </p>

      {/* ERROS / CONFIRMAÇÕES */}

      {error && (
        <p
          role="alert"
          className="alert"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="os-success"
        >
          {notice}
        </p>
      )}

      {/* RECONCILIAÇÃO */}

      {pending && !busy && (
        <section className="alert">
          <b>
            Gravação não confirmada
          </b>

          <p>
            Não crie outra OS.
            Recarregue a lista e
            confira o histórico; a
            reconciliação abaixo
            repete exatamente o mesmo
            pedido, sem gerar novo
            identificador.
          </p>

          <code>
            {String(
              pending.requestId,
            )}
          </code>

          <button
            type="button"
            onClick={() =>
              void execute(
                pending,
              )
            }
          >
            Reconciliar mesmo pedido
          </button>
        </section>
      )}

      {/* NOVA OS */}

      {project &&
        manager &&
        createOpen && (
          <form
            className="panel os-create"
            onSubmit={(e) => {
              e.preventDefault();

              mutate(
                'createOsOperacional',
                {
                  escopo:
                    scope.trim(),
                },
              );
            }}
          >
            <div>
              <h2>
                Nova ordem de serviço
              </h2>

              <p className="muted">
                A nova OS será
                registrada pela lógica
                operacional existente e
                começará em Recebida.
              </p>
            </div>

            <label>
              Descrição do serviço

              <textarea
                aria-label="Descrição do serviço"
                value={scope}
                onChange={(e) =>
                  setScope(
                    e.target.value,
                  )
                }
                maxLength={2048}
                required
                disabled={disabled}
              />
            </label>

            <button
              className="primary"
              type="submit"
              disabled={
                disabled ||
                !scope.trim()
              }
            >
              Criar e salvar OS
            </button>
          </form>
        )}

      {/* LISTA / TABELA */}

      <section className="panel os-table-panel">
        <div className="os-table-toolbar">
          <div>
            <h2>
              Work Orders
            </h2>

            <p className="muted">
              {statusFilter ===
              'Todos'
                ? 'Todos os status'
                : statusFilter}
            </p>
          </div>

          <label className="os-search">
            <span>
              Buscar
            </span>

            <input
              aria-label="Buscar OS"
              value={search}
              onChange={(e) =>
                setSearch(
                  e.target.value,
                )
              }
              placeholder="OS, escopo ou responsável"
            />
          </label>
        </div>

        <div className="os-table-wrap">
          <table className="os-table">
            <thead>
              <tr>
                <th>OS</th>
                <th>Escopo</th>
                <th>Status</th>
                <th>
                  Responsável
                </th>
                <th>Revisão</th>
                <th>
                  Atualização
                </th>
                <th>
                  <span className="sr-only">
                    Abrir
                  </span>
                </th>
              </tr>
            </thead>

            <tbody>
              {!loading &&
                filteredOrders.map(
                  (order) => (
                    <tr
                      key={
                        order.osId
                      }
                      className={
                        selected?.osId ===
                        order.osId
                          ? 'selected'
                          : ''
                      }
                    >
                      <td>
                        <strong>
                          {
                            order.osId
                          }
                        </strong>
                      </td>

                      <td>
                        {
                          order.escopo
                        }
                      </td>

                      <td>
                        <span
                          className={`os-status ${statusClass(
                            order.status,
                          )}`}
                        >
                          {
                            order.status
                          }
                        </span>
                      </td>

                      <td>
                        {memberName(
                          order.responsavel,
                        )}
                      </td>

                      <td>
                        {
                          order.revisao
                        }
                      </td>

                      <td>
                        {formatDate(
                          order.atualizadoEm,
                        )}
                      </td>

                      <td>
                        <button
                          type="button"
                          className="os-open"
                          disabled={
                            busy ||
                            !!pending ||
                            loading
                          }
                          onClick={() =>
                            void open(
                              order.osId,
                            )
                          }
                          aria-label={`Abrir OS ${order.osId}`}
                        >
                          ›
                        </button>
                      </td>
                    </tr>
                  ),
                )}
            </tbody>
          </table>

          {/* ESTADO VAZIO REAL */}

          {!loading &&
            !orders.length && (
              <div className="os-empty">
                <b>
                  Nenhuma OS confirmada
                  neste projeto.
                </b>

                <span>
                  Os indicadores
                  permanecem em zero
                  até a fonte retornar
                  dados reais.
                </span>
              </div>
            )}

          {/* FILTRO SEM RESULTADO */}

          {!loading &&
            !!orders.length &&
            !filteredOrders.length && (
              <div className="os-empty">
                <b>
                  Nenhuma OS
                  encontrada.
                </b>

                <span>
                  Ajuste a busca ou o
                  filtro de status.
                </span>
              </div>
            )}

          {/* CARREGAMENTO SEM DADOS FICTÍCIOS */}

          {loading && (
            <div className="os-empty">
              <b>
                Consultando a fonte…
              </b>

              <span>
                Nenhum dado fictício é
                exibido durante a
                consulta.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* DETALHE DA OS */}

      {selected && (
        <section
          className="panel os-detail"
          aria-label="Detalhe da OS"
        >
          <div className="os-detail-head">
            <div>
              <p className="os-eyebrow">
                DETALHE DA OS
              </p>

              <h2>
                {selected.escopo}
              </h2>

              <small className="muted">
                OS {selected.osId} ·
                revisão{' '}
                {selected.revisao}
              </small>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setAssignee('');
                setReason('');
              }}
            >
              Fechar
            </button>
          </div>

          {/* FLUXO REAL DA OS */}

          <ol
            className="os-stages"
            aria-label="Etapas da OS"
          >
            {stages.map(
              (stage, index) => (
                <li
                  key={stage}
                  className={
                    index <=
                    stages.indexOf(
                      selected.status as Stage,
                    )
                      ? 'reached'
                      : ''
                  }
                  aria-current={
                    stage ===
                    selected.status
                      ? 'step'
                      : undefined
                  }
                >
                  {stage}
                </li>
              ),
            )}
          </ol>

          {/* RESUMO DO DETALHE */}

          <div className="os-detail-grid">
            <div>
              <span>
                Etapa atual
              </span>

              <b>
                {selected.status}
              </b>
            </div>

            <div>
              <span>
                Responsável
              </span>

              <b>
                {memberName(
                  selected.responsavel,
                )}
              </b>
            </div>

            <div>
              <span>
                Revisão
              </span>

              <b>
                {selected.revisao}
              </b>
            </div>

            <div>
              <span>
                Atualização
              </span>

              <b>
                {formatDate(
                  selected.atualizadoEm,
                )}
              </b>
            </div>
          </div>

          {/* RESPONSÁVEL */}

          <label>
            Responsável

            <select
              aria-label="Responsável"
              value={assignee}
              onChange={(e) =>
                setAssignee(
                  e.target.value,
                )
              }
              disabled={
                disabled ||
                !manager
              }
            >
              <option value="">
                Não atribuído
              </option>

              {members.map(
                (member) => (
                  <option
                    key={
                      member.userId
                    }
                    value={
                      member.userId
                    }
                  >
                    {member.name} (
                    {member.userId})
                  </option>
                ),
              )}
            </select>
          </label>

          {manager && (
            <button
              type="button"
              disabled={
                disabled ||
                !assignee ||
                assignee ===
                  selected.responsavel
              }
              onClick={() =>
                mutate(
                  'assignOsOperacional',
                  {
                    responsavel:
                      assignee,
                  },
                )
              }
            >
              Salvar responsável
            </button>
          )}

          {/* OBSERVAÇÃO / EVIDÊNCIA */}

          <label>
            Observação / evidência
            textual

            <textarea
              aria-label="Observação / evidência textual"
              maxLength={2048}
              value={reason}
              onChange={(e) =>
                setReason(
                  e.target.value,
                )
              }
              disabled={
                disabled ||
                readOnly
              }
            />
          </label>

          {/* AÇÕES OPERACIONAIS */}

          <div className="os-actions">
            {next &&
              mayAdvance &&
              !readOnly && (
                <button
                  type="button"
                  className="primary"
                  disabled={
                    disabled ||
                    (next ===
                      'Concluída' &&
                      !reason.trim())
                  }
                  onClick={() =>
                    mutate(
                      'advanceOsOperacional',
                      {
                        statusNovo:
                          next,
                        motivo:
                          reason.trim(),
                      },
                    )
                  }
                >
                  Avançar para {next}
                </button>
              )}

            {selected.status ===
              'Concluída' &&
              manager && (
                <button
                  type="button"
                  className="danger-outline"
                  disabled={
                    disabled ||
                    !reason.trim()
                  }
                  onClick={() =>
                    mutate(
                      'reopenOsOperacional',
                      {
                        statusNovo:
                          'Em execução',
                        motivo:
                          reason.trim(),
                      },
                    )
                  }
                >
                  Reabrir OS em execução
                </button>
              )}
          </div>

          {/* SOMENTE LEITURA */}

          {readOnly && (
            <p className="notice">
              Fonte local de teste:
              criação por revisão de
              rascunho e leitura.
              Alterações de andamento e
              atribuição não habilitadas
              nesta fonte.
            </p>
          )}

          {/* HISTÓRICO REAL */}

          <div className="os-history-head">
            <h3>
              Histórico persistido
            </h3>

            <span className="muted">
              {
                selected.historico
                  .length
              }{' '}
              evento
              {selected.historico
                .length === 1
                ? ''
                : 's'}
            </span>
          </div>

          {!selected.historico
            .length && (
            <p className="os-empty-history">
              Nenhum evento persistido
              foi retornado para esta
              OS.
            </p>
          )}

          <ol className="os-history">
            {selected.historico.map(
              (event) => (
                <li
                  key={
                    event.RequestId
                  }
                >
                  <strong>
                    Rev.{' '}
                    {event.Revisao} ·{' '}
                    {event.StatusNovo}
                  </strong>

                  <span>
                    {event.TipoEvento}
                    {' · '}
                    {event.UsuarioId}
                    {' · '}
                    {formatDate(
                      event.CriadoEm,
                    )}
                  </span>

                  {event.ResponsavelNovo && (
                    <span>
                      Responsável:{' '}
                      {
                        event.ResponsavelNovo
                      }
                    </span>
                  )}

                  {event.Motivo && (
                    <p>
                      {event.Motivo}
                    </p>
                  )}
                </li>
              ),
            )}
          </ol>
        </section>
      )}
    </section>
  );
}
