// Guarda estrutural (mesmo espírito de
// ../../webhookRecebido/__tests__/semBackendReal.test.ts): lê o CÓDIGO-FONTE
// como texto e confirma, por padrão sintático, que nada deste subdiretório
// abre uma porta que não deveria existir. Não precisa rodar dentro do
// runtime de Workers — só lê arquivos — mas fica neste pacote isolado porque
// só faz sentido junto do código que está guardando.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..');
const worker = readFileSync(join(DIR, 'worker.ts'), 'utf8');
const aplicador = readFileSync(join(DIR, 'aplicarDecisaoIngestaoWorker.ts'), 'utf8');
const durableObject = readFileSync(join(DIR, 'durableObjectDedup.ts'), 'utf8');
const limitarEntrada = readFileSync(join(DIR, 'limitarEntradaHttp.ts'), 'utf8');

describe('guarda estrutural — webhookRecebidoWorker/', () => {
  it('nenhum arquivo de produção (worker/aplicador/Durable Object) contém método, flag ou bypass marcado como SOMENTE_TESTE (revisão independente nº2: o artefato de aplicação nunca pode levar esse tipo de porta)', () => {
    expect(worker).not.toMatch(/_SOMENTE_TESTE_/);
    expect(aplicador).not.toMatch(/_SOMENTE_TESTE_/);
    expect(durableObject).not.toMatch(/_SOMENTE_TESTE_/);
    expect(durableObject).not.toMatch(/sentinela_rollback/i);
  });

  it('worker.ts calcula a identidade de roteamento do Durable Object SEMPRE via codificarChaveCompostaDedup — nunca por concatenação ingênua com "::" (revisão independente nº2: essa concatenação era ambígua)', () => {
    expect(worker).toMatch(/codificarChaveCompostaDedup\(/);
    expect(worker).not.toMatch(/idFromName\(`\$\{[^}]*\}::\$\{/);
  });

  it('worker.ts nunca importa nem chama decidirIngestaoAutomatica diretamente com um valor fabricado — só reaproveita a decisão já calculada pelo pipeline existente', () => {
    // A única chamada a decidirIngestaoAutomatica deve vir do pipeline
    // existente (import + uma única invocação com `normalizado.evento`).
    const ocorrencias = worker.match(/decidirIngestaoAutomatica\(/g) ?? [];
    expect(ocorrencias.length).toBe(1);
    expect(worker).toMatch(/decidirIngestaoAutomatica\(normalizado\.evento\)/);
  });

  it('worker.ts nunca passa cabecalhosObservados para decidirIngestaoAutomatica nem para aplicarDecisaoIngestaoWorker — cabeçalhos só alimentam a resposta HTTP, nunca a decisão', () => {
    const chamadaDecisao = worker.match(/decidirIngestaoAutomatica\([^)]*\)/)?.[0] ?? '';
    const chamadaAplicador = worker.match(/aplicarDecisaoIngestaoWorker\([\s\S]*?\n\s*\);/)?.[0] ?? '';
    expect(chamadaDecisao).not.toMatch(/cabecalhosObservados/);
    expect(chamadaAplicador).not.toMatch(/cabecalhosObservados/);
    expect(worker).not.toMatch(/headers\.get\([^)]*\)\s*===?\s*['"].*assinatura/i);
  });

  it('durableObjectDedup.ts nunca importa decidirIngestaoAutomatica — a store nunca decide elegibilidade sozinha', () => {
    expect(durableObject).not.toMatch(/decidirIngestaoAutomatica/);
  });

  it('nenhum arquivo de produção deste subdiretório importa node:fs/node:path (só a store Durable Object/SQLite é usada aqui, nunca arquivo local)', () => {
    for (const [nome, conteudo] of [
      ['worker.ts', worker],
      ['aplicarDecisaoIngestaoWorker.ts', aplicador],
      ['durableObjectDedup.ts', durableObject],
    ] as const) {
      expect(conteudo, `${nome} não deveria importar node:fs/node:path`).not.toMatch(/from ['"]node:(fs|path)['"]/);
    }
  });

  it('nenhum arquivo de produção deste subdiretório contém a marca SIMULACAO/FICTICIO de teste vazando para produção', () => {
    for (const conteudo of [worker, aplicador, durableObject]) {
      expect(conteudo).not.toMatch(/SIMULACAO_APENAS_PARA_TESTE/);
    }
  });

  it('wrangler.jsonc desta pasta nunca declara account_id (nunca aponta para uma conta real)', () => {
    const wranglerJsonc = readFileSync(join(DIR, 'wrangler.jsonc'), 'utf8');
    // Checa a CHAVE JSON de verdade (entre aspas), não a palavra em
    // comentários explicativos (que mencionam account_id de propósito, para
    // dizer que ele nunca é declarado).
    expect(wranglerJsonc).not.toMatch(/"account_id"\s*:/);
  });

  it('nenhuma assinatura/segredo/HMAC de fornecedor foi inventado, e nenhum bypass do gate G1 por query/header/env existe (preparação desta rodada)', () => {
    for (const [nome, conteudo] of [
      ['worker.ts', worker],
      ['aplicarDecisaoIngestaoWorker.ts', aplicador],
      ['durableObjectDedup.ts', durableObject],
      ['limitarEntradaHttp.ts', limitarEntrada],
    ] as const) {
      // Nenhuma verificação de assinatura/HMAC/segredo de callback inventada.
      expect(conteudo, `${nome} não deveria mencionar hmac/signature/assinatura como verificação`).not.toMatch(/\bhmac\b/i);
      // Nenhuma leitura de query string ou variável de ambiente usada para
      // decidir elegibilidade/autenticidade (RECEPTOR_HABILITADO é o único
      // uso de `env.` em worker.ts, e só controla ligado/desligado — nunca
      // abre o gate G1; `decidirIngestaoAutomatica` continua sendo a ÚNICA
      // fonte da decisão de elegibilidade, sempre fail-closed).
      expect(conteudo, `${nome} não deveria ler searchParams para decidir algo`).not.toMatch(/searchParams/);
    }
    // worker.ts só lê UMA variável de ambiente (RECEPTOR_HABILITADO), e ela
    // nunca é passada para decidirIngestaoAutomatica/aplicarDecisaoIngestaoWorker.
    const usosDeEnv = worker.match(/env\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    for (const uso of usosDeEnv) {
      expect(['env.RECEPTOR_HABILITADO', 'env.DEDUP_DO']).toContain(uso);
    }
  });

  it('aplicarDecisaoIngestaoWorker.ts NUNCA chama obterStub (nenhuma alocação/gravação de Durable Object) dentro do ramo não-elegível — proteção antiabuso desta rodada: rejeitar antes de alocar', () => {
    const ramoNaoElegivel = aplicador.match(/if \(!decisao\.elegivel\) \{[\s\S]*?\n {2}\}/)?.[0] ?? '';
    expect(ramoNaoElegivel).not.toBe('');
    expect(ramoNaoElegivel).not.toMatch(/obterStub/);
    expect(ramoNaoElegivel).not.toMatch(/registrarObservacaoNaoElegivel/);
  });

  it('worker.ts lê o corpo SEMPRE através de lerCorpoComLimiteDeBytes (limitarEntradaHttp.ts) — nunca request.text()/request.json() sem limite', () => {
    expect(worker).toMatch(/lerCorpoComLimiteDeBytes\(/);
    expect(worker).not.toMatch(/request\.text\(\)/);
    expect(worker).not.toMatch(/request\.json\(\)/);
  });

  it('worker.ts verifica RECEPTOR_HABILITADO antes de qualquer outra verificação/leitura (primeiro `if` da função fetch)', () => {
    const corpoDoFetch = worker.match(/async fetch\(request: Request, env: Env\): Promise<Response> \{([\s\S]*)/)?.[1] ?? '';
    const primeiroIf = corpoDoFetch.match(/if \([^)]*\)/)?.[0] ?? '';
    expect(primeiroIf).toMatch(/RECEPTOR_HABILITADO/);
  });

  it('limparRegistrosMaisAntigosQue (primitivo de retenção/limpeza, preparação desta rodada) NUNCA é chamado por nenhum caminho de produção — só existe como primitivo testado isoladamente em dedupDurableObject.test.ts', () => {
    // Definido em durableObjectDedup.ts (exatamente uma vez, como método da
    // classe) — mas nunca CHAMADO (nunca `.limparRegistrosMaisAntigosQue(`)
    // em nenhum dos três arquivos de produção deste subpacote.
    expect(durableObject).toMatch(/async limparRegistrosMaisAntigosQue\(/);
    for (const [nome, conteudo] of [
      ['worker.ts', worker],
      ['aplicarDecisaoIngestaoWorker.ts', aplicador],
    ] as const) {
      expect(conteudo, `${nome} não deveria chamar limparRegistrosMaisAntigosQue — é um primitivo preparado, não uma política ativa`).not.toMatch(/limparRegistrosMaisAntigosQue\(/);
    }
  });

  it('worker.ts NUNCA devolve 200 para conteúdo descartado (não-elegível/quarentena de grupo/mídia) — correção desta rodada: autenticidade sem mecanismo verificado nunca pode ser confirmada com um 2xx', () => {
    // Varredura estrutural: nenhuma das três variantes de conteúdo
    // descartado aparece associada a `200` no literal do arquivo-fonte
    // (as três usam `responderRecebimentoDescartado`, que é sempre 503 —
    // ver essa função). Mais confiável que inspecionar `200` isolado:
    // confirma que o literal 200 nunca aparece na mesma linha que os
    // resultados de conteúdo descartado.
    for (const resultadoDescartado of ['quarentena_grupo_nao_suportado', 'quarentena_tipo_de_conteudo_nao_suportado', 'recebido_nao_elegivel']) {
      const linhasComOResultado = worker.split('\n').filter((linha) => linha.includes(resultadoDescartado));
      for (const linha of linhasComOResultado) {
        expect(linha, `linha com '${resultadoDescartado}' nunca deveria mencionar o literal 200`).not.toMatch(/\b200\b/);
      }
    }
    // As três variantes usam a mesma função de resposta — sempre 503.
    expect(worker).toMatch(/function responderRecebimentoDescartado[\s\S]*?503/);
  });

  it('405 inclui Allow: POST (RFC 9110 §15.5.6) — cabecalhosExtras é propagado de validarMetodoRotaFormato até a resposta real em worker.ts', () => {
    expect(limitarEntrada).toMatch(/cabecalhosExtras:\s*\{\s*Allow:\s*'POST'\s*\}/);
    expect(worker).toMatch(/cabecalhosExtras/);
  });

  it('Content-Type é validado por MEDIA TYPE EXATO (correção desta rodada) — nunca mais por prefixo de string (startsWith), que aceitava media types diferentes como application/jsonp', () => {
    expect(limitarEntrada).not.toMatch(/tipoDeConteudo\.startsWith/);
    expect(limitarEntrada).toMatch(/function validarContentTypeExato/);
  });

  it('nenhuma mensagem de erro em limitarEntradaHttp.ts/durableObjectDedup.ts interpola erro.message/erro.name/o valor recebido de Content-Encoding (correção desta rodada: mensagens sempre genéricas)', () => {
    for (const [nome, conteudo] of [
      ['limitarEntradaHttp.ts', limitarEntrada],
      ['durableObjectDedup.ts', durableObject],
    ] as const) {
      expect(conteudo, `${nome} não deveria interpolar erro.message em nenhuma motivo/mensagem`).not.toMatch(/\$\{erro\.message/);
      expect(conteudo, `${nome} não deveria interpolar erro.name em nenhuma motivo/mensagem`).not.toMatch(/\$\{erro\.name/);
    }
    expect(limitarEntrada, 'Content-Encoding declarado nunca deveria ser ecoado na mensagem de erro').not.toMatch(/\$\{codificacaoDeConteudo\}/);
  });

  it('nome de parâmetro de Content-Type (nomeParametro) nunca é ecoado na mensagem de erro (correção desta rodada)', () => {
    expect(limitarEntrada, 'nomeParametro não deveria ser interpolado em nenhuma mensagem de erro').not.toMatch(/\$\{nomeParametro\}/);
  });

  it('wrangler.jsonc (config DISTRIBUÍDA) declara RECEPTOR_HABILITADO="false" — o "true" usado pelos testes vem só do override em vitest.config.ts, nunca deste arquivo (correção desta rodada)', () => {
    const wranglerJsonc = readFileSync(join(DIR, 'wrangler.jsonc'), 'utf8');
    expect(wranglerJsonc).toMatch(/"RECEPTOR_HABILITADO"\s*:\s*"false"/);
    expect(wranglerJsonc).not.toMatch(/"RECEPTOR_HABILITADO"\s*:\s*"true"/);

    const vitestConfig = readFileSync(join(DIR, 'vitest.config.ts'), 'utf8');
    expect(vitestConfig).toMatch(/RECEPTOR_HABILITADO:\s*'true'/);
  });
});
