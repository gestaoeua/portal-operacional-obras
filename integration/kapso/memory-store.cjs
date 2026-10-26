'use strict';
/**
 * FIXTURE em memória do armazenamento durável que este adaptador exige.
 * Serve só para testes e para demonstrar a interface exigida de um host
 * real — NUNCA é a implementação de produção: todo o conteúdo se perde
 * ao reiniciar o processo, e não há nenhuma garantia de durabilidade de
 * verdade aqui. Uma implementação real (fora desta fatia) precisa
 * preservar as MESMAS garantias testadas neste módulo:
 *   - enqueue "atômico" com dedup: a checagem de duplicidade e a
 *     gravação acontecem como uma única operação, sem uma janela em que
 *     duas chamadas concorrentes possam ambas decidir "é novo";
 *   - nunca confirmar (nunca devolver sucesso) antes de persistir de
 *     verdade;
 *   - itens já persistidos permanecem persistidos mesmo que uma entrega
 *     posterior do MESMO lote falhe por outro item — uma nova tentativa
 *     só precisa (e só deve) persistir o que faltou.
 */

function criarMemoryStore() {
  /** dedupeKey -> { rascunho, conteudoHash } */
  const rascunhos = new Map();
  /** Itens que não puderam ser transformados num rascunho (projeto desconhecido, formato inválido, conflito de dedup, etc.) — nunca descartados em silêncio. */
  const quarentena = [];
  let falharProximasEscritas = 0;

  return {
    /** Faz as próximas N chamadas de enqueueRascunho lançarem, simulando uma indisponibilidade transitória do armazenamento real. */
    simularFalha(vezes = 1) {
      falharProximasEscritas = vezes;
    },

    async enqueueRascunho(dedupeKey, rascunho, conteudoHash) {
      if (falharProximasEscritas > 0) {
        falharProximasEscritas -= 1;
        throw new Error('Falha simulada de armazenamento (fixture) — nunca confirmar antes de persistir de verdade.');
      }
      const existente = rascunhos.get(dedupeKey);
      if (existente) {
        if (existente.conteudoHash !== conteudoHash) {
          // Mesma identidade (phone_number_id + message.id), conteúdo
          // diferente do que já está persistido: isso é incomum o
          // bastante para merecer revisão humana em vez de decidir por
          // conta própria qual versão "vale" — nunca sobrescreve
          // silenciosamente o que já foi persistido.
          quarentena.push({
            motivo: 'conflito_dedup_conteudo_diferente',
            detalhe: { dedupeKey },
            recebidoEm: new Date().toISOString(),
          });
        }
        return { novo: false, rascunho: existente.rascunho };
      }
      rascunhos.set(dedupeKey, { rascunho, conteudoHash });
      return { novo: true, rascunho };
    },

    async quarentenar(motivo, detalhe) {
      quarentena.push({ motivo, detalhe, recebidoEm: new Date().toISOString() });
    },

    // Helpers de inspeção só para os testes — não fazem parte da
    // interface que um host real precisa implementar.
    listarRascunhos() {
      return Array.from(rascunhos.values()).map((v) => v.rascunho);
    },
    listarQuarentena() {
      return quarentena.slice();
    },
  };
}

module.exports = { criarMemoryStore };
