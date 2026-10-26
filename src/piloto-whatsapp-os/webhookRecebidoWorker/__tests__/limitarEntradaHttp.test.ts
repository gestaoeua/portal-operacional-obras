// Testes das proteções de ENTRADA (`../limitarEntradaHttp.ts`), rodando no
// runtime real de Workers local (Miniflare). Cobrem especificamente o ponto
// corrigido nesta rodada: `request.text()` sem limite seguido de um teste
// de tamanho no resultado NÃO protege contra um corpo sem Content-Length
// (chunked) ou com Content-Length falso — por isso os testes aqui
// constroem requisições com corpos entregues como `ReadableStream`
// manualmente, em vez de confiar só numa string/Content-Length automático.
import { describe, expect, it } from 'vitest';
import {
  CAMINHO_ACEITO_CALLBACK,
  decodificarUtf8Estrito,
  lerCorpoComLimiteDeBytes,
  TAMANHO_MAXIMO_CORPO_BYTES,
  validarMetodoRotaFormato,
} from '../limitarEntradaHttp';

const URL_BASE = `https://exemplo-ficticio.invalido${CAMINHO_ACEITO_CALLBACK}`;

/** Um ReadableStream<Uint8Array> que entrega `pedacos` um a um — simula chunks de rede reais. */
function streamDePedacos(pedacos: Uint8Array[]): ReadableStream<Uint8Array> {
  let indice = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (indice >= pedacos.length) {
        controller.close();
        return;
      }
      controller.enqueue(pedacos[indice]);
      indice++;
    },
  });
}

/**
 * Um ReadableStream<Uint8Array> "infinito" (gera pedaços sem nunca
 * terminar por conta própria) que CONTA quantos pedaços foram
 * efetivamente puxados (`pull` chamado). Usado para provar que
 * `lerCorpoComLimiteDeBytes` CANCELA a leitura pouco depois de passar do
 * limite — se não cancelasse, o teste nunca terminaria (timeout), e a
 * contagem de pedaços puxados ficaria muito maior do que o necessário
 * para só passar do limite.
 */
function streamInfinitaComContagem(tamanhoPorPedaco: number): { stream: ReadableStream<Uint8Array>; contagem: { pedacosPuxados: number } } {
  const contagem = { pedacosPuxados: 0 };
  const pedaco = new Uint8Array(tamanhoPorPedaco).fill(120); // 'x'
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      contagem.pedacosPuxados++;
      controller.enqueue(pedaco);
    },
    cancel() {
      // Sem efeito adicional — só precisamos que `cancel()` exista e não lance.
    },
  });
  return { stream, contagem };
}

function requisicaoComCorpoStream(body: ReadableStream<Uint8Array> | string, cabecalhosExtra: Record<string, string> = {}): Request {
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cabecalhosExtra },
    body,
  };
  if (typeof body !== 'string') {
    init.duplex = 'half';
  }
  return new Request(URL_BASE, init);
}

