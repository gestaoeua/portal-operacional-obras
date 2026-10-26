// Armazenamento de durabilidade para este PILOTO OFFLINE (webhookRecebido) —
// arquivo JSON local, no filesystem deste workspace já autorizado, nunca um
// backend real novo, nunca um servidor novo. Nunca decide elegibilidade —
// isso continua sendo só responsabilidade de `decidirIngestaoAutomatica.ts`.
//
// CORRIGIDO (revisão independente nº1 do patch anterior) — três defeitos:
//   (a) o rascunho INTEIRO (não só o id) agora é persistido em
//       `aplicacoesEfetivas`, recuperável depois de um restart de verdade.
//   (b) um arquivo corrompido/JSON inválido vira um estado `corrompido`
//       explícito — toda consulta/escrita se recusa a operar, e o arquivo
//       NUNCA é sobrescrito automaticamente (fica intacto para diagnóstico).
//   (c) observações não elegíveis (auditoria) e aplicações efetivas (rascunho
//       realmente criado) vivem em tabelas SEPARADAS — uma nunca interfere
//       na outra.
// Escrita em disco é ATÔMICA (arquivo temporário + `renameSync`).
//
// CORRIGIDO (revisão independente nº2, mesma rodada de 2026-10-20) — três
// defeitos adicionais, encontrados numa leitura real do código desta
// correção anterior:
//
//   (1) `lerDoDisco` antes aceitava QUALQUER objeto JSON e convertia
//       tabelas ausentes/malformadas em `{}` silenciosamente — ou seja,
//       `{}` ou `{"aplicacoesEfetivas":[]}` apagavam semanticamente todo o
//       histórico de deduplicação SEM bloquear nada. AGORA: o esquema
//       completo é exigido (as duas chaves de topo, exatamente essas, cada
//       uma com a forma exata esperada — toda observação precisa de
//       `motivo:string`, todo rascunho precisa validar contra a forma de
//       `RascunhoOSWebhookRecebido`). Qualquer desvio — formato antigo,
//       campo ausente, tipo errado, chave extra — bloqueia (estado
//       `corrompido`) em vez de virar vazio.
//
//   (2) `salvarNoDiscoAtomicamente` podia lançar (mkdir/write/rename podem
//       falhar: sem espaço, sem permissão, etc.) e os métodos públicos não
//       capturavam isso — ou seja, uma falha de E/S de verdade quebrava a
//       garantia de "nunca lança erro" documentada, em vez de virar
//       `ok:false`. AGORA: a escrita em si nunca propaga exceção — qualquer
//       falha vira um resultado explícito (`ok:false`, com motivo), e o
//       estado em memória só é atualizado DEPOIS de confirmar que a
//       gravação em disco funcionou — se a escrita falhar, o estado anterior
//       é preservado (nunca fica dessincronizado do que está em disco).
//
//   (3) `consultarAplicacaoEfetiva` lia `tabela[messageId]` por truthiness,
//       sem checar propriedade própria — um `messageId` como `"constructor"`
//       ou `"toString"` aparecia "aplicado" por herança do protótipo de
//       `Object`, mesmo nunca tendo sido escrito. AGORA, em duas camadas: as
//       tabelas internas são mapas SEM PROTÓTIPO (`Object.create(null)`,
//       reconstruídos a cada inserção), e toda consulta usa
//       `hasOwnProperty` explícito — nunca truthiness direta. Além disso,
//       nomes de chave reservados/perigosos (`__proto__`, `constructor`,
//       `prototype`) são EXPLICITAMENTE rejeitados tanto na leitura do
//       disco (viram `corrompido`) quanto na escrita (`registrar*` devolve
//       `ok:false` sem escrever nada).
//
// LIMITAÇÃO QUE CONTINUA FORA DESTE PROTÓTIPO, DECLARADA EXPLICITAMENTE (não
// alterada nesta rodada — já estava correta): a escrita atômica protege
// contra um ÚNICO escritor sendo interrompido no meio (torn write). Ela NÃO
// é uma trava entre processos — duas instâncias concorrentes ainda podem
// fazer a última escrita vencer, descartando a outra silenciosamente (ver
// teste "demonstra (não corrige) a lacuna de concorrência multi-processo").
// Resolver isso de verdade exige um backend com exclusão mútua real — fora
// do escopo deste arquivo JSON local, por decisão deliberada.
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RascunhoOSWebhookRecebido } from './tipos';

