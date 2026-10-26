// Armazenamento em memória dos rascunhos de OS, aplicado de forma
// DELIBERADAMENTE idempotente e tolerante a ordem — porque as lacunas nº3
// (estabilidade de ID/deduplicação) e nº4 (ordem de entrega, reconexão,
// replay) do parecer anterior não estão resolvidas. Em vez de assumir que o
// provedor real entrega cada mensagem exatamente uma vez e em ordem, este
// aplicador trata CADA aplicação de evento como potencialmente repetida ou
// fora de ordem, e garante que o estado final não duplica nem depende da
// ordem de chegada.
//
// Isto é só armazenamento em memória de processo — não é o backend
// hospedado final (que ainda não existe para OS; ver apps-script/Code.gs,
// que hoje só implementa login/entrada/saída de sala, um recurso
// diferente). Reaproveitar a arquitetura significa, na prática, seguir o
// mesmo padrão (Apps Script + Planilha como armazenamento), não ligar
// nesta classe a nenhum backend real agora.
import type { EventoGrupoSimulado, RascunhoOS } from './tipos';
import { processarEvento } from './processarEvento';

export class AplicadorDeRascunhos {
  private rascunhosPorIdMensagem = new Map<string, RascunhoOS>();

  /** Aplica um evento. Repetir o mesmo idMensagem não cria um segundo rascunho. */
  aplicar(evento: EventoGrupoSimulado): RascunhoOS {
    const rascunho = processarEvento(evento);
    this.rascunhosPorIdMensagem.set(rascunho.idMensagem, rascunho);
    return rascunho;
  }

  /** Aplica uma lista de eventos, em qualquer ordem, com o mesmo resultado final. */
  aplicarLote(eventos: EventoGrupoSimulado[]): void {
    for (const evento of eventos) this.aplicar(evento);
  }

  listarRascunhos(): RascunhoOS[] {
    return [...this.rascunhosPorIdMensagem.values()];
  }

  contarRascunhos(): number {
    return this.rascunhosPorIdMensagem.size;
  }
}
