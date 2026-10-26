// =============================================================================
// Proteções de ENTRADA do callback HTTP — rodam ANTES de qualquer alocação
// de Durable Object, ANTES do parse JSON, e ANTES de qualquer decisão de
// elegibilidade. Nada aqui decide autenticidade/elegibilidade (isso
// continua só em `../webhookRecebido/decidirIngestaoAutomatica.ts`, gate
// G1, inalterado) — este arquivo só reduz a superfície de ataque de quem
// pode nem chegar a essa decisão: método/rota/Content-Type/Content-Encoding
// errados, e sobretudo um CORPO REALMENTE grande demais, não um corpo que
// apenas DECLARA ser pequeno.
//
// PRINCÍPIO CENTRAL (ponto corrigido nesta rodada): `await request.text()`
// sem limite, seguido de um teste de tamanho no resultado, já bufferizou o
// corpo inteiro em memória antes de rejeitar qualquer coisa — um corpo sem
// `Content-Length` (chunked) ou com um `Content-Length` FALSO (menor do que
// o corpo real) passaria por esse teste sem proteção nenhuma durante a
// própria leitura. Por isso `lerCorpoComLimiteDeBytes` abaixo lê o stream
// `request.body` manualmente, pedaço a pedaço, contando bytes REAIS — e
// cancela a leitura no INSTANTE em que o total passa do limite, nunca
// terminando de bufferizar um corpo malicioso primeiro. Isto é testado com
// corpos sem Content-Length, com Content-Length mentindo (declarado
// pequeno, corpo real grande), e entregues em múltiplos pedaços pequenos
// (chunks) — ver `__tests__/limitarEntradaHttp.test.ts`.
//
// NENHUM dado sensível é ecoado: as funções abaixo devolvem só motivos
// GENÉRICOS, nunca o conteúdo bruto recebido (nem um fragmento dele) nem a
// mensagem de erro crua de `JSON.parse`/`TextDecoder` (que, dependendo do
// motor, pode conter um trecho do texto de entrada).
//
// O corpo bruto (bytes/texto decodificado) fica em memória só pelo tempo
// desta requisição — nunca é logado (`console.*`), nunca volta na resposta
// HTTP, nunca é persistido no Durable Object (só os campos já validados do
// rascunho, via `aplicarDecisaoIngestaoWorker.ts`, chegam lá — e isso só no
// caminho elegível, hoje inalcançável). Guardado "pelo tempo mínimo para uma
// futura verificação de assinatura" significa isto: os bytes crus existem
// como uma variável local desta função de fetch, descartados quando a
// requisição termina, nunca copiados para fora dela.

/** Caminho (pathname) aceito para o callback — qualquer outro é 404. Reduz a superfície de ataque (não é um endpoint "catch-all"). */
export const CAMINHO_ACEITO_CALLBACK = '/webhook-w-api';

/**
 * Limite REAL de tamanho do corpo, em bytes. Default conservador e
 * EXPLÍCITO (256 KiB) — generoso para um payload de texto de mensagem
 * W-API (JSON pequeno), mas bem abaixo de qualquer limite de
 * plataforma (ex.: o limite de valor de armazenamento do Durable Object
 * verificado numa rodada anterior, documentado e também testado
 * empiricamente — ver README.md). Este número é uma escolha conservadora
 * NOSSA, não um valor documentado pela W-API (que não publica um limite de
 * payload de callback nesta pesquisa) — Márcio pode ajustar depois de ver
 * o tamanho real de payloads de produção, se precisar.
 */
export const TAMANHO_MAXIMO_CORPO_BYTES = 262_144; // 256 KiB

/** Media type EXATO aceito (comparação case-insensitive) — nunca um prefixo. */
const MEDIA_TYPE_ACEITO = 'application/json';

/** Único charset aceito quando o parâmetro `charset` está presente — decodificamos sempre como UTF-8 estrito (ver `decodificarUtf8Estrito`), então qualquer outro valor declarado seria uma mentira sobre o próprio corpo. */
const CHARSET_ACEITO = 'utf-8';

export type ResultadoValidacaoEntrada = { ok: true } | { ok: false; status: number; motivo: string; cabecalhosExtras?: Record<string, string> };

