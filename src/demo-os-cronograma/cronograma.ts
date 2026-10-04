// Régua de dias — cálculo puro da barra de cada OS, sem fabricar dado algum.
//
// Regras obrigatórias (ver v2 seção 1 e COMPLEMENTO, seção 1):
// - Duração não é esforço: horas-pessoa nunca vira duração de calendário
//   sem uma data/duração em calendário também informada (correção 1 da
//   entrega de código — nunca presumir jornada de trabalho). O mesmo vale
//   para `horas` (duração real, mas sem hora-do-dia registrada — ver
//   types.ts#UnidadeDuracao): nunca projeta um dia-fim sozinha.
// - OS sem data nenhuma vai para a fila de programação pendente, nunca
//   ganha uma barra com data adivinhada.
// - Planejado e realizado são sempre dois conjuntos de campos distintos.
// - Duração inválida (ver `duracao.ts`) nunca chega a virar barra — é
//   tratada como ausente, com o motivo preservado em `duracaoInvalidaMotivo`
//   (setado na normalização, ver `osApi.ts`), nunca corrigida em silêncio.
import type { DiaLocal, OrdemServico, PlanejamentoOS, RealizadoOS, UnidadeDuracao } from './types';
import type { CalendarioTrabalho } from './diaLocal';
import { compararDiaLocal, diferencaEmDiasCorridos, formatarDiaLocal, somarDiasCorridos, somarDiasUteis } from './diaLocal';

export type { CalendarioTrabalho };

export type TipoBarra = 'planejada' | 'real';

// ---------------------------------------------------------------------------
// Convenção de fim de intervalo (correção obrigatória — revisão independente
// do patch original, item 1): FIM É SEMPRE INCLUSIVO. Uma duração de N dias
// corridos a partir de um início ocupa exatamente N dias de calendário
// (início, início+1, ..., início+N-1) — nunca N+1. A entrega anterior
// projetava `fim = início + N` (válido só para um fim EXCLUSIVO) mas
// `posicionarBarra` já tratava `fim` como INCLUSIVO (`diferença + 1`
// células) — a combinação das duas convenções produzia uma célula a mais
// que a duração informada. Esta correção alinha a projeção à convenção
// inclusiva já usada na geometria; datas explicitamente informadas
// (`dataFimPlanejada`/`dataFimReal`) nunca são alteradas por esta regra —
// elas já são, por definição, o fim informado, seja qual for a convenção de
// quem preencheu a planilha.
// ---------------------------------------------------------------------------

export interface BarraCronograma {
  tipo: TipoBarra;
  os: string;
  inicio: DiaLocal;
  /** Ausente = ponta aberta (fim não definido) OU intervalo inválido — ver `erroIntervalo`. Nunca estimado. */
  fim?: DiaLocal;
  fimEstimado: boolean;
  /** Unidade/valor de origem da duração, só para rótulo — nunca recalculada aqui. */
  duracaoRotulo?: string;
  /**
   * Preenchido quando o fim (informado OU projetado) é anterior ao início —
   * correção obrigatória (revisão independente, item 1): isso NUNCA pode
   * virar uma barra de 1 dia silenciosa via `Math.max(1, ...)` na geometria.
   * Quando este campo está presente, `fim` é sempre `undefined`: o
   * intervalo é tratado como um erro/pendência explícita, nunca como uma
   * "ponta aberta" comum (que significa "fim ainda não definido", não "fim
   * definido errado").
   */
  erroIntervalo?: string;
}

export interface ResultadoCronogramaOS {
  os: string;
  endereco: string;
  barraPlanejada?: BarraCronograma;
  barraReal?: BarraCronograma;
  /** true quando nenhuma data (planejada ou real) existe — entra na fila pendente. */
  semProgramacao: boolean;
  anotacaoHorasPessoa?: string;
  /** Duração informada mas inválida (ver `duracao.ts`) — nunca vira barra, só este aviso. */
  duracaoInvalidaMotivo?: string;
}

function rotuloDuracao(valor: number, unidade: UnidadeDuracao): string {
  const unidadeTexto: Record<UnidadeDuracao, string> = {
    horas: 'horas',
    'horas-pessoa': 'horas-pessoa',
    'dias-corridos': 'dias corridos',
    'dias-uteis': 'dias úteis',
  };
  return `${valor} ${unidadeTexto[unidade]}`;
}

