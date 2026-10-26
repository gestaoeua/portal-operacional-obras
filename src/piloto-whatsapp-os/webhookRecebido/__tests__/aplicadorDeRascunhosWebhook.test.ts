// Caminho completo e EXECUTADO: payload bruto -> processarWebhookRecebido ->
// decidirIngestaoAutomatica -> aplicarDecisaoIngestao -> persistência
// durável (arquivo local) -> (não) rascunho. Dados inteiramente fictícios,
// sem rede, sem backend real. Cobre payload inválido, eco (fromMe), grupo,
// mídia e redelivery.
//
// ATUALIZADO (revisão independente do patch anterior, mesma rodada de
// 2026-10-20) com regressões para os 3 defeitos corrigidos no armazenamento
// (recuperação do rascunho INTEIRO depois de restart, bloqueio explícito de
// corrupção em vez de "fail-closed" fingido, separação entre observação não
// elegível e aplicação efetiva) e uma demonstração EXPLÍCITA (não uma
// correção) da lacuna de concorrência multi-processo que continua fora
// deste protótipo.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmazenamentoDurabilidadeOfflineWebhook } from '../armazenamentoDurabilidadeOffline';
import { aplicarDecisaoIngestao } from '../aplicadorDeRascunhosWebhook';
import { decidirIngestaoAutomatica } from '../decidirIngestaoAutomatica';
import { processarWebhookRecebido } from '../processarWebhookRecebido';
import type { DecisaoIngestaoAutomatica, RascunhoOSWebhookRecebido } from '../tipos';
import {
  PAYLOAD_GRUPO_FICTICIO,
  PAYLOAD_IMAGEM_FICTICIO,
  PAYLOAD_INVALIDO_SEM_MESSAGE_ID_FICTICIO,
  PAYLOAD_TEXTO_PRIVADO_FICTICIO,
  PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO,
} from '../fixturesWebhookRecebido';

let dirTemp: string;
beforeEach(() => {
  dirTemp = mkdtempSync(join(tmpdir(), 'piloto-webhook-teste-'));
});
afterEach(() => {
  rmSync(dirTemp, { recursive: true, force: true });
});

function novoArmazenamento(nomeArquivo = 'durabilidade.json') {
  return new ArmazenamentoDurabilidadeOfflineWebhook(join(dirTemp, nomeArquivo));
}

/** Roda o pipeline REAL e completo (nada simulado) para um payload bruto. */
function processarPipelineReal(payloadBruto: unknown, armazenamento: ArmazenamentoDurabilidadeOfflineWebhook) {
  const normalizado = processarWebhookRecebido(payloadBruto);
  if (normalizado.tipo !== 'normalizado') {
    return { normalizado, decisao: undefined, aplicacao: undefined };
  }
  const decisao = decidirIngestaoAutomatica(normalizado.evento);
  const aplicacao = aplicarDecisaoIngestao(decisao, armazenamento);
  return { normalizado, decisao, aplicacao };
}

function decisaoSimuladaElegivel(messageId: string, overrides: Partial<Extract<DecisaoIngestaoAutomatica, { elegivel: true }>['evento']> = {}): DecisaoIngestaoAutomatica {
  return {
    elegivel: true,
    evento: {
      origem: 'webhook_w_api_callback_nao_autenticado',
      instanceId: 'instancia-ficticia-simulacao',
      connectedPhone: 'numero-ficticio-simulacao',
      messageId,
      remetenteId: 'remetente-ficticio-simulacao',
      remetenteNome: 'Simulação Apenas De Teste',
      fromMe: false,
      momentoUnix: 1700000099,
      texto: 'Texto fictício só para testar o aplicador isoladamente — nunca um caminho real.',
      autenticidade: 'NAO_VERIFICADA',
      ...overrides,
    },
  };
}

