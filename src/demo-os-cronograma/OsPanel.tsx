// Visão interna do gestor: lista de OS + régua de cronograma. SOMENTE
// LEITURA nesta fatia — nenhuma gravação, nenhuma integração ativa,
// nenhuma aprovação.
//
// Este arquivo é idêntico, em lógica, ao componente já revisado (só ganhou
// este import de CSS próprio, para a demo publicada não depender de
// nenhuma folha de estilo do app real — ver OsPanel.css ao lado).
import { useEffect, useMemo, useState } from 'react';
import type { LeituraFonte, OrdemServico } from './types';
import { FonteStatus } from './FonteStatus';
import { construirRegua, construirEixoRegua, diasDoEixo, posicionarBarra } from './cronograma';
import { selecionarOsPorClique } from './selecao';
import { formatarDiaLocal } from './diaLocal';
import { rotuloAprovacao } from './aprovacao';
import './OsPanel.css';

const ROTULO_ESTADO: Record<OrdemServico['estado'], string> = {
  NAO_INICIADA: 'A executar',
  EM_ANDAMENTO: 'Em execução',
  CONCLUIDA_INFORMADA: 'Conclusão informada',
  STATUS_NAO_MAPEADO: 'Status não reconhecido',
};

function OsDetalhe({ os }: { os: OrdemServico }) {
  return (
    <div className="os-detalhe">
      <div className="os-detalhe-head">
        <span>OS</span>
        <h2>{os.os}</h2>
        <i className={`os-pill os-pill-${os.estado.toLowerCase()}`}>{ROTULO_ESTADO[os.estado]}</i>
      </div>
      <dl>
        <div>
          <dt>Endereço</dt>
          <dd>{os.endereco || '—'} {os.cidade ? `· ${os.cidade}` : ''}</dd>
        </div>
        <div>
          <dt>Escopo</dt>
          <dd>{os.escopo || 'Sem detalhamento registrado ainda'}</dd>
        </div>
        <div>
          <dt>Proteções / Não remover</dt>
          <dd>{os.protecoes || '—'}</dd>
        </div>
        <div>
          <dt>Dependências / Observações</dt>
          <dd>{os.dependenciasObservacoes || '—'}</dd>
        </div>
        <div>
          <dt>Aprovação de qualidade</dt>
          <dd>{rotuloAprovacao(os.aprovacaoQualidade)}</dd>
        </div>
        <div>
          <dt>Equipe atribuída (planejamento)</dt>
          <dd>
            {os.planejamento?.equipeResponsavel.length
              ? os.planejamento.equipeResponsavel.join(', ')
              : 'Sem equipe atribuída ainda'}
          </dd>
        </div>
        {os.planejamento?.duracaoInvalidaMotivo && (
          <div>
            <dt>Duração informada</dt>
            <dd className="os-aviso-inline">{os.planejamento.duracaoInvalidaMotivo}</dd>
          </div>
        )}
        <div>
          <dt>Presença confirmada (Registros)</dt>
          <dd>Indisponível — vínculo Registros↔OS ainda não implementado (ver plano, seção 4.2)</dd>
        </div>
      </dl>
      <p className="etapa-aviso">
        Este sistema ainda não tem uma entidade formal de "etapa" (ver plano, seção 1.4) — os campos acima são
        exatamente os já registrados para esta OS, sem etapas inventadas.
      </p>
    </div>
  );
}

/**
 * Régua diária de verdade — correção obrigatória (Guardian, rodada 4): a
 * entrega anterior só mostrava pílulas com texto de datas. Aqui, cada OS
 * programada ganha uma linha num eixo comum de dias (cabeçalho com cada dia
 * identificado), com barras planejada/real posicionadas e dimensionadas
 * proporcionalmente (ver cronograma.ts#construirEixoRegua/posicionarBarra —
 * geometria pura e testada, esta função só traduz em CSS).
 *
 * Mobile: a grade inteira rola horizontalmente (.regua-scroll), mas a
 * coluna de identificação da OS fica fixa (`position: sticky`) para nunca
 * perder a referência de qual linha é qual ao rolar.
 */
