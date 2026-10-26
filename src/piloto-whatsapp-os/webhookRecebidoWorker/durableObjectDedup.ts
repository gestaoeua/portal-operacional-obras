// =============================================================================
// Durable Object de deduplicação — adaptação do ARMAZENAMENTO offline
// (`../webhookRecebido/armazenamentoDurabilidadeOffline.ts`, baseado em
// arquivo JSON local) para o runtime de Cloudflare Workers, usando
// armazenamento SQLite de Durable Objects. NUNCA implantado nesta rodada —
// só testado localmente via Miniflare (ver README.md e vitest.config.ts).
//
// DESENHO DE ROTEAMENTO (a peça central da deduplicação atômica): cada
// instância deste Durable Object corresponde a EXATAMENTE UMA chave composta
// `instanceId + messageId` — é o chamador (ver `worker.ts`) que calcula
// `env.DEDUP_DO.idFromName(\`${instanceId}::${messageId}\`)` antes de obter o
// stub. Ou seja, a ROTEAMENTO em si já garante "uma única mensagem por
// instância"; esta classe não precisa (e não deve) aceitar messageId como
// parâmetro dos seus métodos — ela só conhece "o estado desta chave".
//
// ATOMICIDADE DE verificar-depois-escrever: dois métodos RPC SEPARADOS
// (p.ex. "consultar" seguido de "registrar", como duas chamadas distintas)
// NÃO seriam atômicos entre si — o "input gate" do Durable Object libera
// outro evento assim que uma chamada RPC termina, então duas chamadas
// concorrentes de "consultar" poderiam ambas ver "ainda não aplicado" antes
// de qualquer uma escrever. Por isso `registrarAplicacaoSeNaoDuplicado`
// abaixo faz a leitura E a escrita dentro de UMA ÚNICA chamada RPC, sem
// nenhum `await` de operação alheia entre elas — a documentação oficial da
// Cloudflare afirma que "a series of reads followed by writes, with no
// other intervening I/O, behaves like a transaction" dentro de uma mesma
// instância (ver README.md, fontes consultadas). Isto é testado com
// `Promise.all` disparando duas chamadas concorrentes de verdade contra o
// MESMO stub — ver `__tests__/dedupDurableObject.test.ts`.
//
// SEPARAÇÃO observação/aplicação: armazenadas sob chaves de storage
// DIFERENTES ('observacao' e 'aplicacao') dentro da mesma instância — uma
// observação não-elegível nunca é lida por `registrarAplicacaoSeNaoDuplicado`
// nem pode fazer `consultarAplicacao()` devolver "aplicado". Mesma garantia
// do armazenamento offline original, adaptada ao novo formato.
//
// RETENÇÃO/LIMPEZA (preparação desta rodada — ver README.md/RUNBOOK.md para
// a política completa): `limparRegistrosMaisAntigosQue` abaixo é um
// PRIMITIVO testado, NÃO uma política ativa — nada neste arquivo, em
// `worker.ts` ou em `aplicarDecisaoIngestaoWorker.ts` o CHAMA. Cada registro
// grava seu próprio instante de armazenagem (`armazenadoEmUnixMs`, pelo
// RELÓGIO DESTE SERVIDOR no momento da escrita — nunca um campo que o
// remetente controla, como `momentoUnix` da mensagem, que poderia ser
// forjado para nunca expirar ou para expirar cedo demais). O método existe
// pronto para quando uma política real for decidida (depende do contrato/
// documentação da W-API sobre janela de reentrega — hoje desconhecida), e é
// TESTADO para deixar explícito, sem surpresa, o que ele realmente faz:
// apagar um registro cujo horizonte já passou faz um REPLAY daquele
// `messageId` depois da limpeza parecer mensagem nova (dedup perdida para
// esse registro específico) — ver
// `__tests__/dedupDurableObject.test.ts`, bloco "retenção/limpeza".
import { DurableObject } from 'cloudflare:workers';
import type { RascunhoOSWebhookRecebido } from '../webhookRecebido/tipos';