describe('pipeline completo webhookRecebido — gate de ingestão automática continua fechado (prova end-to-end, não alegação)', () => {
  it('mensagem de texto privado válida: NÃO elegível (autenticidade NAO_VERIFICADA) e NENHUM rascunho é criado', () => {
    const armazenamento = novoArmazenamento();
    const { decisao, aplicacao } = processarPipelineReal(PAYLOAD_TEXTO_PRIVADO_FICTICIO, armazenamento);
    expect(decisao?.elegivel).toBe(false);
    expect(aplicacao?.tipo).toBe('nao_elegivel');
  });

  it('eco (fromMe:true): NÃO elegível e nenhum rascunho é criado — nunca vira rascunho automaticamente, nem pendente_aprovacao', () => {
    const armazenamento = novoArmazenamento();
    const { decisao, aplicacao } = processarPipelineReal(PAYLOAD_TEXTO_PRIVADO_FROM_ME_FICTICIO, armazenamento);
    expect(decisao?.elegivel).toBe(false);
    if (decisao?.elegivel !== false) throw new Error('esperado não elegível');
    expect(decisao.motivo).toContain('eco');
    expect(aplicacao?.tipo).toBe('nao_elegivel');
  });

  it('grupo: fica em quarentena na normalização, nunca chega a decisão/aplicação alguma', () => {
    const armazenamento = novoArmazenamento();
    const { normalizado, decisao, aplicacao } = processarPipelineReal(PAYLOAD_GRUPO_FICTICIO, armazenamento);
    expect(normalizado.tipo).toBe('quarentena_grupo_nao_suportado');
    expect(decisao).toBeUndefined();
    expect(aplicacao).toBeUndefined();
  });

  it('mídia (imagem): fica em quarentena na normalização, nunca chega a decisão/aplicação alguma', () => {
    const armazenamento = novoArmazenamento();
    const { normalizado, aplicacao } = processarPipelineReal(PAYLOAD_IMAGEM_FICTICIO, armazenamento);
    expect(normalizado.tipo).toBe('quarentena_tipo_de_conteudo_nao_suportado');
    expect(aplicacao).toBeUndefined();
  });

  it('payload inválido (sem messageId): rejeitado na validação, nunca chega a decisão/aplicação alguma', () => {
    const armazenamento = novoArmazenamento();
    const { normalizado, aplicacao } = processarPipelineReal(PAYLOAD_INVALIDO_SEM_MESSAGE_ID_FICTICIO, armazenamento);
    expect(normalizado.tipo).toBe('invalido');
    expect(aplicacao).toBeUndefined();
  });
});

describe('redelivery (reentrega) do mesmo messageId — deduplicação durável, mesmo sem nunca ter criado rascunho', () => {
  it('entregar o MESMO payload duas vezes não lança erro, não duplica registro, e a 2ª vez reconhece o messageId como já observado', () => {
    const armazenamento = novoArmazenamento();

    const primeira = processarPipelineReal(PAYLOAD_TEXTO_PRIVADO_FICTICIO, armazenamento);
    expect(primeira.aplicacao?.tipo).toBe('nao_elegivel');
    expect(armazenamento.foiObservadoComoNaoElegivel(PAYLOAD_TEXTO_PRIVADO_FICTICIO.messageId)).toBe(true);

    // Reentrega — mesmo messageId, mesmo payload, processado de novo do zero.
    const segunda = processarPipelineReal(PAYLOAD_TEXTO_PRIVADO_FICTICIO, armazenamento);
    expect(segunda.aplicacao?.tipo).toBe('nao_elegivel');
  });

  it('replay/restart: uma instância NOVA de armazenamento, apontando para o MESMO arquivo, ainda reconhece o messageId como observado', () => {
    const nomeArquivo = 'durabilidade-restart.json';
    const armazenamentoAntes = novoArmazenamento(nomeArquivo);
    processarPipelineReal(PAYLOAD_TEXTO_PRIVADO_FICTICIO, armazenamentoAntes);

    const armazenamentoDepois = novoArmazenamento(nomeArquivo);
    expect(armazenamentoDepois.foiObservadoComoNaoElegivel(PAYLOAD_TEXTO_PRIVADO_FICTICIO.messageId)).toBe(true);
  });
});

