import { describe, expect, it } from 'vitest';
import {
  calcularCronogramaOS,
  construirEixoRegua,
  construirRegua,
  diasDoEixo,
  posicionarBarra,
  sobreposicaoDeEquipe,
} from '../cronograma';
import type { CalendarioTrabalho } from '../cronograma';
import type { OrdemServico } from '../types';

function ordemBase(overrides: Partial<OrdemServico> = {}): OrdemServico {
  return {
    os: 'OS-1',
    endereco: '',
    cidade: '',
    statusTexto: 'A executar',
    estado: 'NAO_INICIADA',
    escopo: 'Pintura',
    protecoes: '',
    dependenciasObservacoes: '',
    evidenciasTexto: '',
    ultimaAtualizacao: '',
    isTeste: false,
    temEtapaAplicavel: true,
    aprovacaoQualidade: { resultado: 'pendente', semEvidencia: true },
    ...overrides,
  };
}

describe('calcularCronogramaOS — nunca fabrica data/duração', () => {
  it('OS sem nenhuma data vai para a fila pendente', () => {
    const r = calcularCronogramaOS(ordemBase());
    expect(r.semProgramacao).toBe(true);
    expect(r.barraPlanejada).toBeUndefined();
  });

  it('duração ausente: barra com ponta aberta, nunca um fim estimado', () => {
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.semProgramacao).toBe(false);
    expect(r.barraPlanejada?.fim).toBeUndefined();
    expect(r.barraPlanejada?.fimEstimado).toBe(false);
  });

  it('só horas-pessoa, sem calendário: nenhuma barra, só anotação — nunca converte para dias', () => {
    const ordem = ordemBase({
      planejamento: {
        duracaoPlanejada: { valor: 6, unidade: 'horas-pessoa' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.semProgramacao).toBe(true);
    expect(r.barraPlanejada).toBeUndefined();
    expect(r.anotacaoHorasPessoa).toMatch(/6 horas-pessoa/);
  });

  it('CORREÇÃO: duração em "horas" (tempo real, não esforço) também nunca projeta um dia-fim sozinha — distinto de horas-pessoa no rótulo', () => {
    const ordem = ordemBase({
      planejamento: {
        duracaoPlanejada: { valor: 4, unidade: 'horas' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.semProgramacao).toBe(true);
    expect(r.barraPlanejada).toBeUndefined();
    expect(r.anotacaoHorasPessoa).toMatch(/4 horas \(tempo real, não é esforço\)/);
  });

  it('CORREÇÃO (revisão independente, item 1): dias-corridos informados projeta o fim com convenção INCLUSIVA — 3 dias a partir de 06/10 termina em 08/10 (3 células: 06,07,08), nunca 09/10 (o que daria 4 células para uma duração de 3 dias)', () => {
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 },
        duracaoPlanejada: { valor: 3, unidade: 'dias-corridos' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.barraPlanejada?.fim).toEqual({ ano: 2026, mes: 10, dia: 8 });
    expect(r.barraPlanejada?.fimEstimado).toBe(true);
    expect(r.barraPlanejada?.erroIntervalo).toBeUndefined();
  });

  it('duração de 1 dia corrido ocupa exatamente 1 célula (início === fim)', () => {
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 },
        duracaoPlanejada: { valor: 1, unidade: 'dias-corridos' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.barraPlanejada?.fim).toEqual({ ano: 2026, mes: 10, dia: 6 });
    const eixo = construirEixoRegua([r])!;
    const pos = posicionarBarra(eixo, r.barraPlanejada!);
    expect(pos.larguraDias).toBe(1);
  });

  it('data de fim explicitamente informada (dataFimPlanejada) nunca é alterada pela convenção de fim inclusivo — ela já É o fim, como informado na planilha', () => {
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 },
        dataFimPlanejada: { ano: 2026, mes: 10, dia: 20 }, // bem além do que a duração sugeriria
        duracaoPlanejada: { valor: 3, unidade: 'dias-corridos' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.barraPlanejada?.fim).toEqual({ ano: 2026, mes: 10, dia: 20 });
    expect(r.barraPlanejada?.fimEstimado).toBe(false); // informado, não projetado
  });

  it('CORREÇÃO (revisão independente, item 1): fim anterior ao início (dataFimPlanejada) vira erro/pendência explícita — NUNCA uma barra de 1 dia silenciosa', () => {
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 10 },
        dataFimPlanejada: { ano: 2026, mes: 10, dia: 6 }, // invertido — erro de digitação na planilha, por ex.
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.barraPlanejada?.fim).toBeUndefined();
    expect(r.barraPlanejada?.erroIntervalo).toMatch(/anterior ao início/);
    // Nunca deve ser tratada como "sem programação" (dado ausente) — é dado
    // presente, só inválido; continua aparecendo (com o erro) na régua.
    expect(r.semProgramacao).toBe(false);
  });

  it('CORREÇÃO (revisão independente, item 1): fim real anterior ao início real também vira erro/pendência, nunca um dia plausível via Math.max', () => {
    const ordem = ordemBase({
      realizado: {
        dataInicioReal: { ano: 2026, mes: 9, dia: 18 },
        dataFimReal: { ano: 2026, mes: 9, dia: 15 },
      },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.barraReal?.fim).toBeUndefined();
    expect(r.barraReal?.erroIntervalo).toMatch(/anterior ao início/);
  });

  it('posicionarBarra nunca esconde um erroIntervalo atrás de uma largura de 1 dia comum — expõe `erro` explicitamente', () => {
    const eixo = { diaInicio: { ano: 2026, mes: 10, dia: 1 }, diaFim: { ano: 2026, mes: 10, dia: 10 }, totalDias: 10 };
    const barraComErro = {
      tipo: 'planejada' as const,
      os: 'OS-1',
      inicio: { ano: 2026, mes: 10, dia: 10 },
      fimEstimado: false,
      erroIntervalo: 'Fim (2026-10-06) é anterior ao início (2026-10-10) — intervalo inválido, não uma barra de 1 dia.',
    };
    const pos = posicionarBarra(eixo, barraComErro);
    expect(pos.erro).toBeDefined();
    expect(pos.pontaAberta).toBe(false); // nunca confundido com "fim ainda não definido"
  });

  it('data informada isolada de TEST-001 nunca vira barra de duração (é só DataServicoInformada, sem início/fim)', () => {
    const test001 = ordemBase({
      os: 'TEST-001',
      isTeste: true,
      dataServicoInformada: { ano: 2026, mes: 10, dia: 2 },
      // Deliberadamente SEM planejamento/realizado — é só uma data informada isolada.
    });
    const r = calcularCronogramaOS(test001);
    expect(r.semProgramacao).toBe(true);
    expect(r.barraPlanejada).toBeUndefined();
    expect(r.barraReal).toBeUndefined();
  });

  it('alteração de planejamento nunca reescreve o realizado — são sempre dois conjuntos de campos', () => {
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 10 }, // replanejado
        equipeResponsavel: [],
        versaoPlanejamento: 2,
      },
      realizado: { dataInicioReal: { ano: 2026, mes: 10, dia: 6 }, dataFimReal: { ano: 2026, mes: 10, dia: 8 } },
    });
    const r = calcularCronogramaOS(ordem);
    expect(r.barraReal?.inicio).toEqual({ ano: 2026, mes: 10, dia: 6 });
    expect(r.barraPlanejada?.inicio).toEqual({ ano: 2026, mes: 10, dia: 10 });
  });
});