interface EstadoDurabilidadeWebhook {
  /** Observações de elegibilidade NEGATIVA — só auditoria. NUNCA consultada para decidir se uma aplicação efetiva é duplicata. Mapa SEM PROTÓTIPO (ver defeito 3). */
  observacoesNaoElegiveis: Record<string, { motivo: string }>;
  /** Aplicações EFETIVAS — só escrita quando um rascunho foi REALMENTE criado. Guarda o objeto inteiro. Mapa SEM PROTÓTIPO (ver defeito 3). */
  aplicacoesEfetivas: Record<string, RascunhoOSWebhookRecebido>;
}

const CHAVES_DE_TOPO_ESPERADAS = ['observacoesNaoElegiveis', 'aplicacoesEfetivas'] as const;

/** Nomes de propriedade que, por herança de `Object.prototype`, fariam uma consulta por truthiness/acesso direto mentir — nunca aceitos como `messageId`, nem lidos do disco nem escritos. */
const NOMES_DE_PROPRIEDADE_PERIGOSOS = new Set(['__proto__', 'constructor', 'prototype']);

function ehChaveSegura(chave: string): boolean {
  return !NOMES_DE_PROPRIEDADE_PERIGOSOS.has(chave);
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function ehStringNaoVazia(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Mapa SEM PROTÓTIPO (`Object.create(null)`) — `chave in mapa`/`mapa[chave]` nunca enxerga `Object.prototype`. Reconstruído a cada inserção para que o resultado de um spread anterior nunca "reintroduza" um protótipo normal. */
function mapaVazioSemPrototipo<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function inserirEmMapaSemPrototipo<T>(mapa: Record<string, T>, chave: string, valor: T): Record<string, T> {
  const novo = mapaVazioSemPrototipo<T>();
  Object.assign(novo, mapa);
  novo[chave] = valor;
  return novo;
}

function estadoVazio(): EstadoDurabilidadeWebhook {
  return { observacoesNaoElegiveis: mapaVazioSemPrototipo(), aplicacoesEfetivas: mapaVazioSemPrototipo() };
}

function validarObservacao(v: unknown): v is { motivo: string } {
  return ehObjeto(v) && typeof v.motivo === 'string';
}

/** Valida um rascunho lido do disco contra a forma EXATA de `RascunhoOSWebhookRecebido` — nenhum campo ausente, nenhum tipo errado, `messageId` precisa bater com a própria chave do mapa. */
function validarRascunho(v: unknown, chaveMapa: string): v is RascunhoOSWebhookRecebido {
  if (!ehObjeto(v)) return false;
  if (v.origem !== 'webhook_w_api_callback_nao_autenticado') return false;
  if (!ehStringNaoVazia(v.messageId) || v.messageId !== chaveMapa) return false;
  if (!ehStringNaoVazia(v.instanceId)) return false;
  if (!ehStringNaoVazia(v.remetenteId)) return false;
  if (v.remetenteNome !== undefined && typeof v.remetenteNome !== 'string') return false;
  if (typeof v.texto !== 'string') return false;
  if (typeof v.momentoUnix !== 'number' || !Number.isFinite(v.momentoUnix)) return false;
  if (v.status !== 'pendente_aprovacao') return false;
  return true;
}

function validarTabelaDeObservacoes(v: unknown): v is EstadoDurabilidadeWebhook['observacoesNaoElegiveis'] {
  if (!ehObjeto(v)) return false;
  for (const chave of Object.keys(v)) {
    if (!ehChaveSegura(chave)) return false;
    if (!validarObservacao(v[chave])) return false;
  }
  return true;
}

function validarTabelaDeAplicacoes(v: unknown): v is EstadoDurabilidadeWebhook['aplicacoesEfetivas'] {
  if (!ehObjeto(v)) return false;
  for (const chave of Object.keys(v)) {
    if (!ehChaveSegura(chave)) return false;
    if (!validarRascunho(v[chave], chave)) return false;
  }
  return true;
}

/** Valida o esquema COMPLETO do arquivo — exatamente as duas chaves de topo esperadas, cada uma na forma exata. Qualquer desvio é tratado como corrompido, nunca "convertido" para vazio. */
function validarEstadoCompleto(json: unknown): { ok: true; estado: EstadoDurabilidadeWebhook } | { ok: false; motivo: string } {
  if (!ehObjeto(json)) {
    return { ok: false, motivo: 'conteúdo do arquivo não é um objeto JSON (bloqueado explicitamente, arquivo preservado)' };
  }
  const chaves = Object.keys(json).sort();
  const esperadas = [...CHAVES_DE_TOPO_ESPERADAS].sort();
  const chavesBatem = chaves.length === esperadas.length && chaves.every((c, i) => c === esperadas[i]);
  if (!chavesBatem) {
    return {
      ok: false,
      motivo: `formato do arquivo não corresponde ao esquema esperado (esperado exatamente [${esperadas.join(', ')}], encontrado [${chaves.join(', ')}]) — formato antigo ou arquivo adulterado, bloqueado explicitamente, arquivo preservado`,
    };
  }
  if (!validarTabelaDeObservacoes(json.observacoesNaoElegiveis)) {
    return { ok: false, motivo: "campo 'observacoesNaoElegiveis' não corresponde ao esquema esperado (entrada malformada, tipo errado, ou chave de propriedade reservada) — bloqueado explicitamente, arquivo preservado" };
  }
  if (!validarTabelaDeAplicacoes(json.aplicacoesEfetivas)) {
    return { ok: false, motivo: "campo 'aplicacoesEfetivas' não corresponde ao esquema esperado (rascunho malformado, tipo errado, ou chave de propriedade reservada) — bloqueado explicitamente, arquivo preservado" };
  }
  const observacoesValidadas = json.observacoesNaoElegiveis as EstadoDurabilidadeWebhook['observacoesNaoElegiveis'];
  const aplicacoesValidadas = json.aplicacoesEfetivas as EstadoDurabilidadeWebhook['aplicacoesEfetivas'];
  const estado = estadoVazio();
  for (const chave of Object.keys(observacoesValidadas)) estado.observacoesNaoElegiveis[chave] = observacoesValidadas[chave];
  for (const chave of Object.keys(aplicacoesValidadas)) estado.aplicacoesEfetivas[chave] = aplicacoesValidadas[chave];
  return { ok: true, estado };
}

export type ConsultaAplicacaoEfetiva =
  | { situacao: 'aplicado'; rascunho: RascunhoOSWebhookRecebido }
  | { situacao: 'nao_aplicado' }
  | { situacao: 'armazenamento_corrompido'; motivo: string };

export type ResultadoRegistroArmazenamento = { ok: true } | { ok: false; motivo: string };

export type SituacaoArmazenamento =
  | { corrompido: true; motivo: string; caminhoArquivo: string }
  | { corrompido: false };

export class ArmazenamentoDurabilidadeOfflineWebhook {
  private readonly caminhoArquivo: string;
  private estado: EstadoDurabilidadeWebhook | undefined;
  private corrompido: { motivo: string } | false;

  constructor(caminhoArquivo: string) {
    this.caminhoArquivo = caminhoArquivo;
    const leitura = this.lerDoDisco();
    if (leitura.ok) {
      this.estado = leitura.estado;
      this.corrompido = false;
    } else {
      // NUNCA sobrescreve o arquivo aqui — fica intacto em disco para
      // diagnóstico manual. Nenhuma leitura/escrita subsequente finge que
      // está tudo bem.
      this.estado = undefined;
      this.corrompido = { motivo: leitura.motivo };
    }
  }

  private lerDoDisco(): { ok: true; estado: EstadoDurabilidadeWebhook } | { ok: false; motivo: string } {
    if (!existsSync(this.caminhoArquivo)) {
      // Arquivo nunca existiu — isto é INICIALIZAÇÃO, não corrupção.
      return { ok: true, estado: estadoVazio() };
    }
    let conteudo: string;
    try {
      conteudo = readFileSync(this.caminhoArquivo, 'utf8');
    } catch (erro) {
      return { ok: false, motivo: `falha ao ler o arquivo de durabilidade: ${erro instanceof Error ? erro.message : String(erro)}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(conteudo);
    } catch (erro) {
      return {
        ok: false,
        motivo: `arquivo de durabilidade contém JSON inválido/corrompido (bloqueado explicitamente, arquivo preservado em disco para diagnóstico): ${erro instanceof Error ? erro.message : String(erro)}`,
      };
    }
    return validarEstadoCompleto(json);
  }

  /** Escrita ATÔMICA: grava num arquivo temporário no mesmo diretório, depois `renameSync` sobre o arquivo final. NUNCA lança — qualquer falha de E/S (mkdir/write/rename) vira um resultado explícito. NÃO é uma trava entre processos. */
  private salvarNoDiscoAtomicamente(estado: EstadoDurabilidadeWebhook): ResultadoRegistroArmazenamento {
    try {
      mkdirSync(dirname(this.caminhoArquivo), { recursive: true });
      const sufixo = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const caminhoTemp = `${this.caminhoArquivo}.tmp-${sufixo}`;
      writeFileSync(caminhoTemp, JSON.stringify(estado, null, 2), 'utf8');
      renameSync(caminhoTemp, this.caminhoArquivo);
      return { ok: true };
    } catch (erro) {
      return { ok: false, motivo: `falha ao gravar o arquivo de durabilidade: ${erro instanceof Error ? erro.message : String(erro)}` };
    }
  }

  /** Se este armazenamento está em estado corrompido — nenhuma consulta/escrita é segura até isso ser resolvido manualmente. O arquivo nunca é sobrescrito automaticamente quando corrompido. */
  estaCorrompido(): SituacaoArmazenamento {
    return this.corrompido ? { corrompido: true, motivo: this.corrompido.motivo, caminhoArquivo: this.caminhoArquivo } : { corrompido: false };
  }

  /** Consulta SÓ a tabela de aplicações efetivas, por propriedade PRÓPRIA (nunca por truthiness/herança) — uma observação não elegível anterior do mesmo messageId NUNCA aparece aqui. */
  consultarAplicacaoEfetiva(messageId: string): ConsultaAplicacaoEfetiva {
    if (this.corrompido) return { situacao: 'armazenamento_corrompido', motivo: this.corrompido.motivo };
    if (!Object.prototype.hasOwnProperty.call(this.estado!.aplicacoesEfetivas, messageId)) {
      return { situacao: 'nao_aplicado' };
    }
    return { situacao: 'aplicado', rascunho: this.estado!.aplicacoesEfetivas[messageId] };
  }

  /** Registra, de forma durável e atômica, que um rascunho foi REALMENTE criado para este messageId. Recusa nomes de chave perigosos. Se a escrita falhar, o estado anterior em memória é preservado (nunca fica dessincronizado do disco). */
  registrarAplicacaoEfetiva(messageId: string, rascunho: RascunhoOSWebhookRecebido): ResultadoRegistroArmazenamento {
    if (this.corrompido) return { ok: false, motivo: `armazenamento corrompido, nada foi escrito: ${this.corrompido.motivo}` };
    if (!ehChaveSegura(messageId)) {
      return { ok: false, motivo: `messageId '${messageId}' é um nome de propriedade reservado/perigoso — recusado por segurança, nada foi escrito` };
    }
    const novoEstado: EstadoDurabilidadeWebhook = {
      observacoesNaoElegiveis: this.estado!.observacoesNaoElegiveis,
      aplicacoesEfetivas: inserirEmMapaSemPrototipo(this.estado!.aplicacoesEfetivas, messageId, rascunho),
    };
    const resultado = this.salvarNoDiscoAtomicamente(novoEstado);
    if (!resultado.ok) return resultado;
    this.estado = novoEstado;
    return { ok: true };
  }

  /** Registra uma observação de elegibilidade NEGATIVA — só auditoria, NUNCA usada para deduplicar uma aplicação efetiva. Recusa nomes de chave perigosos. Se a escrita falhar, o estado anterior em memória é preservado. */
  registrarObservacaoNaoElegivel(messageId: string, motivo: string): ResultadoRegistroArmazenamento {
    if (this.corrompido) return { ok: false, motivo: `armazenamento corrompido, nada foi escrito: ${this.corrompido.motivo}` };
    if (!ehChaveSegura(messageId)) {
      return { ok: false, motivo: `messageId '${messageId}' é um nome de propriedade reservado/perigoso — recusado por segurança, nada foi escrito` };
    }
    const novoEstado: EstadoDurabilidadeWebhook = {
      observacoesNaoElegiveis: inserirEmMapaSemPrototipo(this.estado!.observacoesNaoElegiveis, messageId, { motivo }),
      aplicacoesEfetivas: this.estado!.aplicacoesEfetivas,
    };
    const resultado = this.salvarNoDiscoAtomicamente(novoEstado);
    if (!resultado.ok) return resultado;
    this.estado = novoEstado;
    return { ok: true };
  }

  /** Só para teste/diagnóstico: se este messageId já foi observado como não elegível (independente de aplicação efetiva). Por propriedade própria, nunca por truthiness. */
  foiObservadoComoNaoElegivel(messageId: string): boolean {
    if (this.corrompido) return false;
    return Object.prototype.hasOwnProperty.call(this.estado!.observacoesNaoElegiveis, messageId);
  }
}