function projetarFimPlanejado(
  inicio: DiaLocal,
  planejamento: PlanejamentoOS,
  calendarioTrabalhoDeclarado?: CalendarioTrabalho
): { fim?: DiaLocal; estimado: boolean } {
  if (planejamento.dataFimPlanejada) return { fim: planejamento.dataFimPlanejada, estimado: false };
  const duracao = planejamento.duracaoPlanejada;
  if (!duracao) return { fim: undefined, estimado: false };
  // Regra central da correção 1: nem horas-pessoa (esforço) nem horas
  // (duração real sem hora-do-dia registrada) geram uma projeção de
  // calendário — não há jornada de trabalho nem horário de início
  // presumidos neste sistema.
  if (duracao.unidade === 'horas-pessoa' || duracao.unidade === 'horas') {
    return { fim: undefined, estimado: false };
  }
  if (duracao.unidade === 'dias-corridos') {
    // Convenção de fim INCLUSIVO (ver nota no topo do arquivo): N dias
    // corridos a partir do início ocupam N dias de calendário, logo o fim é
    // início + (N-1), nunca início + N.
    return { fim: somarDiasCorridos(inicio, duracao.valor - 1), estimado: true };
  }
  if (duracao.unidade === 'dias-uteis') {
    // CORREÇÃO (revisão independente, item 3): sem um calendário de
    // trabalho EXPLICITAMENTE declarado por quem chama (nunca um default
    // interno — ver diaLocal.ts#CalendarioTrabalho), esta função NUNCA
    // presume segunda-a-sexta. Uma legenda de limitação não é autorização
    // para presumir a jornada do negócio. Sem calendário: a duração
    // informada é preservada (ver `duracaoRotulo`) e o fim fica em aberto
    // ("a definir"), exatamente como o caso horas/horas-pessoa acima —
    // nunca um erro, só um dado ainda não suficiente para projetar.
    if (!calendarioTrabalhoDeclarado) {
      return { fim: undefined, estimado: false };
    }
    // Mesma convenção de fim inclusivo: N dias úteis a partir do início
    // inclui o próprio início só quando ele é um dia útil; a contagem
    // abaixo soma (N-1) dias úteis ADICIONAIS a partir de início, para que
    // "1 dia útil" com início num dia útil não avance nenhum dia.
    const diasUteisAdicionais = Math.max(0, duracao.valor - 1);
    return {
      fim: diasUteisAdicionais === 0 ? inicio : somarDiasUteis(inicio, diasUteisAdicionais, calendarioTrabalhoDeclarado),
      estimado: true,
    };
  }
  return { fim: undefined, estimado: false };
}

/**
 * Valida que `fim` (informado ou projetado) nunca é anterior a `inicio`.
 * Correção obrigatória (revisão independente, item 1): antes, esse caso só
 * era "escondido" em `posicionarBarra` por um `Math.max(1, ...)` que
 * produzia uma barra de 1 dia plausível — nunca um erro visível. Agora, a
 * barra em si nunca carrega um `fim` inválido: `fim` vira `undefined` e
 * `erroIntervalo` guarda o motivo, para a UI exibir como erro/pendência
 * explícita (nunca como "ponta aberta" comum).
 */
function aplicarValidacaoDeIntervalo(barra: BarraCronograma): BarraCronograma {
  if (!barra.fim) return barra;
  if (compararDiaLocal(barra.fim, barra.inicio) >= 0) return barra;
  return {
    ...barra,
    fim: undefined,
    fimEstimado: false,
    erroIntervalo: `Fim (${formatarDiaLocal(barra.fim)}) é anterior ao início (${formatarDiaLocal(barra.inicio)}) — intervalo inválido, não uma barra de 1 dia.`,
  };
}

function construirBarraPlanejada(
  planejamento: PlanejamentoOS,
  os: string,
  calendarioTrabalhoDeclarado?: CalendarioTrabalho
): BarraCronograma | undefined {
  if (!planejamento.dataInicioPlanejada) return undefined;
  const { fim, estimado } = projetarFimPlanejado(planejamento.dataInicioPlanejada, planejamento, calendarioTrabalhoDeclarado);
  const d = planejamento.duracaoPlanejada;
  return aplicarValidacaoDeIntervalo({
    tipo: 'planejada',
    os,
    inicio: planejamento.dataInicioPlanejada,
    fim,
    fimEstimado: estimado,
    duracaoRotulo: d ? rotuloDuracao(d.valor, d.unidade) : undefined,
  });
}

function construirBarraReal(realizado: RealizadoOS, os: string): BarraCronograma | undefined {
  if (!realizado.dataInicioReal) return undefined;
  return aplicarValidacaoDeIntervalo({
    tipo: 'real',
    os,
    inicio: realizado.dataInicioReal,
    fim: realizado.dataFimReal,
    fimEstimado: false,
  });
}