describe('validarMetodoRotaFormato — método, rota, Content-Type, Content-Encoding (barato, sem I/O)', () => {
  it('método diferente de POST é rejeitado (405), com Allow: POST em cabecalhosExtras, e NUNCA ecoa o método recebido na mensagem', () => {
    const resultado = validarMetodoRotaFormato(new Request(URL_BASE, { method: 'GET' }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(405);
      expect(resultado.motivo).not.toContain('GET');
      expect(resultado.cabecalhosExtras).toEqual({ Allow: 'POST' });
    }
  });

  it('rota diferente da aceita é rejeitada (404), mesmo com método/Content-Type corretos', () => {
    const resultado = validarMetodoRotaFormato(
      new Request('https://exemplo-ficticio.invalido/outra-rota-qualquer', { method: 'POST', headers: { 'content-type': 'application/json' } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(404);
  });

  it('Content-Type ausente é rejeitado (415)', () => {
    const resultado = validarMetodoRotaFormato(new Request(URL_BASE, { method: 'POST' }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(415);
  });

  it('Content-Type diferente de application/json é rejeitado (415)', () => {
    const resultado = validarMetodoRotaFormato(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'text/plain' } }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(415);
  });

  it('Content-Type com parâmetro de charset (application/json; charset=utf-8) é aceito, case-insensitive no media type', () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'Application/JSON; charset=utf-8' } })
    );
    expect(resultado).toEqual({ ok: true });
  });

  it('Content-Type com charset entre aspas (charset="utf-8") é aceito', () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json; charset="utf-8"' } })
    );
    expect(resultado).toEqual({ ok: true });
  });

  it('Content-Type com charset em caixa alta (Charset=UTF-8) é aceito — comparação de charset é case-insensitive', () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json; Charset=UTF-8' } })
    );
    expect(resultado).toEqual({ ok: true });
  });

  it("MEDIA TYPE EXATO (correção desta rodada): 'application/jsonp' é REJEITADO — antes desta correção, startsWith('application/json') aceitava isto por engano (a string começa com o mesmo prefixo, mas é outro media type)", () => {
    const resultado = validarMetodoRotaFormato(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/jsonp' } }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(415);
  });

  it("MEDIA TYPE EXATO: 'application/json-malicioso' (subtipo diferente, mesmo prefixo de string) é REJEITADO", () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json-malicioso' } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(415);
  });

  it('charset diferente de utf-8 (ex.: iso-8859-1) é REJEITADO — o corpo é sempre decodificado como UTF-8 estrito, declarar outro charset seria uma mentira sobre o próprio corpo', () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json; charset=iso-8859-1' } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(415);
      // Nunca ecoa o charset recebido na mensagem de erro.
      expect(resultado.motivo).not.toContain('iso-8859-1');
    }
  });

  it('parâmetro de Content-Type diferente de charset (ex.: boundary) é REJEITADO explicitamente, nunca ignorado silenciosamente', () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json; boundary=qualquer-coisa' } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(415);
  });

  it('nome de parâmetro de Content-Type com um valor sentinela fictício (que poderia ser confundido com um segredo) nunca aparece na mensagem de erro', () => {
    const nomeParametroSentinela = 'sentinela_secreta_xyz987';
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': `application/json; ${nomeParametroSentinela}=1` } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(415);
      expect(resultado.motivo).not.toContain(nomeParametroSentinela);
    }
  });

  it('Content-Type malformado (ponto-e-vírgula sobrando sem parâmetro depois) é rejeitado', () => {
    const resultado = validarMetodoRotaFormato(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json;' } }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(415);
  });

  it('Content-Type malformado (parâmetro sem "=") é rejeitado', () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json; utf-8' } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(415);
  });

  it('Content-Encoding presente (gzip) é rejeitado (415) — nunca tentamos descomprimir nada, e o valor declarado nunca é ecoado na mensagem', () => {
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(415);
      expect(resultado.motivo).not.toContain('gzip');
    }
  });

  it('Content-Encoding com um valor sentinela fictício (que poderia ser confundido com um segredo) nunca aparece na mensagem de erro', () => {
    const segredoFicticio = 'segredo-ficticio-content-encoding-xyz987';
    const resultado = validarMetodoRotaFormato(
      new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': segredoFicticio } })
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).not.toContain(segredoFicticio);
  });

  it('requisição totalmente válida (método/rota/Content-Type, sem Content-Encoding) passa', () => {
    const resultado = validarMetodoRotaFormato(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json' } }));
    expect(resultado).toEqual({ ok: true });
  });
});

