import { describe, expect, it } from 'vitest';
import { selecionarOsPorClique } from '../selecao';
import type { OrdemServico } from '../types';

function ordem(os: string, isTeste = false): OrdemServico {
  return {
    os,
    endereco: '',
    cidade: '',
    statusTexto: '',
    estado: 'NAO_INICIADA',
    escopo: '',
    protecoes: '',
    dependenciasObservacoes: '',
    evidenciasTexto: '',
    ultimaAtualizacao: '',
    isTeste,
    temEtapaAplicavel: false,
    aprovacaoQualidade: { resultado: 'pendente', semEvidencia: true },
  };
}

describe('selecionarOsPorClique — clique sempre abre exatamente a OS clicada', () => {
  it('encontra a OS certa mesmo com identificadores parecidos', () => {
    const lista = [ordem('OS-1'), ordem('OS-10'), ordem('OS-100')];
    expect(selecionarOsPorClique('OS-10', lista)?.os).toBe('OS-10');
  });

  it('nunca retorna uma OS de teste quando o clique foi numa OS de produção com nome parecido', () => {
    const lista = [ordem('TEST-001', true), ordem('OS-001')];
    expect(selecionarOsPorClique('OS-001', lista)?.os).toBe('OS-001');
    expect(selecionarOsPorClique('TEST-001', lista)?.isTeste).toBe(true);
  });

  it('OS inexistente devolve undefined, nunca a primeira da lista por engano', () => {
    const lista = [ordem('OS-1'), ordem('OS-2')];
    expect(selecionarOsPorClique('OS-999', lista)).toBeUndefined();
  });
});