function anotacaoSomenteDuracao(planejamento?: PlanejamentoOS): string | undefined {
  const d = planejamento?.duracaoPlanejada;
  if (!d) return undefined;
  if (d.unidade !== 'horas-pessoa' && d.unidade !== 'horas') return undefined;
  if (planejamento?.dataInicioPlanejada) return undefined; // já vira barra (ponta aberta)
  if (d.unidade === 'horas') {
    return `duração: ${d.valor} horas (tempo real, não é esforço) — aguardando data para posicionar na régua`;
  }
  return `estimativa: ${d.valor} horas-pessoa (esforço, não é duração de calendário) — aguardando data para posicionar na régua`;
}

/**
 * Calcula o resultado de cronograma de uma OS. Nunca lança — toda ausência
 * de dado vira `semProgramacao: true` ou uma anotação, nunca um erro.
 *
 * `calendarioTrabalhoDeclarado` (correção obrigatória, item 3) só existe
 * quando alguém o fornece explicitamente (ex.: um teste/fixture de
 * demonstração separado dos dados reais) — nunca um default interno aqui.
 * Sem ele, qualquer OS com duração em `dias-uteis` preserva a duração
 * informada e fica com o fim em aberto, igual ao caso horas/horas-pessoa.
 */
export function calcularCronogramaOS(
  ordem: OrdemServico,
  calendarioTrabalhoDeclarado?: CalendarioTrabalho
): ResultadoCronogramaOS {
  // Linhas de teste (ver statusContract/fontes: isTeste é determinado pela
  // origem da aba, não por um campo) nunca entram na régua real.
  const barraPlanejada = ordem.planejamento
    ? construirBarraPlanejada(ordem.planejamento, ordem.os, calendarioTrabalhoDeclarado)
    : undefined;
  const barraReal = ordem.realizado ? construirBarraReal(ordem.realizado, ordem.os) : undefined;
  const anotacaoHorasPessoa = anotacaoSomenteDuracao(ordem.planejamento);
  const semProgramacao = !barraPlanejada && !barraReal;
  return {
    os: ordem.os,
    endereco: ordem.endereco,
    barraPlanejada,
    barraReal,
    semProgramacao,
    anotacaoHorasPessoa,
    duracaoInvalidaMotivo: ordem.planejamento?.duracaoInvalidaMotivo,
  };
}

/**
 * TEST-001 e qualquer outra linha de teste nunca aparecem na régua real —
 * filtradas pela origem (ver `fontes.ts`/`osApi.ts`), não aqui; esta função
 * assume que só chegam linhas já filtradas como não-teste.
 *
 * `calendarioTrabalhoDeclarado`: ver `calcularCronogramaOS` acima — nunca um
 * default interno; o caminho real (App.tsx/osApi.ts) nunca passa um, porque
 * nenhum calendário de trabalho é hoje informado pela fonte de dados real.
 */
export function construirRegua(
  ordens: OrdemServico[],
  calendarioTrabalhoDeclarado?: CalendarioTrabalho
): {
  comProgramacao: ResultadoCronogramaOS[];
  filaPendente: ResultadoCronogramaOS[];
} {
  const resultados = ordens.filter((o) => !o.isTeste).map((o) => calcularCronogramaOS(o, calendarioTrabalhoDeclarado));
  return {
    comProgramacao: resultados.filter((r) => !r.semProgramacao),
    filaPendente: resultados.filter((r) => r.semProgramacao),
  };
}

/** Detecta sobreposição de equipe entre duas barras planejadas — só avisa, nunca bloqueia. */
export function sobreposicaoDeEquipe(
  a: { barra: BarraCronograma; equipe: string[] },
  b: { barra: BarraCronograma; equipe: string[] }
): string[] {
  if (!a.barra.fim || !b.barra.fim) return []; // ponta aberta: não arrisca um aviso sobre um intervalo desconhecido
  const seCruzam =
    diferencaEmDiasCorridos(a.barra.inicio, b.barra.fim) >= 0 &&
    diferencaEmDiasCorridos(b.barra.inicio, a.barra.fim) >= 0;
  if (!seCruzam) return [];
  return a.equipe.filter((pessoa) => b.equipe.includes(pessoa));
}

