import { describe, expect, it } from 'vitest';
import { AplicadorDeRascunhos } from '../aplicadorDeRascunhos';
import { EVENTOS_FICTICIOS } from '../fixturesSimuladas';

describe('AplicadorDeRascunhos — idempotência e tolerância a ordem (lacunas nº3 e nº4 do parecer, dados fictícios)', () => {
  it('deduplica um evento repetido (replay) pelo idMensagem — fixture inclui uma duplicata deliberada', () => {
    const aplicador = new AplicadorDeRascunhos();
    aplicador.aplicarLote(EVENTOS_FICTICIOS);
    // 4 eventos na fixture, mas o 4º é duplicata do 1º (mesmo idMensagem) -> 3 rascunhos únicos.
    expect(EVENTOS_FICTICIOS).toHaveLength(4);
    expect(aplicador.contarRascunhos()).toBe(3);
  });

  it('aplicar o mesmo evento duas vezes de forma explícita não duplica nem altera o conteúdo', () => {
    const aplicador = new AplicadorDeRascunhos();
    aplicador.aplicar(EVENTOS_FICTICIOS[0]);
    aplicador.aplicar(EVENTOS_FICTICIOS[0]);
    aplicador.aplicar(EVENTOS_FICTICIOS[0]);
    expect(aplicador.contarRascunhos()).toBe(1);
  });

  it('produz o mesmo estado final independentemente da ordem de aplicação (tolerância a fora-de-ordem/reconexão)', () => {
    const emOrdem = new AplicadorDeRascunhos();
    emOrdem.aplicarLote(EVENTOS_FICTICIOS);

    const foraDeOrdem = new AplicadorDeRascunhos();
    foraDeOrdem.aplicarLote([...EVENTOS_FICTICIOS].reverse());

    const normalizar = (rascunhos: ReturnType<AplicadorDeRascunhos['listarRascunhos']>) =>
      [...rascunhos].sort((a, b) => a.idMensagem.localeCompare(b.idMensagem));

    expect(normalizar(foraDeOrdem.listarRascunhos())).toEqual(normalizar(emOrdem.listarRascunhos()));
    expect(foraDeOrdem.contarRascunhos()).toBe(emOrdem.contarRascunhos());
  });

  it('rascunhos sem autor continuam isolados e sinalizados para triagem manual, nunca silenciosamente descartados', () => {
    const aplicador = new AplicadorDeRascunhos();
    aplicador.aplicarLote(EVENTOS_FICTICIOS);
    const semAutor = aplicador.listarRascunhos().filter((r) => r.status === 'sem_autor_identificado');
    expect(semAutor).toHaveLength(1);
    expect(semAutor[0].idGrupo).toBe('grupo-obra-exemplo-B');
  });
});
