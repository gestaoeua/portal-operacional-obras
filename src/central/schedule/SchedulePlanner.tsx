import { useEffect, useMemo, useState } from 'react';
import {
  calcularAlertas,
  SCHEDULE_TIMEZONE,
  validarConjunto,
  validarRascunho,
  type AlertaAgenda,
  type NovoAssignmentDraft,
  type OnSaveAssignment,
  type ScheduleAssignment,
} from './model';

export type ScheduleView = 'day' | 'person';

/**
 * Estado discriminado desta fatia. `dataset` é `unknown` de propósito: o
 * componente nunca assume que quem o integra já validou o conjunto — ele
 * mesmo rejeita formato inesperado, projeto misto, ID duplicado, data ou
 * horário inválido antes de renderizar qualquer linha. `not_integrated` é
 * o estado padrão: até existir uma fonte real de cronograma, é isto que
 * deve ser passado (ver integração em src/central/App.tsx, fora desta
 * fatia). Um dataset `ready` vazio ([]) só deve ocorrer quando uma fonte
 * explícita e válida de fato confirmou "nenhuma atribuição ainda" — nunca
 * como substituto de not_integrated.
 */
export type SchedulePlannerState =
  | { kind: 'not_integrated' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; dataset: unknown };

export interface SchedulePlannerProps {
  projetoId: string;
  state?: SchedulePlannerState;
  /**
   * Chamado só depois da etapa de revisão, com o rascunho já validado.
   * Esta fatia NUNCA persiste nada por conta própria — quem integra
   * decide o que fazer com o rascunho (gravar no backend, atribuir
   * assignmentId/revision, etc.). Quando ausente, a entrada manual fica
   * disponível só para revisão, com o botão de salvar desabilitado e um
   * aviso explícito de que o salvamento ainda não está integrado.
   */
  onSave?: OnSaveAssignment;
}

interface FormularioBruto {
  personId: string;
  personName: string;
  locationId: string;
  locationName: string;
  date: string;
  startTime: string;
  endTime: string;
}

const FORMULARIO_VAZIO: FormularioBruto = {
  personId: '',
  personName: '',
  locationId: '',
  locationName: '',
  date: '',
  startTime: '',
  endTime: '',
};

/**
 * Componente puro: tudo que mostra vem de `props` neste render — os
 * únicos estados próprios são interação de tela (busca, vista
 * selecionada, formulário de entrada manual e seu modo
 * edição/revisão), nunca dado de cronograma em si. Nunca busca dados,
 * nunca persiste nada por conta própria, nunca infere equipes ou obras a
 * partir de `Usuarios` ou de salas. Planejamento aqui NUNCA é tratado
 * como hora realmente trabalhada. Reutiliza só classes já existentes em
 * src/central/App.css (panel, panel-title, filters, table-scroll, empty,
 * accent, muted, notice, alert, primary, badge) — nenhum CSS novo é
 * criado aqui.
 */