describe('lerCorpoComLimiteDeBytes — tamanho REAL do corpo, nunca confia em Content-Length', () => {
  it('corpo pequeno, dentro do limite: lido corretamente, byte a byte', async () => {
    const texto = 'corpo fictício pequeno de teste';
    const bytesEsperados = new TextEncoder().encode(texto);
    const requisicao = requisicaoComCorpoStream(streamDePedacos([bytesEsperados]));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, TAMANHO_MAXIMO_CORPO_BYTES);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(Array.from(resultado.bytes)).toEqual(Array.from(bytesEsperados));
  });

  it('corpo exatamente NO limite (limiteBytes bytes) é aceito — teste de fronteira', async () => {
    const limite = 1000;
    const bytes = new Uint8Array(limite).fill(65); // 'A' * 1000
    const requisicao = requisicaoComCorpoStream(streamDePedacos([bytes]));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, limite);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.bytes.byteLength).toBe(limite);
  });

  it('corpo com UM byte além do limite (limiteBytes + 1) é rejeitado — teste de fronteira', async () => {
    const limite = 1000;
    const bytes = new Uint8Array(limite + 1).fill(65);
    const requisicao = requisicaoComCorpoStream(streamDePedacos([bytes]));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, limite);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(413);
  });

  it('corpo entregue em MUITOS pedaços pequenos (chunks), somando exatamente o limite, é aceito — a contagem é por bytes reais acumulados, não por pedaço', async () => {
    const limite = 1000;
    const pedacos = Array.from({ length: 100 }, () => new Uint8Array(10).fill(66)); // 100 * 10 = 1000
    const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacos));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, limite);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.bytes.byteLength).toBe(limite);
  });

  it('SEM Content-Length (corpo entregue como stream, sem cabeçalho de tamanho): bytes reais acima do limite ainda são rejeitados', async () => {
    const limite = 500;
    const pedacos = Array.from({ length: 10 }, () => new Uint8Array(100).fill(67)); // 1000 bytes reais, sem Content-Length declarado
    const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacos));
    expect(requisicao.headers.get('content-length')).toBeNull();
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, limite);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(413);
  });

  it('Content-Length DECLARADO FALSO (pequeno), corpo REAL maior que o limite: a contagem real de bytes pega isso — Content-Length nunca é a única proteção', async () => {
    const limite = 500;
    const pedacos = Array.from({ length: 10 }, () => new Uint8Array(100).fill(68)); // 1000 bytes reais
    const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacos), { 'content-length': '10' }); // mentira: declara 10 bytes
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, limite);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(413);
  });

  it('corpo REALMENTE enorme (entrega "infinita") nunca termina de ser bufferizado: a leitura é CANCELADA logo após passar do limite — número de pedaços puxados fica próximo do mínimo necessário, nunca ilimitado', async () => {
    const limite = 1000;
    const tamanhoPorPedaco = 100;
    const { stream, contagem } = streamInfinitaComContagem(tamanhoPorPedaco);
    const requisicao = requisicaoComCorpoStream(stream);
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, limite);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(413);
    // Precisaria de pelo menos 11 pedaços (1100 bytes) para passar de 1000.
    // Se a leitura NÃO cancelasse, o stream "infinito" nunca pararia de
    // puxar — o fato de terminarmos o teste com uma contagem pequena e
    // finita já prova, por construção, que a leitura foi cancelada.
    expect(contagem.pedacosPuxados).toBeLessThan(50);
    expect(contagem.pedacosPuxados).toBeGreaterThanOrEqual(11);
  });

  it('Content-Length declarado já maior que o limite: rejeitado por atalho barato — nosso código nunca entra no laço de leitura (no máximo o único "pull" inicial que o próprio runtime faz ao montar a Request, nunca um dreno completo do stream)', async () => {
    const limite = 500;
    let contagemDePulls = 0;
    const streamQueNuncaDeveriaSerDrenado = new ReadableStream<Uint8Array>({
      pull(controller) {
        contagemDePulls++;
        // Um stream "infinito" de propósito: se o nosso laço de leitura
        // chegasse a rodar, isto nunca terminaria por conta própria — só
        // o atalho de Content-Length evita isso.
        controller.enqueue(new Uint8Array(10));
      },
    });
    const requisicao = requisicaoComCorpoStream(streamQueNuncaDeveriaSerDrenado, { 'content-length': '999999999' });
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, limite);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(413);
    // O runtime local pode puxar UM pedaço inicial sozinho ao montar a
    // Request (comportamento da plataforma, fora do nosso controle) — o
    // que importa é que o NOSSO código nunca dreno o stream "infinito"
    // (que exigiria uma contagem crescendo sem parar). Uma contagem baixa
    // e estável prova que paramos no atalho, sem iniciar o laço de leitura.
    expect(contagemDePulls).toBeLessThanOrEqual(1);
  });

  it('corpo ausente (request.body === null) é lido como vazio, nunca lança', async () => {
    const requisicao = new Request(URL_BASE, { method: 'GET' });
    expect(requisicao.body).toBeNull();
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, TAMANHO_MAXIMO_CORPO_BYTES);
    expect(resultado).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });
});