describe('construirRegua — exclui teste da régua real', () => {
  it('TEST-001 nunca aparece na régua real, mesmo com dados completos', () => {
    const producao = ordemBase({
      os: 'OS-1',
      planejamento: { dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 }, equipeResponsavel: [], versaoPlanejamento: 1 },
    });
    const teste = ordemBase({
      os: 'TEST-001',
      isTeste: true,
      planejamento: { dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 }, equipeResponsavel: [], versaoPlanejamento: 1 },
    });
    const { comProgramacao, filaPendente } = construirRegua([producao, teste]);
    expect(comProgramacao.map((r) => r.os)).toEqual(['OS-1']);
    expect(filaPendente.length).toBe(0);
  });
});

describe('sobreposicaoDeEquipe — só avisa, nunca bloqueia', () => {
  it('detecta pessoa em comum em janelas planejadas que se cruzam', () => {
    const a = {
      barra: { tipo: 'planejada' as const, os: 'OS-1', inicio: { ano: 2026, mes: 10, dia: 6 }, fim: { ano: 2026, mes: 10, dia: 10 }, fimEstimado: true },
      equipe: ['joao', 'maria'],
    };
    const b = {
      barra: { tipo: 'planejada' as const, os: 'OS-2', inicio: { ano: 2026, mes: 10, dia: 8 }, fim: { ano: 2026, mes: 10, dia: 12 }, fimEstimado: true },
      equipe: ['maria', 'pedro'],
    };
    expect(sobreposicaoDeEquipe(a, b)).toEqual(['maria']);
  });

  it('nenhuma ponta de calendário conhecida -> não arrisca aviso', () => {
    const a = {
      barra: { tipo: 'planejada' as const, os: 'OS-1', inicio: { ano: 2026, mes: 10, dia: 6 }, fimEstimado: false },
      equipe: ['joao'],
    };
    const b = {
      barra: { tipo: 'planejada' as const, os: 'OS-2', inicio: { ano: 2026, mes: 10, dia: 8 }, fimEstimado: false },
      equipe: ['joao'],
    };
    expect(sobreposicaoDeEquipe(a, b)).toEqual([]);
  });
});

