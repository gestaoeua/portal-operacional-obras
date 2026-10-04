// @vitest-environment jsdom
//
// Teste de FLUXO/COMPONENTE (não só da classe ControladorDeSequencia
// isolada — ver fontes.test.ts), adaptado de um teste equivalente numa
// branch de desenvolvimento interna (não publicada) para esta publicação:
// mesmo teste, mesma lógica exercitada — só o componente (`PreviaDemo`) e
// os nomes de usuário de demonstração trocaram (ver sanitização em
// `fixtures.ts`/`PreviaDemo.tsx`).
//
// PreviaDemo é usada aqui porque já expõe o controle "Ver como" que troca
// de contexto (usuário de demonstração) — exatamente o gatilho que o
// controlador precisa proteger. O MESMO caminho exercitado por esta demo em
// produção é usado aqui (PreviaDemo usa authorization.ts/ControladorDeSequencia
// de verdade); só `resolverProjetosAutorizados` é interceptado para poder
// controlar a ORDEM DE CHEGADA das respostas (sem isso, as duas promises
// resolvem no mesmo microtask e a corrida nunca aconteceria de verdade).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviaDemo } from '../PreviaDemo';
import * as authorization from '../authorization';

afterEach(() => {
  // RTL não limpa automaticamente entre testes sem um setupFile global —
  // como este projeto não tem um (ver vite.config.ts), a limpeza é feita
  // aqui explicitamente para nunca vazar o DOM de um teste para o outro.
  cleanup();
  vi.restoreAllMocks();
});

describe('PreviaDemo — ControladorDeSequencia integrado ao fluxo real (não só testado isolado)', () => {
  it('troca de "Ver como" limpa a tela IMEDIATAMENTE (nunca mantém o dado do usuário anterior visível)', async () => {
    render(<PreviaDemo />);
    // Espera a primeira leitura (gestor-demo) assentar (OS-101 aparece na
    // lista E na régua — por isso findAllByText).
    await screen.findAllByText(/OS-101/);

    const select = screen.getByLabelText(/Ver como/i) as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: 'gestor-sem-config-demo' } });
    });
    // Imediatamente após a troca (antes de qualquer promise resolver), a OS
    // do contexto anterior não pode mais estar na tela.
    expect(screen.queryAllByText(/OS-101/)).toHaveLength(0);
  });

  it('CORREÇÃO: uma resposta ATRASADA do contexto anterior nunca sobrescreve o contexto novo já selecionado', async () => {
    // Controla manualmente quando cada chamada resolve, para forçar a
    // resposta do PRIMEIRO contexto (gestor-demo) a chegar DEPOIS da do
    // segundo (gestor-sem-config-demo) — a ordem de chegada que o
    // controlador existe para proteger.
    const resolvers: Record<string, (v: Awaited<ReturnType<typeof authorization.resolverProjetosAutorizados>>) => void> = {};
    const original = authorization.resolverProjetosAutorizados;
    vi.spyOn(authorization, 'resolverProjetosAutorizados').mockImplementation(
      (usuarioId) =>
        new Promise((resolve) => {
          resolvers[usuarioId] = (v) => resolve(v);
        })
    );

    render(<PreviaDemo />);
    const select = screen.getByLabelText(/Ver como/i) as HTMLSelectElement;

    // Dispara a leitura de gestor-demo (fica pendurada — resolvers['gestor-demo'] ainda não chamado).
    expect(resolvers['gestor-demo']).toBeTruthy();

    // Troca para gestor-sem-config-demo ANTES de gestor-demo responder.
    act(() => {
      fireEvent.change(select, { target: { value: 'gestor-sem-config-demo' } });
    });
    expect(resolvers['gestor-sem-config-demo']).toBeTruthy();

    // gestor-sem-config-demo responde PRIMEIRO (rápido).
    const authBloqueado = await original('gestor-sem-config-demo', new authorization.AutorizacaoProviderDemo(
      [{ projetoId: 'proj-A', ativo: true }],
      [{ usuario: 'gestor-sem-config-demo', perfil: 'gestor' }]
    ));
    await act(async () => {
      resolvers['gestor-sem-config-demo'](authBloqueado);
    });
    await screen.findByText(/AUTORIZACAO_PROJETO_NAO_CONFIGURADA/);

    // AGORA a resposta atrasada de gestor-demo (contexto antigo) chega.
    const authGestorDemo = await original('gestor-demo', new authorization.AutorizacaoProviderDemo(
      [{ projetoId: 'proj-A', ativo: true }],
      [{ usuario: 'gestor-demo', perfil: 'gestor', projetosAutorizados: ['proj-A'] }]
    ));
    await act(async () => {
      resolvers['gestor-demo'](authGestorDemo);
    });

    // A tela deve CONTINUAR mostrando o bloqueio do contexto atual
    // (gestor-sem-config-demo) — a resposta atrasada de gestor-demo nunca
    // pode reaparecer sobrescrevendo a seleção atual.
    expect(screen.queryByText(/AUTORIZACAO_PROJETO_NAO_CONFIGURADA/)).not.toBeNull();
    expect(screen.queryAllByText(/OS-101/)).toHaveLength(0);
  });
});