describe('SIMULAÇÃO explícita, só nesta suíte de teste — NUNCA em código de produção — de "como seria se elegivel:true"', () => {
  it('SIMULACAO_APENAS_PARA_TESTE: se decidirIngestaoAutomatica um dia pudesse devolver elegivel:true, o aplicador cria um rascunho pendente_aprovacao, deduplicado por messageId', () => {
    const armazenamento = novoArmazenamento();
    const decisaoSimulada_NUNCA_REAL = decisaoSimuladaElegivel('msg-ficticio-simulacao-elegivel-001');

    const resultado = aplicarDecisaoIngestao(decisaoSimulada_NUNCA_REAL, armazenamento);
    expect(resultado.tipo).toBe('rascunho_criado');
    if (resultado.tipo !== 'rascunho_criado') throw new Error('esperado rascunho_criado');
    expect(resultado.rascunho.status).toBe('pendente_aprovacao');
    expect(resultado.rascunho.messageId).toBe('msg-ficticio-simulacao-elegivel-001');

    // Reaplicar a MESMA decisão simulada (redelivery do caso elegível) não duplica.
    const segunda = aplicarDecisaoIngestao(decisaoSimulada_NUNCA_REAL, armazenamento);
    expect(segunda.tipo).toBe('duplicado');
  });

  it('(a) CORREÇÃO: depois de um restart, recupera o RASCUNHO INTEIRO (não só o id) — antes desta correção, o conteúdo era perdido', () => {
    const nomeArquivo = 'durabilidade-rascunho-completo.json';
    const armazenamentoAntes = novoArmazenamento(nomeArquivo);
    const decisaoSimulada = decisaoSimuladaElegivel('msg-ficticio-restart-completo-001', {
      remetenteNome: 'Nome Fictício Para Verificar Recuperação',
      texto: 'Texto fictício específico que precisa sobreviver ao restart.',
      momentoUnix: 1700000555,
    });
    aplicarDecisaoIngestao(decisaoSimulada, armazenamentoAntes);

    // Restart: instância totalmente nova, mesmo arquivo — nada em memória é reaproveitado.
    const armazenamentoDepois = novoArmazenamento(nomeArquivo);
    const consulta = armazenamentoDepois.consultarAplicacaoEfetiva('msg-ficticio-restart-completo-001');
    expect(consulta.situacao).toBe('aplicado');
    if (consulta.situacao !== 'aplicado') throw new Error('esperado aplicado');
    expect(consulta.rascunho.texto).toBe('Texto fictício específico que precisa sobreviver ao restart.');
    expect(consulta.rascunho.remetenteNome).toBe('Nome Fictício Para Verificar Recuperação');
    expect(consulta.rascunho.momentoUnix).toBe(1700000555);
    expect(consulta.rascunho.status).toBe('pendente_aprovacao');
  });

  it('(c) CORREÇÃO: uma observação NÃO elegível anterior do mesmo messageId nunca bloqueia nem aparece como aplicação efetiva', () => {
    const armazenamento = novoArmazenamento();

    // Primeiro, o pipeline REAL observa este messageId como não elegível (caso normal hoje).
    const payloadComEsseId = { ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-ficticio-mesmo-id-002' };
    const resultadoObservacao = processarPipelineReal(payloadComEsseId, armazenamento);
    expect(resultadoObservacao.aplicacao?.tipo).toBe('nao_elegivel');

    // A tabela de aplicações efetivas NUNCA deve refletir essa observação.
    const consultaAntes = armazenamento.consultarAplicacaoEfetiva('msg-ficticio-mesmo-id-002');
    expect(consultaAntes.situacao).toBe('nao_aplicado');

    // Simula uma futura decisão ELEGÍVEL (hipotética) para o MESMO messageId
    // — a observação anterior não deve impedir nem colidir com isso.
    const decisaoSimulada = decisaoSimuladaElegivel('msg-ficticio-mesmo-id-002');
    const resultado = aplicarDecisaoIngestao(decisaoSimulada, armazenamento);
    expect(resultado.tipo).toBe('rascunho_criado');
  });

  it('(d) regressão: redelivery no caminho elegível simulado deduplica por messageId (não só por referência de objeto)', () => {
    const armazenamento = novoArmazenamento();
    const decisaoA = decisaoSimuladaElegivel('msg-ficticio-dedup-003');
    const decisaoB = decisaoSimuladaElegivel('msg-ficticio-dedup-003'); // objeto DIFERENTE, mesmo messageId

    const primeira = aplicarDecisaoIngestao(decisaoA, armazenamento);
    expect(primeira.tipo).toBe('rascunho_criado');
    const segunda = aplicarDecisaoIngestao(decisaoB, armazenamento);
    expect(segunda.tipo).toBe('duplicado');
  });
});

describe('(b) CORREÇÃO: armazenamento corrompido bloqueia explicitamente, preserva o arquivo, nunca finge "vazio"', () => {
  it('um arquivo de durabilidade com JSON inválido deixa o armazenamento em estado corrompido — nunca silenciosamente vazio', () => {
    const caminho = join(dirTemp, 'corrompido.json');
    writeFileSync(caminho, '{ isto não é json válido ][', 'utf8');

    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    const situacao = armazenamento.estaCorrompido();
    expect(situacao.corrompido).toBe(true);
  });

  it('com armazenamento corrompido, consultar uma aplicação efetiva devolve armazenamento_corrompido — nunca nao_aplicado (que esconderia o problema)', () => {
    const caminho = join(dirTemp, 'corrompido2.json');
    writeFileSync(caminho, 'não é json de jeito nenhum', 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);

    const consulta = armazenamento.consultarAplicacaoEfetiva('qualquer-messageId');
    expect(consulta.situacao).toBe('armazenamento_corrompido');
  });

  it('com armazenamento corrompido, registrar uma observação ou aplicação falha explicitamente (ok:false) em vez de escrever por cima', () => {
    const caminho = join(dirTemp, 'corrompido3.json');
    writeFileSync(caminho, '{{{inválido', 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);

    const registroObservacao = armazenamento.registrarObservacaoNaoElegivel('msg-x', 'motivo qualquer');
    expect(registroObservacao.ok).toBe(false);

    const registroAplicacao = armazenamento.registrarAplicacaoEfetiva('msg-y', {
      origem: 'webhook_w_api_callback_nao_autenticado',
      messageId: 'msg-y',
      instanceId: 'i',
      remetenteId: 'r',
      texto: 't',
      momentoUnix: 1,
      status: 'pendente_aprovacao',
    });
    expect(registroAplicacao.ok).toBe(false);
  });

  it('o arquivo corrompido NUNCA é sobrescrito automaticamente — continua exatamente igual em disco depois de construir/consultar/tentar registrar', () => {
    const caminho = join(dirTemp, 'corrompido4.json');
    const conteudoOriginal = '{ conteúdo corrompido de propósito, para diagnóstico manual';
    writeFileSync(caminho, conteudoOriginal, 'utf8');

    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    armazenamento.consultarAplicacaoEfetiva('qualquer');
    armazenamento.registrarObservacaoNaoElegivel('qualquer', 'motivo');

    const conteudoDepois = readFileSync(caminho, 'utf8');
    expect(conteudoDepois).toBe(conteudoOriginal);
  });

  it('o pipeline completo propaga armazenamento_corrompido em vez de silenciosamente tratar como não elegível', () => {
    const caminho = join(dirTemp, 'corrompido5.json');
    writeFileSync(caminho, 'json corrompido de propósito', 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);

    const { aplicacao } = processarPipelineReal(PAYLOAD_TEXTO_PRIVADO_FICTICIO, armazenamento);
    expect(aplicacao?.tipo).toBe('armazenamento_corrompido');
  });
});

describe('escrita atômica (torn-write) — presença do mecanismo, não simulação de crash real', () => {
  it('depois de registrar, o arquivo final é sempre um JSON válido e completo (nunca um .tmp sobrando no caminho final)', () => {
    const caminho = join(dirTemp, 'atomico.json');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    armazenamento.registrarObservacaoNaoElegivel('msg-atomico-1', 'motivo');
    const conteudo = readFileSync(caminho, 'utf8');
    expect(() => JSON.parse(conteudo)).not.toThrow();
  });
});

describe("(d) DEMONSTRA (não corrige) a lacuna de concorrência multi-processo — fora do escopo deste protótipo, declarado explicitamente", () => {
  it('duas instâncias independentes, lendo o MESMO arquivo antes de qualquer uma escrever, fazem a última escrita vencer (last-write-wins) — sem travamento entre processos', () => {
    const caminho = join(dirTemp, 'corrida.json');

    // Ambas as instâncias "nascem" olhando o mesmo estado inicial (vazio),
    // simulando dois processos/invocações concorrentes.
    const instanciaA = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    const instanciaB = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);

    // As duas "decidem", de forma independente, que o mesmo messageId ainda
    // não foi aplicado (nenhuma viu a escrita da outra) e as duas registram.
    const consultaA = instanciaA.consultarAplicacaoEfetiva('msg-corrida-001');
    const consultaB = instanciaB.consultarAplicacaoEfetiva('msg-corrida-001');
    expect(consultaA.situacao).toBe('nao_aplicado');
    expect(consultaB.situacao).toBe('nao_aplicado'); // nenhuma trava impediu isso — é exatamente a lacuna

    instanciaA.registrarAplicacaoEfetiva('msg-corrida-001', {
      origem: 'webhook_w_api_callback_nao_autenticado',
      messageId: 'msg-corrida-001',
      instanceId: 'instancia-A',
      remetenteId: 'r',
      texto: 'escrita da instância A',
      momentoUnix: 1,
      status: 'pendente_aprovacao',
    });
    instanciaB.registrarAplicacaoEfetiva('msg-corrida-001', {
      origem: 'webhook_w_api_callback_nao_autenticado',
      messageId: 'msg-corrida-001',
      instanceId: 'instancia-B',
      remetenteId: 'r',
      texto: 'escrita da instância B',
      momentoUnix: 2,
      status: 'pendente_aprovacao',
    });

    // Uma terceira instância, lendo o arquivo final, só vê a ÚLTIMA escrita
    // (de B) — a de A foi silenciosamente perdida. Isto é a demonstração da
    // lacuna, não uma correção: nenhum mecanismo de lock existe aqui.
    const instanciaFinal = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    const consultaFinal = instanciaFinal.consultarAplicacaoEfetiva('msg-corrida-001');
    expect(consultaFinal.situacao).toBe('aplicado');
    if (consultaFinal.situacao !== 'aplicado') throw new Error('esperado aplicado');
    expect(consultaFinal.rascunho.instanceId).toBe('instancia-B');
    // A escrita de A existiu, foi real, e foi perdida — nenhuma duplicata
    // de rascunho foi criada aqui (não é um bug de duplicação), mas também
    // nenhuma garantia de que AMBAS as escritas concorrentes sejam
    // preservadas ou detectadas como conflito.
  });
});