// ---------------------------------------------------------------------------
// Geometria da régua diária (correção obrigatória — Guardian, rodada 4): a
// entrega anterior só mostrava pílulas com texto de datas, não um eixo de
// dias de verdade. As funções abaixo calculam a geometria (eixo comum e
// posição de cada barra nele) como dado puro, testável sem DOM — a UI
// (OsPanel.tsx) só traduz isso em largura/posição CSS, nunca recalcula.
// ---------------------------------------------------------------------------

export interface EixoRegua {
  diaInicio: DiaLocal;
  diaFim: DiaLocal;
  /** Quantidade de dias cobertos pelo eixo, inclusive — sempre >= 1. */
  totalDias: number;
}

export interface PosicaoNaRegua {
  /** Deslocamento em dias desde `eixo.diaInicio` (0 = primeiro dia do eixo). */
  offsetDias: number;
  /** Largura em dias da barra — sempre >= 1 (nunca uma barra de largura zero). */
  larguraDias: number;
  /** true quando o fim é desconhecido (ponta aberta) — a barra não deve ser desenhada como "concluída". */
  pontaAberta: boolean;
  /**
   * Preenchido quando `barra.erroIntervalo` está presente (fim anterior ao
   * início) — correção obrigatória (revisão independente, item 1): a UI
   * deve desenhar isto como um erro/pendência explícita, nunca como uma
   * barra de 1 dia comum. `larguraDias`/`pontaAberta` ainda vêm
   * preenchidos (por compatibilidade de layout), mas nunca devem ser lidos
   * como "ok" quando `erro` está presente.
   */
  erro?: string;
}

/**
 * Constrói o eixo comum (menor e maior dia entre todas as barras conhecidas
 * — planejadas e reais). Devolve `undefined` quando não há nenhuma barra
 * (fila 100% pendente) — a UI deve então só mostrar a fila, sem desenhar um
 * eixo vazio/inventado.
 */
export function construirEixoRegua(resultados: ResultadoCronogramaOS[]): EixoRegua | undefined {
  const dias: DiaLocal[] = [];
  resultados.forEach((r) => {
    if (r.barraPlanejada) {
      dias.push(r.barraPlanejada.inicio);
      if (r.barraPlanejada.fim) dias.push(r.barraPlanejada.fim);
    }
    if (r.barraReal) {
      dias.push(r.barraReal.inicio);
      if (r.barraReal.fim) dias.push(r.barraReal.fim);
    }
  });
  if (dias.length === 0) return undefined;
  let min = dias[0];
  let max = dias[0];
  dias.forEach((d) => {
    if (compararDiaLocal(d, min) < 0) min = d;
    if (compararDiaLocal(d, max) > 0) max = d;
  });
  return { diaInicio: min, diaFim: max, totalDias: diferencaEmDiasCorridos(min, max) + 1 };
}

/**
 * Posiciona uma barra dentro do eixo comum. Uma barra com ponta aberta
 * (sem `fim`) ocupa só o dia de início conhecido — nunca estende uma
 * largura baseada num fim adivinhado.
 */
export function posicionarBarra(eixo: EixoRegua, barra: BarraCronograma): PosicaoNaRegua {
  const offsetDias = Math.max(0, diferencaEmDiasCorridos(eixo.diaInicio, barra.inicio));
  if (barra.erroIntervalo) {
    // CORREÇÃO (revisão independente, item 1): isto NUNCA deve virar uma
    // barra de 1 dia indistinguível de uma "ponta aberta" comum — o
    // `erro` abaixo é obrigatório para quem desenha a régua.
    return { offsetDias, larguraDias: 1, pontaAberta: false, erro: barra.erroIntervalo };
  }
  if (!barra.fim) {
    return { offsetDias, larguraDias: 1, pontaAberta: true };
  }
  // Convenção de fim INCLUSIVO (ver nota no topo do arquivo): a largura em
  // dias é sempre >= 1 porque `aplicarValidacaoDeIntervalo` já garante que
  // `fim >= inicio` antes de chegar aqui — nunca mais um `Math.max(1, ...)`
  // defensivo escondendo um intervalo invertido.
  const larguraDias = diferencaEmDiasCorridos(barra.inicio, barra.fim) + 1;
  return { offsetDias, larguraDias, pontaAberta: false };
}

/** Lista cada dia do eixo, em ordem — para desenhar os rótulos do eixo comum. */
export function diasDoEixo(eixo: EixoRegua): DiaLocal[] {
  const out: DiaLocal[] = [];
  for (let i = 0; i < eixo.totalDias; i++) out.push(somarDiasCorridos(eixo.diaInicio, i));
  return out;
}