/**
 * Valida o cabeçalho `Content-Type` por MEDIA TYPE EXATO, nunca por prefixo
 * de string (correção desta rodada: `startsWith('application/json')`
 * aceitava `application/jsonp` e `application/json-malicious`, porque as
 * duas strings realmente começam com o prefixo esperado — um media type
 * diferente, não um `application/json` com parâmetro extra). Faz um parse
 * mínimo mas correto do cabeçalho: tipo/subtipo antes do primeiro `;`,
 * parâmetros depois, cada um `nome=valor` (valor pode vir entre aspas).
 * Só o parâmetro `charset` é aceito, e só com o valor `utf-8` (o único que
 * `decodificarUtf8Estrito` realmente decodifica) — qualquer outro parâmetro,
 * ou um `charset` diferente, é rejeitado explicitamente, nunca ignorado
 * silenciosamente. Nenhum valor recebido é ecoado na mensagem de erro (só
 * motivos genéricos) — ver comentário de cabeçalho do arquivo.
 */
function validarContentTypeExato(valorCabecalho: string | null): { ok: true } | { ok: false; motivo: string } {
  if (valorCabecalho === null || valorCabecalho.trim() === '') {
    return { ok: false, motivo: `Content-Type ausente — esperado exatamente '${MEDIA_TYPE_ACEITO}', opcionalmente com ';charset=${CHARSET_ACEITO}'` };
  }

  const partes = valorCabecalho.split(';');
  const mediaType = (partes[0] ?? '').trim().toLowerCase();
  if (mediaType !== MEDIA_TYPE_ACEITO) {
    return { ok: false, motivo: `Content-Type não suportado — esperado exatamente '${MEDIA_TYPE_ACEITO}' (media type diferente, mesmo que comece com o mesmo prefixo, é rejeitado)` };
  }

  for (const parametroBruto of partes.slice(1)) {
    const parametro = parametroBruto.trim();
    if (parametro === '') {
      // `;` sobrando sem nenhum parâmetro depois (ex.: "application/json;")
      // — cabeçalho malformado, rejeitado explicitamente.
      return { ok: false, motivo: 'Content-Type malformado — parâmetro vazio após ponto-e-vírgula' };
    }
    const posicaoIgual = parametro.indexOf('=');
    if (posicaoIgual === -1) {
      return { ok: false, motivo: "Content-Type malformado — parâmetro sem 'nome=valor'" };
    }
    const nomeParametro = parametro.slice(0, posicaoIgual).trim().toLowerCase();
    let valorParametro = parametro.slice(posicaoIgual + 1).trim();
    if (valorParametro.startsWith('"') && valorParametro.endsWith('"') && valorParametro.length >= 2) {
      valorParametro = valorParametro.slice(1, -1);
    }
    if (nomeParametro !== 'charset') {
      // Mensagem inteiramente genérica — `nomeParametro` vem direto do
      // cabeçalho bruto (só minusculizado) e NUNCA deve ser ecoado na
      // resposta, mesmo truncado ou "limpo": um atacante pode colocar
      // qualquer valor ali (ex.: um segredo/sentinela) só para testar se é
      // refletido de volta. Ver teste sentinela em
      // `__tests__/limitarEntradaHttp.test.ts`.
      return { ok: false, motivo: "Content-Type malformado — parâmetro não suportado (só 'charset' é aceito)" };
    }
    if (valorParametro.toLowerCase() !== CHARSET_ACEITO) {
      return { ok: false, motivo: `Content-Type com charset não suportado — só '${CHARSET_ACEITO}' é aceito (o corpo é sempre decodificado como UTF-8 estrito)` };
    }
  }

  return { ok: true };
}

/**
 * Valida método, rota e cabeçalhos de FORMATO (Content-Type/Content-Encoding)
 * — tudo isto é barato (não lê o corpo, não aloca Durable Object) e roda
 * ANTES de qualquer I/O de verdade.
 */
