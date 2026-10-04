// @vitest-environment jsdom
//
// Teste de COMPONENTE (não só da lógica pura em cronograma.ts/osApi.ts) —
// correção obrigatória (revisão independente, item 2): "a fonte de produção
// ainda pode sumir e parecer zero... na tela de usuário bloqueado que
// acabei de testar, os contadores principais são travessões, mas a fila
// ainda diz 0 e a régua diz Nenhuma OS com data conhecida. Use
// indisponível/travessão também nessas seções; só declarar fila vazia após
// leitura completa autorizada."
//
// Este arquivo prova, renderizando <OsPanel/> de verdade (não só checando
// `leitura.estado`/`fonteProducaoCompleta` isoladamente), que a régua e a
// fila de programação pendente — e não só os contadores do topo — nunca
// mostram "0"/"vazio" quando a fonte de produção não respondeu de forma
// completa e autorizada.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OsPanel } from '../OsPanel';
import type { LeituraFonte, OrdemServico } from '../types';

afterEach(() => {
  cleanup();
});

const osComDados: OrdemServico[] = [
  {
    os: 'OS-1',
    endereco: '500 Sample Blvd',
    cidade: 'Example City, NH',
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
    planejamento: {
      dataInicioPlanejada: { ano: 2026, mes: 10, dia: 6 },
      duracaoPlanejada: { valor: 3, unidade: 'dias-corridos' },
      equipeResponsavel: [],
      versaoPlanejamento: 1,
    },
  },
];

describe('OsPanel — régua e fila pendente nunca mostram "0"/"vazio" sem uma leitura de produção completa e autorizada', () => {
  it('carregando: contadores travessão, régua indisponível (nunca "nenhuma OS"), fila travessão (nunca "0")', () => {
    const leitura: LeituraFonte<OrdemServico[]> = { estado: 'carregando', dados: [] };
    render(<OsPanel leitura={leitura} demo={false} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nenhuma OS com data conhecida/)).toBeNull();
    expect(screen.getByText(/a fonte de produção ainda não respondeu/)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull(); // fila nunca mostra 0 aqui — mostra "—"
  });

  it('indisponível/sem autorização (reproduz o teste manual do usuário bloqueado): contadores, régua E fila todos indisponíveis — nunca "0" nem "nenhuma OS"', () => {
    const leitura: LeituraFonte<OrdemServico[]> = {
      estado: 'indisponivel',
      dados: [],
      motivo: 'AUTORIZACAO_PROJETO_NAO_CONFIGURADA: nenhum projeto liberado',
    };
    render(<OsPanel leitura={leitura} demo={false} />);
    expect(screen.queryByText(/Nenhuma OS com data conhecida/)).toBeNull();
    expect(screen.getByText(/a fonte de produção ainda não respondeu/)).toBeTruthy();
    expect(screen.getByText(/a fila só é declarada vazia/)).toBeTruthy();
    // "Fila de programação pendente" nunca aparece com contador "0".
    const filaHeading = screen.getByText(/Fila de programação pendente/);
    expect(filaHeading.textContent).not.toMatch(/0/);
  });

  it('parcial com produção incompleta (fonteOsExiste:false mas OS-Testes ok — o caso exato do item 2): mesmo tratamento indisponível, nunca "zero confirmado"', () => {
    const leitura: LeituraFonte<OrdemServico[]> = {
      estado: 'parcial',
      dados: [],
      motivo: 'Aba "OS" (produção) não existe na planilha — contagens, régua e fila de produção são indisponíveis.',
      fonteProducaoCompleta: false,
    };
    render(<OsPanel leitura={leitura} demo={false} />);
    expect(screen.queryByText(/Nenhuma OS com data conhecida/)).toBeNull();
    expect(screen.getByText(/a fonte de produção ainda não respondeu/)).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // contadores do topo
  });

  it('disponível (produção completa) com 1 OS programada: régua e fila mostram dado real, contadores reais, nunca travessão', () => {
    const leitura: LeituraFonte<OrdemServico[]> = {
      estado: 'disponivel',
      dados: osComDados,
      fonteProducaoCompleta: true,
    };
    render(<OsPanel leitura={leitura} demo={false} />);
    expect(screen.queryAllByText('—')).toHaveLength(0);
    expect(screen.getAllByText(/OS-1/).length).toBeGreaterThan(0);
    const filaHeading = screen.getByText(/Fila de programação pendente/);
    expect(filaHeading.textContent).toMatch(/0/); // nenhuma OS pendente — desta vez "0" é legítimo (leitura completa)
  });
});