function ReguaDiaria({
  resultados,
  osSelecionadaId,
  onSelecionar,
}: {
  resultados: ReturnType<typeof construirRegua>['comProgramacao'];
  osSelecionadaId: string | undefined;
  onSelecionar: (os: string) => void;
}) {
  const eixo = useMemo(() => construirEixoRegua(resultados), [resultados]);
  if (!eixo || resultados.length === 0) {
    return (
      <p className="regua-vazia">
        Nenhuma OS com data conhecida ainda (nesta leitura completa e autorizada) — ver fila de programação pendente
        abaixo.
      </p>
    );
  }
  const dias = diasDoEixo(eixo);
  const largCol = 34; // px por dia — só a UI; a geometria em si (dias) vem de cronograma.ts
  const largTotal = dias.length * largCol;

  return (
    <div className="regua-wrap">
      <div className="regua-legenda">
        <span><i className="regua-amostra regua-amostra-planejada" /> Planejado</span>
        <span><i className="regua-amostra regua-amostra-real" /> Realizado</span>
        <span><i className="regua-amostra regua-amostra-projetado" /> Fim projetado (estimado a partir da duração)</span>
        <span><i className="regua-amostra regua-amostra-aberta" /> Ponta aberta (fim não definido)</span>
        <span><i className="regua-amostra regua-amostra-erro" /> Intervalo inválido (fim anterior ao início) — ver detalhe</span>
      </div>
      <div className="regua-scroll">
        <div className="regua-grade" style={{ minWidth: largCol * dias.length + 150 }}>
          <div className="regua-eixo" style={{ gridTemplateColumns: `150px repeat(${dias.length}, ${largCol}px)` }}>
            <div className="regua-eixo-rotulo">Eixo de dias</div>
            {dias.map((d) => (
              <div key={formatarDiaLocal(d)} className="regua-eixo-dia" title={formatarDiaLocal(d)}>
                {String(d.dia).padStart(2, '0')}
                <small>{String(d.mes).padStart(2, '0')}</small>
              </div>
            ))}
          </div>
          {resultados.map((r) => (
            <button
              key={r.os}
              className={`regua-linha-grade ${osSelecionadaId === r.os ? 'sel' : ''}`}
              style={{ gridTemplateColumns: `150px ${largTotal}px` }}
              onClick={() => onSelecionar(r.os)}
            >
              <span className="regua-id-sticky">
                <b>{r.os}</b>
                <small>{r.endereco}</small>
              </span>
              <span className="regua-trilha" style={{ width: largTotal }}>
                {r.barraPlanejada &&
                  (() => {
                    const pos = posicionarBarra(eixo, r.barraPlanejada);
                    const titulo = pos.erro
                      ? `Planejado — ERRO: ${pos.erro}`
                      : `Planejado: ${formatarDiaLocal(r.barraPlanejada.inicio)}${r.barraPlanejada.fim ? ` → ${formatarDiaLocal(r.barraPlanejada.fim)}` : ' (fim não definido)'}${r.barraPlanejada.fimEstimado ? ' — fim projetado' : ''}${r.barraPlanejada.duracaoRotulo ? ` — duração: ${r.barraPlanejada.duracaoRotulo}` : ''}`;
                    return (
                      <span
                        className={`regua-barra regua-barra-planejada ${r.barraPlanejada.fimEstimado ? 'regua-barra-projetada' : ''} ${pos.pontaAberta ? 'regua-barra-aberta' : ''} ${pos.erro ? 'regua-barra-erro' : ''}`}
                        style={{ left: pos.offsetDias * largCol, width: pos.larguraDias * largCol - 4 }}
                        title={titulo}
                      >
                        {pos.erro ? <em>⚠ intervalo inválido</em> : r.barraPlanejada.duracaoRotulo && <em>{r.barraPlanejada.duracaoRotulo}</em>}
                      </span>
                    );
                  })()}
                {r.barraReal &&
                  (() => {
                    const pos = posicionarBarra(eixo, r.barraReal);
                    const titulo = pos.erro
                      ? `Real — ERRO: ${pos.erro}`
                      : `Real: ${formatarDiaLocal(r.barraReal.inicio)}${r.barraReal.fim ? ` → ${formatarDiaLocal(r.barraReal.fim)}` : ' (em andamento)'}`;
                    return (
                      <span
                        className={`regua-barra regua-barra-real ${pos.pontaAberta ? 'regua-barra-aberta' : ''} ${pos.erro ? 'regua-barra-erro' : ''}`}
                        style={{ left: pos.offsetDias * largCol, width: pos.larguraDias * largCol - 4, top: 22 }}
                        title={titulo}
                      />
                    );
                  })()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OsPanel({
  leitura,
  demo,
  chaveContexto,
}: {
  leitura: LeituraFonte<OrdemServico[]>;
  demo: boolean;
  /**
   * Identifica o contexto atual (usuário/projeto) — correção obrigatória
   * (revisão independente): a seleção de OS detalhada era um `useState`
   * local que sobrevivia a uma troca de usuário/projeto, podendo mostrar o
   * detalhe de uma OS de outro contexto por um instante. Ao mudar, a
   * seleção é limpa imediatamente.
   */
  chaveContexto?: string;
}) {
  const [osSelecionadaId, setOsSelecionadaId] = useState<string | undefined>();

  useEffect(() => {
    setOsSelecionadaId(undefined);
  }, [chaveContexto]);

  const ordensProducao = useMemo(() => leitura.dados.filter((o) => !o.isTeste), [leitura.dados]);
  const ordensTeste = useMemo(() => leitura.dados.filter((o) => o.isTeste), [leitura.dados]);

  const emExecucao = ordensProducao.filter((o) => o.estado === 'EM_ANDAMENTO');
  const naoIniciadas = ordensProducao.filter((o) => o.estado === 'NAO_INICIADA');
  const concluidasInformadas = ordensProducao.filter((o) => o.estado === 'CONCLUIDA_INFORMADA');
  const naoMapeadas = ordensProducao.filter((o) => o.estado === 'STATUS_NAO_MAPEADO');

  const { comProgramacao, filaPendente } = construirRegua(ordensProducao);

  const osSelecionada = osSelecionadaId ? selecionarOsPorClique(osSelecionadaId, ordensProducao) : undefined;

  // Correção obrigatória: "carregando"/"indisponível" nunca mostram "0" nos
  // contadores — isso pareceria "zero confirmado" quando na verdade é "nós
  // simplesmente ainda não sabemos". Só mostra o número quando a fonte
  // respondeu de alguma forma (mesmo que vazia/parcial/desatualizada).
  const fonteRespondeu =
    leitura.estado === 'disponivel' ||
    leitura.estado === 'parcial' ||
    leitura.estado === 'vazio' ||
    leitura.estado === 'zero_confirmado' ||
    leitura.estado === 'desatualizado';
  // CORREÇÃO ADICIONAL (revisão independente, item 2): `fonteRespondeu`
  // sozinho não bastava — um estado `parcial` causado por PRODUÇÃO
  // incompleta (`fonteProducaoCompleta === false`, ver osApi.ts) ainda
  // entrava nesta lista, e os contadores/régua/fila calculados a partir de
  // `ordensProducao` (que ficam vazios quando produção não respondeu)
  // apareciam como "0"/"vazio" — indistinguível de zero confirmado. Daqui
  // em diante, QUALQUER seção derivada de produção (contadores, régua, fila
  // pendente) usa `producaoConfiavel`, nunca só `fonteRespondeu`. Isto
  // também cobre, sem nenhuma lógica nova, o caso que o teste manual do
  // usuário bloqueado reproduziu: autorização negada -> `indisponivel` ->
  // `fonteRespondeu` já é false -> `producaoConfiavel` também é false.
  const producaoConfiavel = fonteRespondeu && leitura.fonteProducaoCompleta !== false;
  const contagem = (n: number) => (producaoConfiavel ? String(n) : '—');

  return (
    <section className="os-painel">
      {demo && <aside className="os-demo-aviso">DADOS DE DEMONSTRAÇÃO — não é a produção real</aside>}
      <FonteStatus estado={leitura.estado} motivo={leitura.motivo} ultimaLeituraValidaEm={leitura.ultimaLeituraValidaEm} />
      {leitura.avisos && leitura.avisos.length > 0 && (
        <div className="os-avisos-parciais">
          <b>Leitura parcial — nem tudo veio:</b>
          <ul>
            {leitura.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {typeof leitura.semProjetoAtribuido === 'number' && leitura.semProjetoAtribuido > 0 && (
        <p className="os-sem-projeto-aviso">
          {leitura.semProjetoAtribuido} OS sem projeto associado foram excluídas desta visão (associação ausente nunca
          é exibida por padrão — ver política de autorização).
        </p>
      )}

      <h2>OS — visão interna</h2>
      <div className="os-contadores">
        <article><span>Em execução</span><b>{contagem(emExecucao.length)}</b></article>
        <article><span>A executar</span><b>{contagem(naoIniciadas.length)}</b></article>
        <article><span>Conclusão informada</span><b>{contagem(concluidasInformadas.length)}</b></article>
        {producaoConfiavel && naoMapeadas.length > 0 && (
          <article className="os-contador-alerta">
            <span>Status não reconhecido (legado)</span><b>{naoMapeadas.length}</b>
          </article>
        )}
      </div>
      {producaoConfiavel && ordensTeste.length > 0 && (
        <p className="os-teste-nota">
          {ordensTeste.length} OS de teste (origem: aba de teste) excluída{ordensTeste.length > 1 ? 's' : ''} desta
          contagem de produção.
        </p>
      )}

      <div className="os-lista">
        {ordensProducao.map((o) => (
          <button
            key={o.os}
            className={`os-linha ${osSelecionadaId === o.os ? 'sel' : ''}`}
            onClick={() => setOsSelecionadaId(o.os)}
          >
            <b>{o.os}</b>
            <span>{o.endereco}</span>
            <i className={`os-pill os-pill-${o.estado.toLowerCase()}`}>{ROTULO_ESTADO[o.estado]}</i>
          </button>
        ))}
      </div>

      <h2>Cronograma — régua de dias</h2>
      {producaoConfiavel ? (
        <ReguaDiaria resultados={comProgramacao} osSelecionadaId={osSelecionadaId} onSelecionar={setOsSelecionadaId} />
      ) : (
        <p className="regua-vazia">
          Indisponível — a fonte de produção ainda não respondeu de forma completa (ver aviso acima). A régua só é
          exibida depois de uma leitura completa e autorizada; nunca mostrada como "nenhuma OS" enquanto isso não
          acontece.
        </p>
      )}

      <div className="fila-pendente">
        <h3>
          Fila de programação pendente <span>{producaoConfiavel ? filaPendente.length : '—'}</span>
        </h3>
        {producaoConfiavel ? (
          filaPendente.map((r) => (
            <div key={r.os} className="fila-pendente-item">
              <b>{r.os}</b>
              {r.duracaoInvalidaMotivo ? (
                <span className="os-aviso-inline">{r.duracaoInvalidaMotivo}</span>
              ) : r.anotacaoHorasPessoa ? (
                <span>{r.anotacaoHorasPessoa}</span>
              ) : (
                <span>Sem data informada ainda</span>
              )}
            </div>
          ))
        ) : (
          <p className="fila-pendente-indisponivel">
            Indisponível — mesma causa acima; a fila só é declarada vazia depois de uma leitura completa e
            autorizada da fonte de produção.
          </p>
        )}
      </div>

      {osSelecionada && <OsDetalhe os={osSelecionada} />}
    </section>
  );
}