export function validarMetodoRotaFormato(request: Request): ResultadoValidacaoEntrada {
  if (request.method !== 'POST') {
    // `Allow: POST` é exigido pelo HTTP para uma resposta 405 (RFC 9110
    // §15.5.6) — devolvido via `cabecalhosExtras` (worker.ts aplica isto na
    // resposta real). Mensagem genérica: `request.method` já é validado
    // pelo próprio runtime Fetch (só tokens HTTP válidos chegam aqui), não
    // é um valor arbitrário vindo do corpo/cabeçalho de terceiros.
    return { ok: false, status: 405, motivo: 'método não suportado — este endpoint só aceita POST', cabecalhosExtras: { Allow: 'POST' } };
  }

  let caminho: string;
  try {
    caminho = new URL(request.url).pathname;
  } catch {
    return { ok: false, status: 400, motivo: 'URL da requisição inválida' };
  }
  if (caminho !== CAMINHO_ACEITO_CALLBACK) {
    return { ok: false, status: 404, motivo: 'rota não encontrada' };
  }

  const validacaoContentType = validarContentTypeExato(request.headers.get('content-type'));
  if (!validacaoContentType.ok) {
    return { ok: false, status: 415, motivo: validacaoContentType.motivo };
  }

  // Content-Encoding: NENHUM é suportado (nunca descomprimimos o corpo) —
  // tratamos a presença de QUALQUER valor (gzip, deflate, br, etc.) como
  // não suportado, mesmo que o runtime um dia viesse a descomprimir
  // automaticamente por conta própria. Isto evita por completo a classe de
  // ataque de "bomba de descompressão" (um corpo comprimido pequeno que
  // expande para algo enorme) — nunca tentamos descomprimir nada aqui.
  // Mensagem GENÉRICA (correção desta rodada): o valor declarado pelo
  // cliente NUNCA é ecoado na resposta — é um dado de entrada não confiável,
  // e ecoá-lo não ajuda em nada quem está só tentando enviar um callback
  // válido.
  const codificacaoDeConteudo = request.headers.get('content-encoding');
  if (codificacaoDeConteudo !== null && codificacaoDeConteudo.trim() !== '') {
    return { ok: false, status: 415, motivo: 'Content-Encoding não suportado — nenhuma codificação de conteúdo é aceita neste endpoint (corpo precisa chegar sem compressão)' };
  }

  return { ok: true };
}

export type ResultadoLeituraCorpo = { ok: true; bytes: Uint8Array } | { ok: false; status: number; motivo: string };

/**
 * Número máximo de PEDAÇOS (chunks) que aceitamos do stream, mesmo que o
 * total de bytes nunca ultrapasse `limiteBytes` (correção desta rodada).
 * O limite de bytes por si só NÃO protege contra um remetente que entrega
 * o corpo em pedaços minúsculos (inclusive VAZIOS — `byteLength === 0`,
 * que nunca avançam `totalBytes`): cada pedaço custa uma entrada no array
 * `pedacos` e uma chamada de `leitor.read()`, então muitos pedaços
 * pequenos/vazios custam memória e CPU de forma desproporcional ao volume
 * de bytes real, sem nunca disparar a rejeição por tamanho. 10.000 pedaços
 * é generoso para qualquer tráfego real — mas não cobre qualquer entrega
 * patológica: um corpo de até 256 KiB (`TAMANHO_MAXIMO_CORPO_BYTES`)
 * entregue em pedaços de 1 byte geraria 262.144 pedaços, cerca de 26x
 * ACIMA deste limite (não uma fração dele), e por isso seria rejeitado por
 * `LIMITE_MAXIMO_DE_PEDACOS` bem antes de completar a leitura — esse é
 * justamente o cenário que este limite existe para cobrir. NÃO é um teto
 * documentado pela plataforma — é uma escolha conservadora nossa, testada
 * explicitamente (ver `__tests__/limitarEntradaHttp.test.ts`, "muitos
 * pedaços pequenos/vazios").
 */
export const LIMITE_MAXIMO_DE_PEDACOS = 10_000;

/**
 * Prazo máximo (ms) para a leitura COMPLETA do corpo, do primeiro ao
 * último pedaço — não um prazo por pedaço individual. Protege contra um
 * stream que PARA de entregar dados (conexão aberta, nenhum pedaço novo
 * chega nunca) sem nunca sinalizar `done` nem ultrapassar o limite de
 * bytes: sem este prazo, `leitor.read()` ficaria pendurado para sempre e a
 * resposta do Worker nunca seria enviada. Não é uma garantia de latência
 * de produção (não medimos rede real aqui) — é um teto de tempo testado
 * diretamente contra um stream controlável que nunca resolve por conta
 * própria (ver "stream parado"/"cancel que não resolve" nos testes).
 */
export const PRAZO_MAXIMO_LEITURA_MS = 10_000;

/**
 * Prazo máximo (ms) para `leitor.cancel()` em si. `cancel()` também é uma
 * promise, e nada garante que ela resolve rápido (ou resolve, mesmo) para
 * um stream mal-comportado — por isso NUNCA fazemos um `await` simples
 * dela: corremos `cancel()` contra este prazo e seguimos adiante de
 * qualquer jeito, para que um `cancel()` pendurado nunca atrase a
 * resposta de erro que o chamador está esperando.
 */
const PRAZO_CANCELAMENTO_MS = 1_000;