describe('lerCorpoComLimiteDeBytes — limites adicionais desta rodada: número de pedaços e prazo de leitura total (correção de revisão)', () => {
  it('EXATAMENTE no limite de pedaços é aceito — teste de fronteira', async () => {
    const limiteDePedacos = 5;
    const pedacos = Array.from({ length: limiteDePedacos }, () => new Uint8Array(10).fill(70));
    const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacos));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, 1_000_000, { limiteMaximoDePedacos: limiteDePedacos });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.bytes.byteLength).toBe(limiteDePedacos * 10);
  });

  it('UM pedaço além do limite de pedaços é rejeitado (413), mesmo que o total de bytes esteja bem abaixo do limite de bytes — teste de fronteira', async () => {
    const limiteDePedacos = 5;
    const pedacos = Array.from({ length: limiteDePedacos + 1 }, () => new Uint8Array(10).fill(71));
    const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacos));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, 1_000_000, { limiteMaximoDePedacos: limiteDePedacos });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(413);
  });

  it('MUITOS pedaços VAZIOS (byteLength === 0) — nunca avançam o total de bytes, mas são contidos pelo limite de pedaços (sem isto, o laço nunca pararia por conta própria)', async () => {
    const limiteDePedacos = 20;
    // 50 pedaços vazios: mais que o limite de pedaços, mas 0 bytes reais no
    // total — sem o limite de PEDAÇOS, isto nunca seria rejeitado pelo
    // limite de BYTES (que nunca avança).
    const pedacosVazios = Array.from({ length: 50 }, () => new Uint8Array(0));
    const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacosVazios));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, 1_000_000, { limiteMaximoDePedacos: limiteDePedacos });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(413);
      expect(resultado.motivo).toContain(`${limiteDePedacos} pedaços`);
    }
  });

  it('stream PARADO (nunca entrega outro pedaço, nunca sinaliza "done", nunca rejeita): o prazo máximo de leitura dispara, cancela e devolve 408 — sem isto, a leitura ficaria pendurada para sempre', async () => {
    let contagemDePulls = 0;
    const streamParado = new ReadableStream<Uint8Array>({
      start(controller) {
        // Entrega só o primeiro pedaço, nunca mais nada — simula uma
        // conexão aberta que simplesmente para de enviar dados.
        controller.enqueue(new Uint8Array(10).fill(72));
      },
      pull() {
        contagemDePulls++;
        // Nunca enqueue, nunca close — o próximo `read()` fica pendente
        // para sempre, de propósito.
      },
    });
    const requisicao = requisicaoComCorpoStream(streamParado);
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, 1_000_000, { prazoMaximoLeituraMs: 50 });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(408);
      expect(resultado.motivo).toMatch(/prazo/i);
    }
  });

  it('cancel() do stream NUNCA resolve (promise pendurada para sempre): a função ainda assim RETORNA (não fica pendurada além do prazo de cancelamento), com o erro de prazo excedido', async () => {
    const streamComCancelPendurado = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10).fill(73));
      },
      pull() {
        // Nunca entrega outro pedaço — igual ao teste de stream parado.
      },
      cancel() {
        // Devolve uma promise que NUNCA resolve nem rejeita — o pior caso
        // possível para `leitor.cancel()`.
        return new Promise<void>(() => {});
      },
    });
    const requisicao = requisicaoComCorpoStream(streamComCancelPendurado);
    const inicio = Date.now();
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, 1_000_000, { prazoMaximoLeituraMs: 50 });
    const duracaoMs = Date.now() - inicio;
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(408);
    // A função PRECISA retornar — mesmo com cancel() pendurado para sempre,
    // a duração total fica limitada (prazo de leitura + prazo de
    // cancelamento, nunca ilimitada). Margem generosa para não tornar o
    // teste frágil por variação de agendamento do runtime.
    expect(duracaoMs).toBeLessThan(5_000);
  });

  it('prazo de leitura NÃO É reiniciado a cada pedaço — pedaços legítimos entregues DENTRO do prazo continuam sendo aceitos normalmente (não é um teste de "tempo por pedaço", é tempo TOTAL)', async () => {
    const pedacos = Array.from({ length: 5 }, () => new Uint8Array(10).fill(74));
    const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacos));
    const resultado = await lerCorpoComLimiteDeBytes(requisicao, 1_000_000, { prazoMaximoLeituraMs: 5_000 });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.bytes.byteLength).toBe(50);
  });
});