export default function SchedulePlanner({
  projetoId,
  state = { kind: 'not_integrated' },
  onSave,
}: SchedulePlannerProps) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ScheduleView>('day');
  const [formulario, setFormulario] = useState<FormularioBruto>(FORMULARIO_VAZIO);
  const [modo, setModo] = useState<'edicao' | 'revisao'>('edicao');
  const [rascunho, setRascunho] = useState<NovoAssignmentDraft | null>(null);
  const [erroFormulario, setErroFormulario] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  // Trocar de projeto nunca deve carregar um rascunho revisado sob o
  // projeto anterior para o novo contexto — mesmo princípio de "nunca
  // mostrar dado antigo ao trocar projeto" já aplicado ao conjunto
  // vindo de `state`, estendido ao formulário de entrada manual.
  useEffect(() => {
    setFormulario(FORMULARIO_VAZIO);
    setModo('edicao');
    setRascunho(null);
    setErroFormulario(null);
    setErroSalvar(null);
    setSucesso(false);
  }, [projetoId]);

  const resultado = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return validarConjunto(state.dataset, projetoId);
  }, [state, projetoId]);

  const alertasPorId = useMemo(() => {
    if (!resultado || !resultado.ok) return new Map<string, AlertaAgenda>();
    return new Map(calcularAlertas(resultado.assignments).map((a) => [a.assignmentId, a]));
  }, [resultado]);

  function atualizarCampo(campo: keyof FormularioBruto, valor: string) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
  }

  function revisar() {
    const validacao = validarRascunho(formulario);
    if (!validacao.ok) {
      setErroFormulario(validacao.erro.detalhe);
      return;
    }
    setErroFormulario(null);
    setRascunho(validacao.draft);
    setModo('revisao');
  }

  function voltarParaEdicao() {
    setModo('edicao');
    setErroSalvar(null);
  }

  async function confirmarSalvar() {
    if (!onSave || !rascunho) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      await onSave(rascunho);
      setSalvando(false);
      setSucesso(true);
      setFormulario(FORMULARIO_VAZIO);
      setModo('edicao');
      setRascunho(null);
    } catch {
      // Nunca repassa a mensagem do erro lançado por `onSave` — ela pode
      // vir do backend/integração (ex.: um erro de rede ou de concorrência
      // vindo do adapter em src/central/scheduleApi.ts) e não é confiável
      // para mostrar como está. Mesmo princípio já adotado nos estados
      // `error` desta e de outras fatias (nunca renderizar texto
      // arbitrário vindo de fora).
      setSalvando(false);
      setErroSalvar('Não foi possível salvar esta atribuição agora. Confira e tente novamente.');
    }
  }

  if (state.kind === 'loading') {
    return (
      <section className="panel" aria-label="Cronograma" aria-busy="true">
        <p role="status">Consultando o cronograma…</p>
      </section>
    );
  }

  if (state.kind === 'not_integrated') {
    return (
      <section className="panel" aria-label="Cronograma">
        <div className="empty">
          <span>○</span>
          <h2>Cronograma ainda não integrado</h2>
          <p>
            Este projeto ainda não tem uma fonte autenticada de cronograma. Nenhuma atribuição é
            criada nem estimada aqui.
          </p>
        </div>
      </section>
    );
  }

  if (state.kind === 'error') {
    // Nunca renderiza `state.message` diretamente: é texto que pode vir do
    // backend/integração — mesmo princípio já adotado em
    // src/central/catalogs/TeamsServices.tsx e
    // src/central/properties/PropertiesUnits.tsx.
    return (
      <section className="panel" aria-label="Cronograma">
        <p role="alert" className="alert">
          Não foi possível consultar o cronograma agora. Tente novamente mais tarde.
        </p>
      </section>
    );
  }

  // state.kind === 'ready'
  if (!resultado || !resultado.ok) {
    const detalhe = resultado && !resultado.ok ? resultado.erro.detalhe : 'Conjunto de cronograma inválido.';
    return (
      <section className="panel" aria-label="Cronograma">
        <p role="alert" className="alert">
          Cronograma não exibido: {detalhe}
        </p>
      </section>
    );
  }

  const { assignments, updatedAt } = resultado;
  const termo = search.trim().toLocaleLowerCase();
  const correspondeÀBusca = (a: ScheduleAssignment) =>
    !termo || `${a.personName} ${a.locationName}`.toLocaleLowerCase().includes(termo);

  function rotuloHorario(a: ScheduleAssignment): string {
    if (a.startTime && a.endTime) return `${a.startTime}–${a.endTime}`;
    if (a.startTime) return `A partir de ${a.startTime} · término não informado`;
    if (a.endTime) return `Até ${a.endTime}`;
    return 'Horário não definido';
  }

  function Alertas({ assignmentId }: { assignmentId: string }) {
    const alerta = alertasPorId.get(assignmentId);
    if (!alerta) return null;
    return (
      <>
        {alerta.horarioAusente && <span className="badge">Horário incompleto — confirmar horários</span>}
        {alerta.sobrepoeCom.length > 0 && <span className="badge">Sobrepõe outra atribuição</span>}
      </>
    );
  }

  const filtradas = assignments.filter(correspondeÀBusca);

  const porDia = new Map<string, ScheduleAssignment[]>();
  for (const a of filtradas) {
    const lista = porDia.get(a.date);
    if (lista) lista.push(a);
    else porDia.set(a.date, [a]);
  }
  const diasOrdenados = Array.from(porDia.keys()).sort();

  const porPessoa = new Map<string, { nome: string; itens: ScheduleAssignment[] }>();
  for (const a of filtradas) {
    const grupo = porPessoa.get(a.personId);
    if (grupo) grupo.itens.push(a);
    else porPessoa.set(a.personId, { nome: a.personName, itens: [a] });
  }
  const pessoasOrdenadas = Array.from(porPessoa.entries()).sort((x, y) => x[1].nome.localeCompare(y[1].nome));
  for (const [, grupo] of porPessoa) grupo.itens.sort((x, y) => x.date.localeCompare(y.date));

  return (
    <section className="panel" aria-label="Cronograma">
      <div className="panel-title">
        <h2>
          Cronograma <small>{assignments.length}</small>
        </h2>
        <input
          aria-label="Buscar pessoa ou local"
          placeholder="Buscar pessoa ou local"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <p className="muted">Horários exibidos em {SCHEDULE_TIMEZONE}. Planejamento — não equivale a horas realmente trabalhadas.</p>
      {updatedAt && <p className="muted">Atualizado na fonte: {updatedAt}.</p>}
      <div className="filters">
        <button aria-pressed={view === 'day'} onClick={() => setView('day')}>
          Por dia
        </button>
        <button aria-pressed={view === 'person'} onClick={() => setView('person')}>
          Por pessoa
        </button>
      </div>
      {assignments.length === 0 ? (
        <div className="empty">
          <span>○</span>
          <h2>Nenhuma atribuição registrada neste projeto</h2>
          <p>A fonte confirmou que este projeto ainda não tem cronograma cadastrado.</p>
        </div>
      ) : view === 'day' ? (
        diasOrdenados.length === 0 ? (
          <p className="muted">Nenhuma atribuição encontrada para esta busca.</p>
        ) : (
          diasOrdenados.map((dia) => (
            <div key={dia} className="table-scroll">
              <h3>{dia}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Local</th>
                    <th>Horário</th>
                    <th>Alertas</th>
                  </tr>
                </thead>
                <tbody>
                  {(porDia.get(dia) ?? []).map((a) => (
                    <tr key={a.assignmentId}>
                      <td>{a.personName}</td>
                      <td className="accent">{a.locationName}</td>
                      <td>{rotuloHorario(a)}</td>
                      <td>
                        <Alertas assignmentId={a.assignmentId} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )
      ) : pessoasOrdenadas.length === 0 ? (
        <p className="muted">Nenhuma atribuição encontrada para esta busca.</p>
      ) : (
        pessoasOrdenadas.map(([personId, grupo]) => (
          <div key={personId} className="table-scroll">
            <h3>{grupo.nome}</h3>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Local</th>
                  <th>Horário</th>
                  <th>Alertas</th>
                </tr>
              </thead>
              <tbody>
                {grupo.itens.map((a) => (
                  <tr key={a.assignmentId}>
                    <td>{a.date}</td>
                    <td className="accent">{a.locationName}</td>
                    <td>{rotuloHorario(a)}</td>
                    <td>
                      <Alertas assignmentId={a.assignmentId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <h3>Nova atribuição (entrada manual)</h3>
      <p className="notice">
        Os dados reais do cronograma ainda não estão integrados a esta tela. Esta entrada manual
        serve para revisar uma atribuição antes de salvar — ela não inventa escala nem confirma
        disponibilidade de ninguém.
      </p>
      {modo === 'edicao' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            revisar();
          }}
        >
          <label>
            Pessoa (ID)
            <input
              aria-label="ID da pessoa"
              value={formulario.personId}
              onChange={(e) => atualizarCampo('personId', e.target.value)}
            />
          </label>
          <label>
            Pessoa (nome)
            <input
              aria-label="Nome da pessoa"
              value={formulario.personName}
              onChange={(e) => atualizarCampo('personName', e.target.value)}
            />
          </label>
          <label>
            Local (ID)
            <input
              aria-label="ID do local"
              value={formulario.locationId}
              onChange={(e) => atualizarCampo('locationId', e.target.value)}
            />
          </label>
          <label>
            Local (nome)
            <input
              aria-label="Nome do local"
              value={formulario.locationName}
              onChange={(e) => atualizarCampo('locationName', e.target.value)}
            />
          </label>
          <label>
            Data
            <input
              aria-label="Data"
              placeholder="AAAA-MM-DD"
              value={formulario.date}
              onChange={(e) => atualizarCampo('date', e.target.value)}
            />
          </label>
          <label>
            Início (opcional)
            <input
              aria-label="Horário de início"
              placeholder="HH:mm"
              value={formulario.startTime}
              onChange={(e) => atualizarCampo('startTime', e.target.value)}
            />
          </label>
          <label>
            Término (opcional)
            <input
              aria-label="Horário de término"
              placeholder="HH:mm"
              value={formulario.endTime}
              onChange={(e) => atualizarCampo('endTime', e.target.value)}
            />
          </label>
          {erroFormulario && (
            <p role="alert" className="alert">
              {erroFormulario}
            </p>
          )}
          <button className="primary" type="submit">
            Revisar atribuição
          </button>
        </form>
      ) : (
        rascunho && (
          <div className="notice">
            <h3>Confira antes de salvar</h3>
            <p>
              <strong>{rascunho.personName}</strong> ({rascunho.personId}) em{' '}
              <strong>{rascunho.locationName}</strong> ({rascunho.locationId}), em {rascunho.date}.
            </p>
            <p>
              Horário:{' '}
              {rascunho.startTime || rascunho.endTime
                ? `${rascunho.startTime ?? 'não definido'} – ${rascunho.endTime ?? 'não definido'}`
                : 'não definido'}{' '}
              ({SCHEDULE_TIMEZONE}).
            </p>
            {!onSave && (
              <p className="muted">
                O salvamento ainda não está integrado a esta tela — esta é só a etapa de revisão.
              </p>
            )}
            {erroSalvar && (
              <p role="alert" className="alert">
                {erroSalvar}
              </p>
            )}
            <button className="primary" disabled={!onSave || salvando} onClick={confirmarSalvar}>
              {salvando ? 'Salvando…' : 'Confirmar e salvar'}
            </button>
            <button disabled={salvando} onClick={voltarParaEdicao}>
              Voltar e editar
            </button>
          </div>
        )
      )}
      {sucesso && <p role="status">Atribuição enviada para salvamento.</p>}
    </section>
  );
}