describe('geometria da régua — eixo comum e posição das barras (correção obrigatória: régua de verdade, não pílulas)', () => {
  it('sem nenhuma barra (tudo pendente), não há eixo — nunca desenha um eixo vazio/inventado', () => {
    const ordem = ordemBase();
    const { comProgramacao } = construirRegua([ordem]);
    expect(construirEixoRegua(comProgramacao)).toBeUndefined();
  });

  it('eixo cobre do menor ao maior dia entre todas as barras (planejadas e reais)', () => {
    const a = ordemBase({
      os: 'OS-1',
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 },
        duracaoPlanejada: { valor: 3, unidade: 'dias-corridos' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const b = ordemBase({
      os: 'OS-2',
      realizado: { dataInicioReal: { ano: 2026, mes: 10, dia: 1 }, dataFimReal: { ano: 2026, mes: 10, dia: 2 } },
    });
    const { comProgramacao } = construirRegua([a, b]);
    const eixo = construirEixoRegua(comProgramacao)!;
    expect(eixo.diaInicio).toEqual({ ano: 2026, mes: 10, dia: 1 }); // menor dia: início real de OS-2
    // Convenção de fim INCLUSIVO (correção obrigatória, item 1): fim projetado de OS-1 é 6+(3-1)=8, não 9.
    expect(eixo.diaFim).toEqual({ ano: 2026, mes: 10, dia: 8 });
    expect(eixo.totalDias).toBe(8);
    expect(diasDoEixo(eixo)).toHaveLength(8);
    expect(diasDoEixo(eixo)[0]).toEqual({ ano: 2026, mes: 10, dia: 1 });
    expect(diasDoEixo(eixo)[7]).toEqual({ ano: 2026, mes: 10, dia: 8 });
  });

  it('posicionarBarra: offset e largura corretos para uma barra com fim conhecido', () => {
    const eixo = { diaInicio: { ano: 2026, mes: 10, dia: 1 }, diaFim: { ano: 2026, mes: 10, dia: 10 }, totalDias: 10 };
    const barra = {
      tipo: 'planejada' as const,
      os: 'OS-1',
      inicio: { ano: 2026, mes: 10, dia: 6 },
      fim: { ano: 2026, mes: 10, dia: 8 },
      fimEstimado: false,
    };
    const pos = posicionarBarra(eixo, barra);
    expect(pos.offsetDias).toBe(5); // dia 6 é o 6º do eixo -> offset 5 (0-based)
    expect(pos.larguraDias).toBe(3); // 6,7,8 = 3 dias
    expect(pos.pontaAberta).toBe(false);
  });

  it('posicionarBarra: ponta aberta (sem fim) nunca estende uma largura adivinhada — ocupa só o dia de início', () => {
    const eixo = { diaInicio: { ano: 2026, mes: 10, dia: 1 }, diaFim: { ano: 2026, mes: 10, dia: 10 }, totalDias: 10 };
    const barra = {
      tipo: 'real' as const,
      os: 'OS-1',
      inicio: { ano: 2026, mes: 10, dia: 4 },
      fimEstimado: false,
    };
    const pos = posicionarBarra(eixo, barra);
    expect(pos.larguraDias).toBe(1);
    expect(pos.pontaAberta).toBe(true);
  });
});

describe('dias-uteis — CORREÇÃO (revisão independente, item 3): nunca presume segunda-a-sexta por padrão', () => {
  it('sem calendário de trabalho declarado: preserva a duração informada e deixa o fim em aberto ("a definir"), nunca projeta um fim adivinhado', () => {
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 10 }, // sábado
        duracaoPlanejada: { valor: 5, unidade: 'dias-uteis' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    // Chamada SEM calendário (o caminho real nunca passa um — nenhuma fonte
    // de calendário de trabalho existe hoje).
    const r = calcularCronogramaOS(ordem);
    expect(r.semProgramacao).toBe(false); // já tem início: vira barra de ponta aberta, não "sem dado"
    expect(r.barraPlanejada?.fim).toBeUndefined();
    expect(r.barraPlanejada?.fimEstimado).toBe(false);
    expect(r.barraPlanejada?.duracaoRotulo).toMatch(/5 dias úteis/); // duração preservada, nunca descartada
    expect(r.barraPlanejada?.erroIntervalo).toBeUndefined(); // "a definir" não é um erro
  });

  it('com um calendário EXPLICITAMENTE declarado (ex.: fixture de demonstração separada dos dados reais), a projeção funciona — segunda a sexta', () => {
    const calendarioSegundaASexta: CalendarioTrabalho = { diasUteisSemana: [1, 2, 3, 4, 5] };
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 5 }, // segunda-feira
        duracaoPlanejada: { valor: 5, unidade: 'dias-uteis' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem, calendarioSegundaASexta);
    // 5 dias úteis a partir de segunda (05/10), seg-sex: 05,06,07,08,09 -> fim sexta 09/10 (5 células).
    expect(r.barraPlanejada?.fim).toEqual({ ano: 2026, mes: 10, dia: 9 });
    expect(r.barraPlanejada?.fimEstimado).toBe(true);
    const eixo = construirEixoRegua([r])!;
    const pos = posicionarBarra(eixo, r.barraPlanejada!);
    expect(pos.larguraDias).toBe(5); // 5 dias úteis -> exatamente 5 células, mesma convenção inclusiva
  });

  it('um calendário declarado DIFERENTE (ex.: terça a sábado) muda a projeção — prova que não há jornada fixa embutida em cronograma.ts', () => {
    const calendarioTercaASabado: CalendarioTrabalho = { diasUteisSemana: [2, 3, 4, 5, 6] };
    const ordem = ordemBase({
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 }, // terça-feira
        duracaoPlanejada: { valor: 3, unidade: 'dias-uteis' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const r = calcularCronogramaOS(ordem, calendarioTercaASabado);
    // 3 dias úteis a partir de terça (06/10), ter-sáb: 06,07,08 -> fim quinta 08/10.
    expect(r.barraPlanejada?.fim).toEqual({ ano: 2026, mes: 10, dia: 8 });
  });

  it('construirRegua propaga o calendário declarado a todas as OS — nunca recalcula por fora', () => {
    const calendarioSegundaASexta: CalendarioTrabalho = { diasUteisSemana: [1, 2, 3, 4, 5] };
    const ordem = ordemBase({
      os: 'OS-9',
      planejamento: {
        dataInicioPlanejada: { ano: 2026, mes: 10, dia: 5 },
        duracaoPlanejada: { valor: 2, unidade: 'dias-uteis' },
        equipeResponsavel: [],
        versaoPlanejamento: 1,
      },
    });
    const { comProgramacao } = construirRegua([ordem], calendarioSegundaASexta);
    expect(comProgramacao[0].barraPlanejada?.fim).toEqual({ ano: 2026, mes: 10, dia: 6 });
  });
});