describe('(revisão independente nº2) (1) esquema completo é exigido — formato antigo/campos inválidos bloqueiam, NUNCA viram vazio', () => {
  function rascunhoValido(messageId: string): RascunhoOSWebhookRecebido {
    return {
      origem: 'webhook_w_api_callback_nao_autenticado',
      messageId,
      instanceId: 'instancia-ficticia',
      remetenteId: 'remetente-ficticio',
      texto: 'texto fictício',
      momentoUnix: 1,
      status: 'pendente_aprovacao',
    };
  }

  it('objeto vazio {} (sem as duas chaves esperadas) bloqueia — ANTES isso virava silenciosamente estado vazio', () => {
    const caminho = join(dirTemp, 'esquema-vazio.json');
    writeFileSync(caminho, '{}', 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(true);
  });

  it('{"aplicacoesEfetivas": []} (tipo errado, array em vez de objeto) bloqueia — ANTES isso virava silenciosamente {}', () => {
    const caminho = join(dirTemp, 'esquema-array.json');
    writeFileSync(caminho, JSON.stringify({ observacoesNaoElegiveis: {}, aplicacoesEfetivas: [] }), 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(true);
  });

  it('formato antigo com uma chave de topo extra/desconhecida bloqueia', () => {
    const caminho = join(dirTemp, 'esquema-chave-extra.json');
    writeFileSync(caminho, JSON.stringify({ observacoesNaoElegiveis: {}, aplicacoesEfetivas: {}, mensagensProcessadas: {} }), 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(true);
  });

  it('um rascunho malformado dentro de aplicacoesEfetivas (campo obrigatório ausente) bloqueia o arquivo INTEIRO', () => {
    const caminho = join(dirTemp, 'esquema-rascunho-malformado.json');
    writeFileSync(
      caminho,
      JSON.stringify({ observacoesNaoElegiveis: {}, aplicacoesEfetivas: { 'msg-1': { origem: 'webhook_w_api_callback_nao_autenticado', messageId: 'msg-1' } } }),
      'utf8'
    );
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(true);
  });

  it('messageId do rascunho divergente da própria chave do mapa bloqueia (detecta adulteração)', () => {
    const caminho = join(dirTemp, 'esquema-id-divergente.json');
    const rascunho = rascunhoValido('msg-A');
    writeFileSync(caminho, JSON.stringify({ observacoesNaoElegiveis: {}, aplicacoesEfetivas: { 'msg-B': rascunho } }), 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(true);
  });

  it('CONTROLE POSITIVO: um arquivo vazio porém bem formado (as duas tabelas vazias) NÃO é tratado como corrompido', () => {
    const caminho = join(dirTemp, 'esquema-valido-vazio.json');
    writeFileSync(caminho, JSON.stringify({ observacoesNaoElegiveis: {}, aplicacoesEfetivas: {} }), 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(false);
  });

  it('CONTROLE POSITIVO: um arquivo bem formado com um rascunho válido carrega normalmente e é consultável', () => {
    const caminho = join(dirTemp, 'esquema-valido-com-dado.json');
    const rascunho = rascunhoValido('msg-valido-001');
    writeFileSync(caminho, JSON.stringify({ observacoesNaoElegiveis: {}, aplicacoesEfetivas: { 'msg-valido-001': rascunho } }), 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(false);
    const consulta = armazenamento.consultarAplicacaoEfetiva('msg-valido-001');
    expect(consulta.situacao).toBe('aplicado');
  });
});

describe('(revisão independente nº2) (2) falha de GRAVAÇÃO (I/O) vira resultado explícito, nunca lança, nunca finge sucesso', () => {
  it('quando o diretório não pode ser criado (um componente do caminho é um ARQUIVO, não um diretório), registrar devolve ok:false em vez de lançar', () => {
    const caminhoQueEhArquivo = join(dirTemp, 'isto-e-um-arquivo-nao-diretorio');
    writeFileSync(caminhoQueEhArquivo, 'conteúdo qualquer', 'utf8');
    // Caminho do armazenamento fica "dentro" de um arquivo — mkdir do diretório pai tem que falhar (ENOTDIR).
    const caminhoImpossivel = join(caminhoQueEhArquivo, 'sub', 'durabilidade.json');

    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminhoImpossivel);
    // Na construção, o arquivo não existe (não há como existir dentro de um
    // arquivo) — isso é "nunca existiu", não corrupção; o armazenamento
    // começa normal, vazio.
    expect(armazenamento.estaCorrompido().corrompido).toBe(false);

    // A ESCRITA é que deve falhar, de forma explícita, sem lançar.
    let lancou = false;
    let resultado: { ok: boolean; motivo?: string } | undefined;
    try {
      resultado = armazenamento.registrarObservacaoNaoElegivel('msg-falha-escrita-001', 'motivo qualquer');
    } catch {
      lancou = true;
    }
    expect(lancou).toBe(false);
    expect(resultado?.ok).toBe(false);
  });

  it('depois de uma falha de gravação, o estado anterior em memória é preservado (consulta subsequente continua consistente)', () => {
    const caminhoQueEhArquivo = join(dirTemp, 'isto-tambem-e-arquivo');
    writeFileSync(caminhoQueEhArquivo, 'conteúdo qualquer', 'utf8');
    const caminhoImpossivel = join(caminhoQueEhArquivo, 'sub', 'durabilidade2.json');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminhoImpossivel);

    const resultado = armazenamento.registrarAplicacaoEfetiva('msg-falha-escrita-002', {
      origem: 'webhook_w_api_callback_nao_autenticado',
      messageId: 'msg-falha-escrita-002',
      instanceId: 'i',
      remetenteId: 'r',
      texto: 't',
      momentoUnix: 1,
      status: 'pendente_aprovacao',
    });
    expect(resultado.ok).toBe(false);

    // Não ficou "meio aplicado" — a consulta reflete que nada foi persistido de verdade.
    const consulta = armazenamento.consultarAplicacaoEfetiva('msg-falha-escrita-002');
    expect(consulta.situacao).toBe('nao_aplicado');
    expect(armazenamento.estaCorrompido().corrompido).toBe(false); // falha de escrita não é a mesma coisa que corrupção de leitura
  });
});

describe('(revisão independente nº2) (3) chaves de propriedade perigosas nunca enganam consulta por herança de protótipo', () => {
  it('consultar "constructor"/"toString"/"__proto__" num armazenamento NOVO (nunca escrito) nunca aparece como aplicado', () => {
    const armazenamento = novoArmazenamento();
    expect(armazenamento.consultarAplicacaoEfetiva('constructor').situacao).toBe('nao_aplicado');
    expect(armazenamento.consultarAplicacaoEfetiva('toString').situacao).toBe('nao_aplicado');
    expect(armazenamento.consultarAplicacaoEfetiva('__proto__').situacao).toBe('nao_aplicado');
    expect(armazenamento.consultarAplicacaoEfetiva('hasOwnProperty').situacao).toBe('nao_aplicado');
  });

  it('registrar uma aplicação efetiva com messageId "constructor"/"__proto__"/"prototype" é RECUSADO explicitamente, nunca escrito', () => {
    const armazenamento = novoArmazenamento();
    for (const chavePerigosa of ['constructor', '__proto__', 'prototype']) {
      const resultado = armazenamento.registrarAplicacaoEfetiva(chavePerigosa, {
        origem: 'webhook_w_api_callback_nao_autenticado',
        messageId: chavePerigosa,
        instanceId: 'i',
        remetenteId: 'r',
        texto: 't',
        momentoUnix: 1,
        status: 'pendente_aprovacao',
      });
      expect(resultado.ok).toBe(false);
    }
    // Nada vazou para o protótipo real de Object — uma consulta normal continua normal.
    expect(armazenamento.consultarAplicacaoEfetiva('qualquer-outro-id').situacao).toBe('nao_aplicado');
  });

  it('"toString"/"hasOwnProperty" NÃO precisam ser recusados (são só métodos herdados, não afetam a estrutura do objeto) — mas têm que funcionar como uma chave normal, round-trip correto, sem confusão com o método herdado (mapa sem protótipo)', () => {
    const armazenamento = novoArmazenamento();
    const resultado = armazenamento.registrarObservacaoNaoElegivel('toString', 'motivo fictício para a chave toString');
    expect(resultado.ok).toBe(true);
    expect(armazenamento.foiObservadoComoNaoElegivel('toString')).toBe(true);
    // Uma chave DIFERENTE, nunca escrita, continua corretamente "não observada" — prova que não é um falso-positivo geral.
    expect(armazenamento.foiObservadoComoNaoElegivel('qualquer-outra-coisa-nunca-escrita')).toBe(false);
  });

  it('"__proto__"/"constructor"/"prototype" continuam recusados mesmo quando o ARQUIVO já está carregado (não só na primeira leitura) — tentativa de escrita depois da construção', () => {
    const armazenamento = novoArmazenamento();
    const resultado = armazenamento.registrarObservacaoNaoElegivel('__proto__', 'tentativa de poluição de protótipo');
    expect(resultado.ok).toBe(false);
  });

  it('um arquivo em disco com a chave perigosa "constructor" dentro de aplicacoesEfetivas é tratado como CORROMPIDO na leitura, nunca aceito', () => {
    const caminho = join(dirTemp, 'chave-perigosa-no-disco.json');
    writeFileSync(
      caminho,
      JSON.stringify({
        observacoesNaoElegiveis: {},
        aplicacoesEfetivas: {
          constructor: {
            origem: 'webhook_w_api_callback_nao_autenticado',
            messageId: 'constructor',
            instanceId: 'i',
            remetenteId: 'r',
            texto: 't',
            momentoUnix: 1,
            status: 'pendente_aprovacao',
          },
        },
      }),
      'utf8'
    );
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);
    expect(armazenamento.estaCorrompido().corrompido).toBe(true);
  });
});
