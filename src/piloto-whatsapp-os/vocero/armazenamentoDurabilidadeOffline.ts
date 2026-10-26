// Armazenamento de durabilidade para este PILOTO OFFLINE — um arquivo JSON
// local, no filesystem deste workspace já autorizado. NÃO é o armazenamento
// real de produção: o outbox real do Vocero é uma fila em Postgres com lease
// e retries (confirmei lendo `src/server/dispatch/outbox.ts` do repositório
// deles nesta sessão) — aqui não há servidor novo, não há banco novo, não há
// deploy. Isto existe só para provar, localmente, que a deduplicação
// sobrevive a um "restart" (uma nova instância desta classe apontando para o
// MESMO arquivo) — não para ser usado como backend de verdade.
//
// Chaves de deduplicação, como pedido: por dispatchId (idempotência do
// despacho — despacho.md linhas 23-24), por mensagem individual (burst pode
// repetir mensagens de um despacho anterior — despacho.md linha 30-31), e por
// rascunho de OS resultante (nunca dois rascunhos para o mesmo dispatchId).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface EstadoDurabilidade {
  /** dispatchId -> id do rascunho de OS que esse dispatchId já produziu, ou `null` se foi processado mas não gerou rascunho (quarentena). */
  dispatchesProcessados: Record<string, string | null>;
  /** messageId -> dispatchId que primeiro trouxe essa mensagem. */
  mensagensVistas: Record<string, string>;
}

/** Resultado de consultar se um dispatchId já foi processado — usar `processado`, nunca o valor em si, para não confundir `rascunhoId: null` com "ainda não visto" (bug clássico de string/valor vazio sendo falsy). */
export type ConsultaDispatchProcessado = { processado: true; rascunhoId: string | null } | { processado: false };

function estadoVazio(): EstadoDurabilidade {
  return { dispatchesProcessados: {}, mensagensVistas: {} };
}

/**
 * Armazenamento local, em arquivo JSON, para o piloto offline. Cada instância
 * lê o arquivo no momento da criação (simulando um processo que acabou de
 * iniciar/reiniciar) e escreve de volta a cada mutação — para que uma
 * instância NOVA, apontando para o mesmo `caminhoArquivo`, veja o que a
 * instância anterior gravou (isso é o que os testes de "replay/restart" usam
 * para provar durabilidade de verdade, não só em memória de um processo).
 */
export class ArmazenamentoDurabilidadeOffline {
  private readonly caminhoArquivo: string;
  private estado: EstadoDurabilidade;

  constructor(caminhoArquivo: string) {
    this.caminhoArquivo = caminhoArquivo;
    this.estado = this.lerDoDisco();
  }

  private lerDoDisco(): EstadoDurabilidade {
    if (!existsSync(this.caminhoArquivo)) return estadoVazio();
    try {
      const conteudo = readFileSync(this.caminhoArquivo, 'utf8');
      const json = JSON.parse(conteudo);
      return {
        dispatchesProcessados: json?.dispatchesProcessados ?? {},
        mensagensVistas: json?.mensagensVistas ?? {},
      };
    } catch {
      // Arquivo corrompido/malformado — fail-closed para o lado seguro: trata
      // como se nada tivesse sido visto ainda, nunca lança erro aqui.
      return estadoVazio();
    }
  }

  private salvarNoDisco(): void {
    mkdirSync(dirname(this.caminhoArquivo), { recursive: true });
    writeFileSync(this.caminhoArquivo, JSON.stringify(this.estado, null, 2), 'utf8');
  }

  /** Se este dispatchId já foi processado (independente de ter gerado rascunho ou não). */
  dispatchJaProcessado(dispatchId: string): ConsultaDispatchProcessado {
    if (Object.prototype.hasOwnProperty.call(this.estado.dispatchesProcessados, dispatchId)) {
      return { processado: true, rascunhoId: this.estado.dispatchesProcessados[dispatchId] };
    }
    return { processado: false };
  }

  /** Se esta mensagem já apareceu num despacho anterior, devolve qual dispatchId a trouxe primeiro. */
  mensagemJaVista(messageId: string): string | undefined {
    return this.estado.mensagensVistas[messageId];
  }

  /** Registra, de forma durável (gravada no arquivo), que este dispatchId foi processado — `rascunhoId` é `null` quando não gerou rascunho (quarentena, sem texto processável). */
  registrarProcessado(dispatchId: string, rascunhoId: string | null, idsDeMensagensNovas: readonly string[]): void {
    this.estado.dispatchesProcessados[dispatchId] = rascunhoId;
    for (const id of idsDeMensagensNovas) {
      this.estado.mensagensVistas[id] = dispatchId;
    }
    this.salvarNoDisco();
  }
}