describe('decodificarUtf8Estrito — Unicode correto, inválido rejeitado explicitamente, nunca ecoa dados crus', () => {
  it('texto com acentos e emoji decodifica corretamente', () => {
    const texto = 'ação, reunião às 14h — confirmado 🎉✅';
    const bytes = new TextEncoder().encode(texto);
    const resultado = decodificarUtf8Estrito(bytes);
    expect(resultado).toEqual({ ok: true, texto });
  });

  it('sequência de bytes UTF-8 inválida é rejeitada explicitamente (nunca um caractere de substituição silencioso)', () => {
    const bytesInvalidos = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
    const resultado = decodificarUtf8Estrito(bytesInvalidos);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toBe('corpo não é UTF-8 válido');
      // Nunca ecoa os bytes crus nem uma mensagem de erro específica do motor.
      expect(resultado.motivo).not.toMatch(/0xff|0xfe|byte|position|posição/i);
    }
  });

  it(
    'um caractere multi-byte (emoji, 4 bytes em UTF-8) PARTIDO exatamente na fronteira entre dois chunks de rede ainda decodifica corretamente — a decodificação só acontece DEPOIS de remontar todos os bytes, nunca pedaço a pedaço',
    async () => {
      const texto = 'início 🎉 fim'; // contém um emoji de 4 bytes UTF-8 no meio
      const bytesCompletos = new TextEncoder().encode(texto);
      // Entrega byte a byte (o pior caso possível de fronteira de chunk) —
      // garante que o emoji de 4 bytes seja necessariamente partido entre
      // pelo menos dois "pedaços de rede".
      const pedacos = Array.from(bytesCompletos, (b) => new Uint8Array([b]));
      const requisicao = requisicaoComCorpoStream(streamDePedacos(pedacos));

      const leitura = await lerCorpoComLimiteDeBytes(requisicao, TAMANHO_MAXIMO_CORPO_BYTES);
      expect(leitura.ok).toBe(true);
      if (!leitura.ok) return;

      const decodificacao = decodificarUtf8Estrito(leitura.bytes);
      expect(decodificacao).toEqual({ ok: true, texto });
    }
  );
});

describe('nenhum dado sensível/cru é ecoado pelas funções de validação de entrada', () => {
  it('um corpo malicioso/inválido (JSON quebrado contendo um segredo fictício) nunca aparece, nem em parte, no motivo de erro devolvido', async () => {
    const segredoFicticioQueNuncaDeveriaAparecer = 'segredo-ficticio-nao-deveria-aparecer-em-lugar-nenhum-xyz123';
    const corpoMalformado = `{ "texto": "${segredoFicticioQueNuncaDeveriaAparecer}", isto quebra o JSON aqui`;
    const bytes = new TextEncoder().encode(corpoMalformado);
    const requisicao = requisicaoComCorpoStream(streamDePedacos([bytes]));

    const leitura = await lerCorpoComLimiteDeBytes(requisicao, TAMANHO_MAXIMO_CORPO_BYTES);
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;

    const decodificacao = decodificarUtf8Estrito(leitura.bytes);
    // A decodificação em si funciona (é UTF-8 válido, só não é JSON válido —
    // isso é responsabilidade de JSON.parse em worker.ts, testado lá).
    expect(decodificacao.ok).toBe(true);
    if (decodificacao.ok) {
      expect(decodificacao.texto).toContain(segredoFicticioQueNuncaDeveriaAparecer);
    }

    // O que importa aqui: NENHUM motivo de erro das funções desta rodada
    // (Content-Type/Content-Encoding/tamanho) jamais inclui o texto — elas
    // nem chegam a ver o conteúdo, só o formato/tamanho.
    const validacaoDeFormato = validarMetodoRotaFormato(requisicao);
    expect(JSON.stringify(validacaoDeFormato)).not.toContain(segredoFicticioQueNuncaDeveriaAparecer);
  });
});
