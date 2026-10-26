import { describe, expect, it } from 'vitest';
import { processarEvento } from '../processarEvento';
import { EVENTOS_FICTICIOS } from '../fixturesSimuladas';

describe('processarEvento — dados inteiramente fictícios', () => {
  it('converte um evento com autor em rascunho pendente_triagem', () => {
    const rascunho = processarEvento(EVENTOS_FICTICIOS[0]);
    expect(rascunho.status).toBe('pendente_triagem');
    expect(rascunho.autor).toBe('pintor-exemplo-1');
    expect(rascunho.texto).toContain('quarto 2');
  });

  it('converte um evento SEM autor em rascunho sem_autor_identificado, sem lançar erro (lacuna nº2 do parecer)', () => {
    const eventoSemAutor = EVENTOS_FICTICIOS[2];
    expect(eventoSemAutor.autor).toBeUndefined();
    const rascunho = processarEvento(eventoSemAutor);
    expect(rascunho.status).toBe('sem_autor_identificado');
  });

  it('extrai a referência de mídia (foto) sem nunca produzir uma URL real', () => {
    const rascunho = processarEvento(EVENTOS_FICTICIOS[1]);
    expect(rascunho.midiaRef).toBe('fixture-foto-ficticia-quarto2.jpg');
    expect(rascunho.midiaRef).not.toMatch(/^https?:\/\//);
  });
});
