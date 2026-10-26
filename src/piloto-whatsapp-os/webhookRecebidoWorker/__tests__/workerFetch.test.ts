// Testes de ponta a ponta do Worker `fetch(Request)` — rodando no runtime
// local de Workers (Miniflare). NUNCA faz nenhuma chamada de rede externa:
// `SELF.fetch` injeta a requisição diretamente no handler sob teste, dentro
// do mesmo processo de teste.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_GRUPO_FICTICIO,
  PAYLOAD_IMAGEM_FICTICIO,
  PAYLOAD_TEXTO_PRIVADO_FICTICIO,
} from '../../webhookRecebido/fixturesWebhookRecebido';
import workerPadrao, { type Env } from '../worker';
import { TAMANHO_MAXIMO_CORPO_BYTES } from '../limitarEntradaHttp';
import { codificarChaveCompostaDedup } from '../chaveCompostaDedup';
import fixtureSmokeTeste from '../fixtures/smoke-teste-texto-privado.json';

const URL_CALLBACK = 'https://exemplo-ficticio.invalido/webhook-w-api';

function requisicao(corpo: unknown, cabecalhos: Record<string, string> = {}): Request {
  return new Request(URL_CALLBACK, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cabecalhos },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

/**
 * Envelopa `env.DEDUP_DO` (o binding REAL do Durable Object, vindo de
 * `cloudflare:test`) num Proxy que só CONTA chamadas a `idFromName`/`get` —
 * nunca substitui o comportamento real (todas as chamadas são repassadas
 * ao binding de verdade via `Reflect`). Usado para provar, de dentro do
 * runtime real, que uma determinada chamada a `fetch()` NUNCA alocou um
 * Durable Object — não um teste indireto (como "a mensagem continua
 * nao_aplicado"), que seria verdade mesmo que uma alocação tivesse
 * acontecido e simplesmente não afetasse esse resultado.
 */
function envComContadorDeAlocacoesDO(): { env: Env; contagem: { chamadas: number } } {
  const contagem = { chamadas: 0 };
  const dedupOriginal = env.DEDUP_DO;
  const dedupComContagem = new Proxy(dedupOriginal, {
    get(alvo, propriedade, receptor) {
      if (propriedade === 'idFromName' || propriedade === 'get' || propriedade === 'newUniqueId' || propriedade === 'idFromString') {
        contagem.chamadas++;
      }
      return Reflect.get(alvo, propriedade, receptor);
    },
  });
  return { env: { ...(env as unknown as Env), DEDUP_DO: dedupComContagem }, contagem };
}

describe('worker.ts fetch() — caminho real completo, mensagens fictícias: NUNCA 2xx para conteúdo descartado (correção desta rodada)', () => {
  it('mensagem de texto privado fictícia: 503 (nunca 2xx), recebido_nao_elegivel — autenticidade sem mecanismo verificado, gate G1 fechado', async () => {
    const payload = { ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-001' };
    const resposta = await SELF.fetch('https://exemplo-ficticio.invalido/webhook-w-api', requisicao(payload));
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { resultado: string };
    expect(corpo.resultado).toBe('recebido_nao_elegivel');
  });

  it('método diferente de POST: 405', async () => {
    const resposta = await SELF.fetch('https://exemplo-ficticio.invalido/webhook-w-api', { method: 'GET' });
    expect(resposta.status).toBe(405);
  });

  it('corpo que não é JSON válido: 400, nunca lança', async () => {
    const resposta = await SELF.fetch('https://exemplo-ficticio.invalido/webhook-w-api', requisicao('{ isto não é json'));
    expect(resposta.status).toBe(400);
  });

  it('grupo fictício: 503 (nunca 2xx) — mesmo status que texto não-elegível/mídia, de propósito (não vaza qual classificação interna o payload recebeu)', async () => {
    const payload = { ...PAYLOAD_GRUPO_FICTICIO, messageId: 'msg-worker-fetch-grupo-001' };
    const resposta = await SELF.fetch('https://exemplo-ficticio.invalido/webhook-w-api', requisicao(payload));
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { resultado: string };
    expect(corpo.resultado).toBe('quarentena_grupo_nao_suportado');
  });

  it('mídia fictícia: 503 (nunca 2xx)', async () => {
    const payload = { ...PAYLOAD_IMAGEM_FICTICIO, messageId: 'msg-worker-fetch-imagem-001' };
    const resposta = await SELF.fetch('https://exemplo-ficticio.invalido/webhook-w-api', requisicao(payload));
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { resultado: string };
    expect(corpo.resultado).toBe('quarentena_tipo_de_conteudo_nao_suportado');
  });
});

describe('worker.ts fetch() — reentrega e concorrência no NÍVEL HTTP completo (passando pelo Durable Object real)', () => {
  it('reentregar a MESMA requisição (mesmo messageId) duas vezes, sequencialmente, continua respondendo 503 nao_elegivel as duas vezes (gate fechado não depende de dedup para ser seguro)', async () => {
    const payload = { ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-redelivery-001' };
    const r1 = await SELF.fetch('https://exemplo-ficticio.invalido/webhook-w-api', requisicao(payload));
    const r2 = await SELF.fetch('https://exemplo-ficticio.invalido/webhook-w-api', requisicao(payload));
    expect(r1.status).toBe(503);
    expect(r2.status).toBe(503);
    const c1 = (await r1.json()) as { resultado: string };
    const c2 = (await r2.json()) as { resultado: string };
    expect(c1.resultado).toBe('recebido_nao_elegivel');
    expect(c2.resultado).toBe('recebido_nao_elegivel');
  });

  it('cabeçalho arbitrário é OBSERVADO (nunca usado para decidir nada) — resposta não muda com ou sem ele', async () => {
    const payload = { ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-cabecalho-001' };
    const resposta = await SELF.fetch(
      'https://exemplo-ficticio.invalido/webhook-w-api',
      requisicao(payload, { 'x-assinatura-ficticia-nao-verificada': 'qualquer-valor-ficticio' })
    );
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { resultado: string };
    expect(corpo.resultado).toBe('recebido_nao_elegivel');
  });
});

describe('worker.ts fetch() — headers/query "fingindo" autenticação (revisão desta rodada): nenhum é lido, nenhum vira bypass', () => {
  const casosDeAutenticacaoForjada: Array<{ nome: string; cabecalhos?: Record<string, string>; sufixoUrl?: string }> = [
    { nome: 'Authorization: Bearer fictício', cabecalhos: { authorization: 'Bearer token-ficticio-forjado-123' } },
    { nome: 'X-Hub-Signature-256 fictício (padrão comum de webhook assinado, nunca implementado aqui)', cabecalhos: { 'x-hub-signature-256': 'sha256=assinatura-ficticia-forjada' } },
    { nome: 'X-Signature fictício', cabecalhos: { 'x-signature': 'assinatura-ficticia-forjada' } },
    { nome: 'X-Api-Key fictício', cabecalhos: { 'x-api-key': 'chave-ficticia-forjada' } },
    { nome: 'query string ?verified=true', sufixoUrl: '?verified=true' },
    { nome: 'query string ?signature=forjada&auth=1', sufixoUrl: '?signature=forjada&auth=1' },
  ];

  for (const caso of casosDeAutenticacaoForjada) {
    it(`${caso.nome}: ainda 503 recebido_nao_elegivel, ZERO alocação de Durable Object — nenhum bypass`, async () => {
      const { env: envComContador, contagem } = envComContadorDeAlocacoesDO();
      envComContador.RECEPTOR_HABILITADO = 'true';
      const payload = { ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: `msg-worker-fetch-auth-forjada-${caso.nome.length}` };
      const url = URL_CALLBACK + (caso.sufixoUrl ?? '');
      const req = new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(caso.cabecalhos ?? {}) },
        body: JSON.stringify(payload),
      });
      const resposta = await workerPadrao.fetch(req, envComContador);
      expect(resposta.status).toBe(503);
      const corpo = (await resposta.json()) as { resultado: string };
      expect(corpo.resultado).toBe('recebido_nao_elegivel');
      expect(contagem.chamadas).toBe(0);
    });
  }
});

describe('worker.ts fetch() — ausência TOTAL de persistência para conteúdo descartado (texto não-elegível, grupo, mídia)', () => {
  it('depois de um POST de texto não-elegível, a chave de dedup correspondente continua "nao_aplicado" E "não observada" — nenhum vestígio em nenhuma das duas chaves de storage do Durable Object', async () => {
    const instanceId = PAYLOAD_TEXTO_PRIVADO_FICTICIO.instanceId;
    const messageId = 'msg-worker-fetch-sem-persistencia-texto-001';
    await SELF.fetch(URL_CALLBACK, requisicao({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId }));

    const id = env.DEDUP_DO.idFromName(codificarChaveCompostaDedup(instanceId, messageId));
    const stub = env.DEDUP_DO.get(id);
    expect((await stub.consultarAplicacao()).situacao).toBe('nao_aplicado');
    expect(await stub.foiObservadoComoNaoElegivel()).toBe(false);
  });

  it('depois de um POST de grupo, a chave de dedup correspondente continua sem nenhum registro', async () => {
    const instanceId = PAYLOAD_GRUPO_FICTICIO.instanceId;
    const messageId = 'msg-worker-fetch-sem-persistencia-grupo-001';
    await SELF.fetch(URL_CALLBACK, requisicao({ ...PAYLOAD_GRUPO_FICTICIO, messageId }));

    const id = env.DEDUP_DO.idFromName(codificarChaveCompostaDedup(instanceId, messageId));
    const stub = env.DEDUP_DO.get(id);
    expect((await stub.consultarAplicacao()).situacao).toBe('nao_aplicado');
    expect(await stub.foiObservadoComoNaoElegivel()).toBe(false);
  });

  it('depois de um POST de mídia, a chave de dedup correspondente continua sem nenhum registro', async () => {
    const instanceId = PAYLOAD_IMAGEM_FICTICIO.instanceId;
    const messageId = 'msg-worker-fetch-sem-persistencia-midia-001';
    await SELF.fetch(URL_CALLBACK, requisicao({ ...PAYLOAD_IMAGEM_FICTICIO, messageId }));

    const id = env.DEDUP_DO.idFromName(codificarChaveCompostaDedup(instanceId, messageId));
    const stub = env.DEDUP_DO.get(id);
    expect((await stub.consultarAplicacao()).situacao).toBe('nao_aplicado');
    expect(await stub.foiObservadoComoNaoElegivel()).toBe(false);
  });
});

describe('worker.ts fetch() — proteções de ENTRADA no nível HTTP completo (preparação desta rodada)', () => {
  it('rota diferente de /webhook-w-api: 404, mesmo com método/Content-Type corretos e payload válido', async () => {
    const resposta = await SELF.fetch(
      'https://exemplo-ficticio.invalido/qualquer-outra-rota',
      requisicao({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-rota-errada-001' })
    );
    expect(resposta.status).toBe(404);
  });

  it('Content-Type ausente: 415', async () => {
    const resposta = await SELF.fetch(URL_CALLBACK, {
      method: 'POST',
      body: JSON.stringify({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-sem-content-type-001' }),
    });
    expect(resposta.status).toBe(415);
  });

  it('Content-Encoding presente (gzip, mesmo que o corpo não esteja de fato comprimido): 415 — nunca tentamos descomprimir', async () => {
    const resposta = await SELF.fetch(
      URL_CALLBACK,
      requisicao({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-content-encoding-001' }, { 'content-encoding': 'gzip' })
    );
    expect(resposta.status).toBe(415);
  });

  it('corpo acima do limite REAL de tamanho (entregue via stream, sem Content-Length confiável): 413, nunca chega a tentar JSON.parse', async () => {
    const textoEnorme = 'x'.repeat(TAMANHO_MAXIMO_CORPO_BYTES + 1);
    const payloadEnorme = JSON.stringify({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-corpo-enorme-001', texto: textoEnorme });
    const bytes = new TextEncoder().encode(payloadEnorme);
    let indice = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const tamanhoPedaco = 4096;
        if (indice >= bytes.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(indice, indice + tamanhoPedaco));
        indice += tamanhoPedaco;
      },
    });
    const resposta = await SELF.fetch(URL_CALLBACK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect(resposta.status).toBe(413);
  });

  it('a resposta de erro NUNCA ecoa o conteúdo recebido (um "segredo" fictício no corpo malformado não aparece em lugar nenhum da resposta)', async () => {
    const segredoFicticioQueNuncaDeveriaAparecer = 'segredo-ficticio-worker-fetch-xyz789';
    const resposta = await SELF.fetch(URL_CALLBACK, requisicao(`{ "texto": "${segredoFicticioQueNuncaDeveriaAparecer}", isto quebra o JSON`));
    expect(resposta.status).toBe(400);
    const corpoDaResposta = await resposta.text();
    expect(corpoDaResposta).not.toContain(segredoFicticioQueNuncaDeveriaAparecer);
  });
});

describe('worker.ts fetch() — interruptor RECEPTOR_HABILITADO (preparação desta rodada)', () => {
  it('RECEPTOR_HABILITADO !== "true": 503 em QUALQUER requisição, mesmo uma mensagem fictícia válida — e NENHUM Durable Object é alocado', async () => {
    const { env: envDesabilitado, contagem } = envComContadorDeAlocacoesDO();
    envDesabilitado.RECEPTOR_HABILITADO = 'false';
    const requisicaoValida = requisicao({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-desabilitado-001' });

    const resposta = await workerPadrao.fetch(requisicaoValida, envDesabilitado);
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { resultado: string };
    expect(corpo.resultado).toBe('receptor_desabilitado');
    expect(contagem.chamadas).toBe(0);
  });

  it('RECEPTOR_HABILITADO ausente (undefined): também 503 — o default é DESLIGADO, nunca ligado por omissão', async () => {
    const { env: envSemAVar, contagem } = envComContadorDeAlocacoesDO();
    delete (envSemAVar as { RECEPTOR_HABILITADO?: string }).RECEPTOR_HABILITADO;
    const resposta = await workerPadrao.fetch(requisicao(PAYLOAD_TEXTO_PRIVADO_FICTICIO), envSemAVar);
    expect(resposta.status).toBe(503);
    expect(contagem.chamadas).toBe(0);
  });

  it('RECEPTOR_HABILITADO === "true": o interruptor deixa o receptor processar a requisição (confirma que o teste acima falha por causa do interruptor, não por outro erro qualquer) — mas a RESPOSTA final ainda é 503, porque autenticidade continua sem mecanismo verificado (correção desta rodada: nunca 2xx para conteúdo descartado)', async () => {
    const { env: envHabilitado } = envComContadorDeAlocacoesDO();
    envHabilitado.RECEPTOR_HABILITADO = 'true';
    const resposta = await workerPadrao.fetch(requisicao({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-habilitado-controle-001' }), envHabilitado);
    expect(resposta.status).toBe(503);
  });
});

describe('worker.ts fetch() — nenhum Durable Object é alocado para nenhuma mensagem não-elegível (proteção antiabuso desta rodada)', () => {
  it('uma mensagem de texto privado fictícia, válida em todo o resto, mas não-elegível (gate G1 fechado): 503 (nunca 2xx) recebido_nao_elegivel E ZERO alocações de Durable Object — não apenas "a aplicação continua nao_aplicado"', async () => {
    const { env: envComContador, contagem } = envComContadorDeAlocacoesDO();
    envComContador.RECEPTOR_HABILITADO = 'true';
    const resposta = await workerPadrao.fetch(
      requisicao({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: 'msg-worker-fetch-sem-alocacao-do-001' }),
      envComContador
    );
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { resultado: string };
    expect(corpo.resultado).toBe('recebido_nao_elegivel');
    expect(contagem.chamadas).toBe(0);
  });

  it('dez mensagens não-elegíveis diferentes em sequência: ainda ZERO alocações de Durable Object — não é um efeito de cache de uma única chamada', async () => {
    const { env: envComContador, contagem } = envComContadorDeAlocacoesDO();
    envComContador.RECEPTOR_HABILITADO = 'true';
    for (let i = 0; i < 10; i++) {
      const resposta = await workerPadrao.fetch(
        requisicao({ ...PAYLOAD_TEXTO_PRIVADO_FICTICIO, messageId: `msg-worker-fetch-sem-alocacao-do-multipla-${i}` }),
        envComContador
      );
      expect(resposta.status).toBe(503);
    }
    expect(contagem.chamadas).toBe(0);
  });
});

describe('fixture de smoke test do RUNBOOK (preparação desta rodada): o JSON empacotado é EXATAMENTE o payload bruto de webhook, nunca o objeto normalizado — e é testado de verdade pelo fetch()', () => {
  it('fixtures/smoke-teste-texto-privado.json é idêntico, campo a campo, a PAYLOAD_TEXTO_PRIVADO_FICTICIO (fixturesWebhookRecebido.ts) — nunca diverge do que o resto da suíte usa', () => {
    expect(fixtureSmokeTeste).toEqual(PAYLOAD_TEXTO_PRIVADO_FICTICIO);
  });

  it('POST exatamente com esse arquivo JSON (via fetch real, não um objeto normalizado construído à mão): 503, recebido_nao_elegivel — o mesmo resultado documentado no RUNBOOK.md para este smoke test', async () => {
    const resposta = await SELF.fetch(
      URL_CALLBACK,
      new Request(URL_CALLBACK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fixtureSmokeTeste),
      })
    );
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { resultado: string };
    expect(corpo.resultado).toBe('recebido_nao_elegivel');
  });
});