/** Promise que resolve (nunca rejeita) depois de `ms` milissegundos, com o valor `sinal` — usada só para corridas (`Promise.race`) com uma operação que pode nunca resolver por conta própria. */
function prazoComSinal<T>(ms: number, sinal: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(sinal), ms));
}

/**
 * Cancela o leitor SEM BLOQUEAR além de `PRAZO_CANCELAMENTO_MS` — nunca um
 * `await leitor.cancel()` simples, que poderia pendurar a resposta de erro
 * indefinidamente se o stream nunca resolver o cancelamento. Melhor
 * esforço: se `cancel()` rejeitar ou nunca resolver dentro do prazo,
 * seguimos adiante mesmo assim — o importante é que já paramos de
 * acumular bytes/pedaços e vamos devolver erro de qualquer forma.
 */
async function cancelarSemBloquear(leitor: ReadableStreamDefaultReader<Uint8Array>, motivo: string): Promise<void> {
  try {
    await Promise.race([leitor.cancel(motivo), prazoComSinal(PRAZO_CANCELAMENTO_MS, undefined)]);
  } catch {
    // Melhor esforço — nunca propaga.
  }
}

/**
 * Lê `request.body` (um `ReadableStream<Uint8Array>`) manualmente, pedaço a
 * pedaço, contando bytes REAIS conforme chegam — nunca confiando em
 * `Content-Length` (que pode estar ausente, por exemplo com
 * `Transfer-Encoding: chunked`, ou simplesmente mentir). No instante em que
 * o total ultrapassa `limiteBytes`, CANCELA a leitura do stream (nunca
 * termina de bufferizar o resto de um corpo malicioso) e devolve erro.
 * Além do limite de bytes, dois outros limites rodam em paralelo
 * (correção desta rodada, ver constantes acima): um número MÁXIMO de
 * pedaços (protege contra muitos pedaços pequenos/vazios que nunca
 * avançam o total de bytes) e um PRAZO MÁXIMO de tempo total de leitura
 * (protege contra um stream que simplesmente para de entregar dados sem
 * nunca sinalizar `done`). Nenhum dos dois afirma um teto absoluto de uso
 * de memória ANTES da entrega de um pedaço pelo runtime — o tamanho de
 * cada pedaço individual é decidido pelo runtime (buffer de rede
 * subjacente), não por este código; o que limitamos é quantos pedaços e
 * por quanto tempo total aceitamos, nunca o tamanho que o runtime decide
 * entregar de uma vez.
 *
 * Um `Content-Length` declarado, quando presente E já maior que o limite,
 * é usado só como um atalho BARATO para rejeitar sem nem começar a ler o
 * stream — nunca como a única proteção (um valor declarado pequeno mas
 * falso não escapa, porque a contagem real abaixo pega isso de qualquer
 * jeito).
 *
 * `opcoes` existe só para os TESTES desta rodada conseguirem exercitar o
 * prazo de tempo e o limite de pedaços em segundos/contagens pequenas e
 * determinísticas, em vez de esperar os valores reais de produção
 * (`PRAZO_MAXIMO_LEITURA_MS`/`LIMITE_MAXIMO_DE_PEDACOS`) a cada execução —
 * `worker.ts` (caminho de produção) nunca passa `opcoes`, então sempre usa
 * os defaults reais.
 */
