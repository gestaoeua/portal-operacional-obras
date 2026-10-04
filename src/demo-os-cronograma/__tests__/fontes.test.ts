import { describe, expect, it } from 'vitest';
import { ControladorDeSequencia } from '../fontes';

describe('ControladorDeSequencia — resposta fora de ordem e troca de contexto', () => {
  it('aplica a primeira resposta de um contexto novo', () => {
    const c = new ControladorDeSequencia();
    expect(c.podeAplicar({ usuario: 'u1', projetoId: 'proj-A', recurso: 'os' }, 1)).toBe(true);
  });

  it('descarta uma resposta atrasada (sequência menor que a última aplicada)', () => {
    const c = new ControladorDeSequencia();
    const ctx = { usuario: 'u1', projetoId: 'proj-A', recurso: 'os' };
    expect(c.podeAplicar(ctx, 2)).toBe(true);
    expect(c.podeAplicar(ctx, 1)).toBe(false); // atrasada
    expect(c.podeAplicar(ctx, 3)).toBe(true); // mais nova, aplica normalmente
  });

  it('troca de OS/projeto é um contexto novo — sequência de um nunca é comparada com a de outro', () => {
    const c = new ControladorDeSequencia();
    const ctxA = { usuario: 'u1', projetoId: 'proj-A', recurso: 'os' };
    const ctxB = { usuario: 'u1', projetoId: 'proj-B', recurso: 'os' };
    c.podeAplicar(ctxA, 10); // sequência alta em A
    // Uma resposta de sequência "1" em B não é uma resposta "atrasada" de A — é outro contexto.
    expect(c.podeAplicar(ctxB, 1)).toBe(true);
  });

  it('troca de usuário é um contexto novo — resposta pendente do usuário anterior não se aplica ao novo', () => {
    const c = new ControladorDeSequencia();
    const ctxUsuarioA = { usuario: 'usuarioA', projetoId: 'proj-A', recurso: 'cronograma' };
    const ctxUsuarioB = { usuario: 'usuarioB', projetoId: 'proj-A', recurso: 'cronograma' };
    c.podeAplicar(ctxUsuarioA, 5);
    expect(c.podeAplicar(ctxUsuarioB, 1)).toBe(true); // novo contexto, não é "atrasada"
  });

  it('repetição exata da mesma sequência no mesmo contexto é aceita (idempotente para exibição, não duplica efeito)', () => {
    const c = new ControladorDeSequencia();
    const ctx = { usuario: 'u1', projetoId: 'proj-A', recurso: 'os' };
    c.podeAplicar(ctx, 4);
    expect(c.podeAplicar(ctx, 4)).toBe(true);
  });
});