const CHAVE_OBSERVACAO = 'observacao_nao_elegivel' as const;
const CHAVE_APLICACAO = 'aplicacao_efetiva' as const;

interface ObservacaoNaoElegivelArmazenada {
  armazenadoEmUnixMs: number;
  motivo: string;
}

/** Envelope de armazenamento interno — nunca exposto diretamente; os métodos públicos devolvem só `RascunhoOSWebhookRecebido`. */
interface AplicacaoEfetivaArmazenada {
  armazenadoEmUnixMs: number;
  rascunho: RascunhoOSWebhookRecebido;
}

export type ResultadoRegistroDedupDO = { ok: true } | { ok: false; motivo: string };

export type ResultadoAplicacaoDedupDO =
  | { tipo: 'aplicado'; rascunho: RascunhoOSWebhookRecebido }
  | { tipo: 'duplicado'; rascunho: RascunhoOSWebhookRecebido }
  | { tipo: 'erro_validacao'; motivo: string }
  | { tipo: 'erro_gravacao'; motivo: string };

export type ConsultaAplicacaoDedupDO =
  | { situacao: 'aplicado'; rascunho: RascunhoOSWebhookRecebido }
  | { situacao: 'nao_aplicado' }
  | { situacao: 'formato_inesperado'; motivo: string };