export async function lerCorpoComLimiteDeBytes(
  request: Request,
  limiteBytes: number,
  opcoes?: { prazoMaximoLeituraMs?: number; limiteMaximoDePedacos?: number }
): Promise<ResultadoLeituraCorpo> {
  const prazoMaximoLeituraMs = opcoes?.prazoMaximoLeituraMs ?? PRAZO_MAXIMO_LEITURA_MS;
  const limiteMaximoDePedacos = opcoes?.limiteMaximoDePedacos ?? LIMITE_MAXIMO_DE_PEDACOS;

  const comprimentoDeclarado = request.headers.get('content-length');
  if (comprimentoDeclarado !== null) {
    const valor = Number(comprimentoDeclarado);
    if (Number.isFinite(valor) && valor > limiteBytes) {
      return { ok: false, status: 413, motivo: `corpo declarado (${valor} bytes) excede o limite máximo de ${limiteBytes} bytes` };
    }
  }

  if (request.body === null) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  const leitor = request.body.getReader();
  const pedacos: Uint8Array[] = [];
  let totalBytes = 0;
  let totalPedacos = 0;

  // UM ÚNICO timer para o prazo de leitura COMPLETA (nunca recriado a cada
  // iteração) — corremos cada `leitor.read()` contra esta MESMA promise, e
  // a limpamos (`clearTimeout`) em todo caminho de saída, para nunca deixar
  // um timer pendurado depois que esta função termina.
  let idDoPrazo: ReturnType<typeof setTimeout> | undefined;
  const prazoDeLeituraTotal = new Promise<'prazo_excedido'>((resolve) => {
    idDoPrazo = setTimeout(() => resolve('prazo_excedido'), prazoMaximoLeituraMs);
  });
  const limparPrazo = () => {
    if (idDoPrazo !== undefined) clearTimeout(idDoPrazo);
  };

  while (true) {
    let resultadoOuPrazoExcedido: ReadableStreamReadResult<Uint8Array> | 'prazo_excedido';
    try {
      resultadoOuPrazoExcedido = await Promise.race([leitor.read(), prazoDeLeituraTotal]);
    } catch {
      limparPrazo();
      // Mensagem GENÉRICA (correção desta rodada) — nunca ecoa `erro.name`
      // nem `erro.message`, que poderiam variar por motor/runtime e
      // revelar detalhes internos sem necessidade nenhuma para quem só quer
      // saber que a leitura falhou.
      return { ok: false, status: 400, motivo: 'falha ao ler o corpo da requisição' };
    }

    if (resultadoOuPrazoExcedido === 'prazo_excedido') {
      // Nunca precisa de `limparPrazo()` aqui — o próprio timer já disparou.
      // `cancelarSemBloquear` nunca deixa isto pendurar a resposta além de
      // PRAZO_CANCELAMENTO_MS, mesmo se o stream nunca resolver o cancelamento.
      await cancelarSemBloquear(leitor, 'prazo máximo de leitura do corpo excedido');
      return { ok: false, status: 408, motivo: 'leitura do corpo da requisição excedeu o prazo máximo permitido' };
    }

    const resultado = resultadoOuPrazoExcedido;
    if (resultado.done) {
      limparPrazo();
      break;
    }

    // Verificado SÓ AGORA (depois de confirmar que há mesmo mais um
    // pedaço, não antes) — um corpo com EXATAMENTE `limiteMaximoDePedacos`
    // pedaços precisa continuar aceito; é o pedaço ALÉM do limite que é
    // rejeitado, nunca uma leitura extra "especulativa" de um stream que já
    // teria terminado.
    if (totalPedacos + 1 > limiteMaximoDePedacos) {
      limparPrazo();
      await cancelarSemBloquear(leitor, 'corpo excede o número máximo de pedaços permitido');
      return { ok: false, status: 413, motivo: `corpo excede o número máximo de ${limiteMaximoDePedacos} pedaços permitidos` };
    }

    totalPedacos++;
    totalBytes += resultado.value.byteLength;
    if (totalBytes > limiteBytes) {
      // Cancela IMEDIATAMENTE — nunca terminamos de bufferizar o resto de
      // um corpo maior do que o permitido, não importa o que
      // Content-Length tenha declarado (ou a ausência dele).
      limparPrazo();
      await cancelarSemBloquear(leitor, 'corpo excede o limite máximo permitido');
      return { ok: false, status: 413, motivo: `corpo excede o limite máximo de ${limiteBytes} bytes` };
    }
    pedacos.push(resultado.value);
  }

  const bytesCompletos = new Uint8Array(totalBytes);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytesCompletos.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }
  return { ok: true, bytes: bytesCompletos };
}

export type ResultadoDecodificacaoUtf8 = { ok: true; texto: string } | { ok: false; motivo: string };

/**
 * Decodifica bytes como UTF-8 ESTRITO (`fatal: true` — uma sequência de
 * bytes inválida vira erro explícito, nunca um caractere de substituição
 * silencioso "�" que corromperia o conteúdo sem avisar). Feito numa ÚNICA
 * chamada sobre o buffer COMPLETO já remontado por
 * `lerCorpoComLimiteDeBytes` — nunca pedaço a pedaço — para que um
 * caractere multi-byte (ex.: emoji, acentos) partido exatamente na
 * fronteira entre dois pedaços de rede nunca seja decodificado errado (ver
 * teste de Unicode partido em múltiplos chunks).
 */
export function decodificarUtf8Estrito(bytes: Uint8Array): ResultadoDecodificacaoUtf8 {
  try {
    const texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    return { ok: true, texto };
  } catch {
    // Nunca inclui o erro bruto do decoder (poderia, dependendo do motor,
    // referenciar a posição/trecho do byte inválido) — motivo genérico.
    return { ok: false, motivo: 'corpo não é UTF-8 válido' };
  }
}