function ehStringNaoVazia(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Valida a FORMA de um rascunho antes de persistir — mesma disciplina do
 * armazenamento offline original: nunca persiste (nem afirma sucesso para)
 * um objeto que não corresponde exatamente ao contrato esperado.
 */
function validarRascunhoParaPersistir(v: unknown): { ok: true; rascunho: RascunhoOSWebhookRecebido } | { ok: false; motivo: string } {
  if (typeof v !== 'object' || v === null) {
    return { ok: false, motivo: 'rascunho recebido não é um objeto' };
  }
  const r = v as Record<string, unknown>;
  if (r.origem !== 'webhook_w_api_callback_nao_autenticado') {
    return { ok: false, motivo: "campo 'origem' ausente ou com valor inesperado" };
  }
  if (!ehStringNaoVazia(r.messageId) || !ehStringNaoVazia(r.instanceId) || !ehStringNaoVazia(r.remetenteId)) {
    return { ok: false, motivo: "'messageId'/'instanceId'/'remetenteId' precisam ser strings não vazias" };
  }
  if (r.remetenteNome !== undefined && typeof r.remetenteNome !== 'string') {
    return { ok: false, motivo: "'remetenteNome', quando presente, precisa ser string" };
  }
  if (typeof r.texto !== 'string') {
    return { ok: false, motivo: "'texto' precisa ser string" };
  }
  if (typeof r.momentoUnix !== 'number' || !Number.isFinite(r.momentoUnix)) {
    return { ok: false, motivo: "'momentoUnix' precisa ser um número finito" };
  }
  if (r.status !== 'pendente_aprovacao') {
    return { ok: false, motivo: "'status' precisa ser exatamente 'pendente_aprovacao'" };
  }
  return {
    ok: true,
    rascunho: {
      origem: 'webhook_w_api_callback_nao_autenticado',
      messageId: r.messageId as string,
      instanceId: r.instanceId as string,
      remetenteId: r.remetenteId as string,
      remetenteNome: r.remetenteNome as string | undefined,
      texto: r.texto as string,
      momentoUnix: r.momentoUnix as number,
      status: 'pendente_aprovacao',
    },
  };
}

function validarRascunhoLidoDoStorage(v: unknown): v is RascunhoOSWebhookRecebido {
  return validarRascunhoParaPersistir(v).ok;
}

/**
 * Valida o ENVELOPE de aplicação efetiva lido do storage — nunca o
 * `rascunho` isolado. Garante que `armazenadoEmUnixMs` é um número finito
 * (relógio do servidor, nunca o `momentoUnix` do remetente) e que o
 * `rascunho` interno corresponde ao formato esperado.
 */
function ehEnvelopeAplicacaoValido(v: unknown): v is AplicacaoEfetivaArmazenada {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const r = v as Record<string, unknown>;
  if (typeof r.armazenadoEmUnixMs !== 'number' || !Number.isFinite(r.armazenadoEmUnixMs)) {
    return false;
  }
  return validarRascunhoLidoDoStorage(r.rascunho);
}

/**
 * Valida o ENVELOPE de observação não-elegível lido do storage.
 */
function ehEnvelopeObservacaoValido(v: unknown): v is ObservacaoNaoElegivelArmazenada {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const r = v as Record<string, unknown>;
  return typeof r.armazenadoEmUnixMs === 'number' && Number.isFinite(r.armazenadoEmUnixMs) && ehStringNaoVazia(r.motivo);
}

export type ResultadoLimpezaDedupDO = { aplicacaoRemovida: boolean; observacaoRemovida: boolean };

export class DedupDurableObject extends DurableObject {
  /**
   * Registra uma OBSERVAÇÃO não-elegível (gate G1 fechado — motivo de
   * auditoria apenas). NUNCA grava na chave de aplicação efetiva, e nunca é
   * lida por `registrarAplicacaoSeNaoDuplicado`/`consultarAplicacao` abaixo.
   * Grava `armazenadoEmUnixMs` pelo relógio DESTE SERVIDOR — ver comentário
   * de cabeçalho do arquivo sobre retenção/limpeza.
   */
  async registrarObservacaoNaoElegivel(motivo: string): Promise<ResultadoRegistroDedupDO> {
    if (!ehStringNaoVazia(motivo)) {
      return { ok: false, motivo: "'motivo' precisa ser string não vazia" };
    }
    try {
      const valor: ObservacaoNaoElegivelArmazenada = { armazenadoEmUnixMs: Date.now(), motivo };
      await this.ctx.storage.put(CHAVE_OBSERVACAO, valor);
      return { ok: true };
    } catch {
      // Mensagem GENÉRICA (correção desta rodada) — nunca ecoa
      // `erro.message` do storage real, que poderia variar por runtime e
      // não ajuda quem só precisa saber que a gravação falhou.
      return { ok: false, motivo: 'falha de gravação (I/O) ao registrar observação' };
    }
  }

  async foiObservadoComoNaoElegivel(): Promise<boolean> {
    const valor = await this.ctx.storage.get(CHAVE_OBSERVACAO);
    return valor !== undefined;
  }

  /**
   * Única porta de entrada para aplicação efetiva. Leitura + escrita dentro
   * de UMA ÚNICA chamada RPC, sem await alheio entre elas — ver comentário
   * de cabeçalho do arquivo sobre por que isto é necessário para
   * atomicidade real sob concorrência (não só sob chamadas sequenciais). O
   * valor gravado é um ENVELOPE (`AplicacaoEfetivaArmazenada`) com
   * `armazenadoEmUnixMs` pelo relógio deste servidor — nunca o `rascunho`
   * isolado — mas os métodos públicos devolvem sempre só o `rascunho`.
   */
  async registrarAplicacaoSeNaoDuplicado(rascunhoNaoValidado: unknown): Promise<ResultadoAplicacaoDedupDO> {
    const validado = validarRascunhoParaPersistir(rascunhoNaoValidado);
    if (!validado.ok) {
      return { tipo: 'erro_validacao', motivo: validado.motivo };
    }

    // Leitura — NENHUM await de outra operação acontece entre esta linha e a
    // escrita abaixo, para que o input gate do Durable Object não entregue
    // nenhum outro evento concorrente no meio do caminho.
    const existenteBruto = await this.ctx.storage.get(CHAVE_APLICACAO);
    if (existenteBruto !== undefined) {
      if (!ehEnvelopeAplicacaoValido(existenteBruto)) {
        return { tipo: 'erro_gravacao', motivo: 'valor já armazenado em aplicacao_efetiva não corresponde ao formato esperado — bloqueado, nunca sobrescrito automaticamente' };
      }
      return { tipo: 'duplicado', rascunho: existenteBruto.rascunho };
    }

    try {
      const envelope: AplicacaoEfetivaArmazenada = { armazenadoEmUnixMs: Date.now(), rascunho: validado.rascunho };
      await this.ctx.storage.put(CHAVE_APLICACAO, envelope);
    } catch {
      // Mensagem GENÉRICA (correção desta rodada) — nunca ecoa
      // `erro.message` do storage real.
      return { tipo: 'erro_gravacao', motivo: 'falha de gravação (I/O) ao registrar aplicação efetiva' };
    }
    return { tipo: 'aplicado', rascunho: validado.rascunho };
  }

  async consultarAplicacao(): Promise<ConsultaAplicacaoDedupDO> {
    const existenteBruto = await this.ctx.storage.get(CHAVE_APLICACAO);
    if (existenteBruto === undefined) {
      return { situacao: 'nao_aplicado' };
    }
    if (!ehEnvelopeAplicacaoValido(existenteBruto)) {
      return { situacao: 'formato_inesperado', motivo: 'valor armazenado em aplicacao_efetiva não corresponde ao formato esperado' };
    }
    return { situacao: 'aplicado', rascunho: existenteBruto.rascunho };
  }

  /**
   * PRIMITIVO de retenção/limpeza — testado, mas NUNCA chamado por
   * `worker.ts` ou `aplicarDecisaoIngestaoWorker.ts` (ver guarda em
   * `__tests__/semBackendRealWorker.test.ts` e o comentário de cabeçalho
   * deste arquivo). Remove um registro (observação e/ou aplicação efetiva)
   * cujo `armazenadoEmUnixMs` tenha mais de `horizonteMs` de idade em
   * relação a `agora` (default: `Date.now()`, pelo relógio DESTE servidor —
   * nunca um timestamp fornecido pelo chamador sem ressalva).
   *
   * EFEITO DELIBERADAMENTE DOCUMENTADO (não escondido): remover o registro
   * de aplicação efetiva de UM messageId faz com que uma reentrega futura
   * DAQUELE MESMO messageId deixe de ser detectada como duplicada — a
   * dedução para esse registro específico é perdida (ver teste "replay após
   * limpeza parece mensagem nova" em
   * `__tests__/dedupDurableObject.test.ts`). Por isso este método nunca é
   * chamado automaticamente: qual horizonte é seguro depende da janela real
   * de reentrega/retry da W-API, que esta pesquisa não encontrou documentada
   * publicamente — ver README.md/RUNBOOK.md para a política pendente.
   */
  async limparRegistrosMaisAntigosQue(horizonteMs: number, agora: number = Date.now()): Promise<ResultadoLimpezaDedupDO> {
    let aplicacaoRemovida = false;
    let observacaoRemovida = false;

    const aplicacaoBruta = await this.ctx.storage.get(CHAVE_APLICACAO);
    if (aplicacaoBruta !== undefined && ehEnvelopeAplicacaoValido(aplicacaoBruta) && agora - aplicacaoBruta.armazenadoEmUnixMs > horizonteMs) {
      await this.ctx.storage.delete(CHAVE_APLICACAO);
      aplicacaoRemovida = true;
    }

    const observacaoBruta = await this.ctx.storage.get(CHAVE_OBSERVACAO);
    if (observacaoBruta !== undefined && ehEnvelopeObservacaoValido(observacaoBruta) && agora - observacaoBruta.armazenadoEmUnixMs > horizonteMs) {
      await this.ctx.storage.delete(CHAVE_OBSERVACAO);
      observacaoRemovida = true;
    }

    return { aplicacaoRemovida, observacaoRemovida };
  }
}
