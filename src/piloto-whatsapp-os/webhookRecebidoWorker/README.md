# Adaptação Cloudflare Workers + Durable Objects (SQLite) — teste local, NUNCA implantado

> ## ⚠️ NÃO PRONTO PARA RECEBER DADOS REAIS
> Autenticação do callback W-API continua SEM mecanismo verificado (gate G1
> fail-closed), a política de retenção/limpeza de deduplicação não foi
> decidida, e nenhuma implantação foi autorizada — ver RUNBOOK.md para os
> bloqueios completos e o checklist de ativação. Nada neste documento deve
> ser lido como "pronto para produção".

Subpacote NPM **isolado** (`package.json`/`package-lock.json`/`node_modules`
próprios, separados da raiz do repositório) que adapta a store de
deduplicação do piloto webhook W-API (`../webhookRecebido/armazenamentoDurabilidadeOffline.ts`,
baseada em arquivo JSON local) para **Cloudflare Workers + Durable Objects
com armazenamento SQLite**, e testa essa adaptação **inteiramente no
runtime local** (`workerd`/Miniflare, via `@cloudflare/vitest-plugin`).

**Nada foi implantado nesta rodada.** Nenhuma conta Cloudflare foi usada,
nenhum `wrangler login`, nenhum `wrangler deploy`. A conta já havia sido
conferida separadamente pelo Márcio antes desta rodada — este trabalho não
usou o painel nem repetiu essa consulta.

## Por que um subpacote isolado (node_modules/lockfile próprios)

A raiz do repositório roda sua suíte com `vitest@1.6.1` (via Vite). O
`@cloudflare/vitest-plugin` (pacote oficial atual — o antigo
`@cloudflare/vitest-pool-workers` está **deprecado**, ver fontes abaixo)
exige `vitest@^4.1.0 || ^5.0.0`, incompatível com a raiz. Por isso este
subdiretório tem seu próprio `package.json`/`package-lock.json`/`node_modules`,
nunca os da raiz — a raiz continua em `vitest@1.6.1`, sem nenhuma alteração.

Três mudanças foram feitas fora deste subdiretório, estritamente de
**isolamento mecânico** (nenhuma mudança de comportamento pretendida para o
resto do repositório — R3, `apps-script/`, `demo-os-cronograma/` continuam
intocados):
- `tsconfig.json`: `"exclude": ["src/piloto-whatsapp-os/webhookRecebidoWorker"]`
  — sem isso, o `worker-configuration.d.ts` gerado (tipos ambiente globais do
  runtime de Workers) colidia com os tipos DOM do resto do app no `tsc` da
  raiz (erros em arquivos não relacionados, ex. `fieldApi.ts`).
- `vite.config.ts`: `test.exclude` acrescido com este subdiretório — sem
  isso, o `vitest` da raiz tentava rodar os testes daqui (que dependem de
  `cloudflare:test`, só existente dentro do runtime de Workers) e falhava.
  **Correção de uma revisão independente final**: a primeira versão deste
  ajuste definia `test.exclude` com um array próprio, o que na verdade
  **substitui** (não complementa) os defaults do Vitest
  (`configDefaults.exclude` — node_modules, dist, cypress, .git/.cache,
  arquivos de config na raiz) — ao contrário do que o comentário de então
  afirmava. Corrigido para espalhar `...configDefaults.exclude` (importado
  de `'vitest/config'`) e só então acrescentar este subdiretório — nenhum
  padrão real de exclusão do resto do repositório é perdido.
- `src/piloto-whatsapp-os/__tests__/semDadosReais.test.ts` (dentro do
  próprio módulo do piloto, não da raiz do repositório, mas também não
  nasceu com esta rodada — é o scanner de sanitização já existente desde o
  R3): passou a ignorar `node_modules/` (terceiros) e, numa correção
  posterior desta MESMA rodada, deixou de ignorar `.d.ts` por EXTENSÃO
  (amplo demais — ignoraria também um `.d.ts` escrito à mão, se um dia
  existisse) e passou a ignorar só o arquivo GERADO específico
  (`webhookRecebidoWorker/worker-configuration.d.ts`) por caminho exato.

Confirmado depois do ajuste: suíte da raiz **220/220** (inalterada), `tsc`
da raiz limpo, `npm run build` da raiz limpo — ver relatório desta rodada.

## Desenho

- `worker.ts` — `fetch(Request)`: reaproveita **sem alterar**
  `processarWebhookRecebido` → `decidirIngestaoAutomatica` (ambos
  importados de `../webhookRecebido/`, portáveis — não usam `node:fs`).
  Ordem deliberada (preparação desta rodada — ver seção dedicada abaixo):
  interruptor local `RECEPTOR_HABILITADO` → `validarMetodoRotaFormato` →
  `lerCorpoComLimiteDeBytes` → `decodificarUtf8Estrito` → `JSON.parse` →
  pipeline existente. O corpo cru fica em memória só durante a própria
  chamada de `fetch` (nunca logado, nunca devolvido, nunca persistido) —
  nunca lido como `request.text()`/`request.json()` sem limite. Cabeçalhos
  são só OBSERVADOS (a resposta devolve apenas a CONTAGEM deles, nunca os
  valores, que poderiam conter algo sensível).
- `limitarEntradaHttp.ts` — proteções de ENTRADA (preparação desta rodada):
  `validarMetodoRotaFormato` (método/rota/Content-Type/Content-Encoding,
  barato, sem I/O) e `lerCorpoComLimiteDeBytes` (tamanho REAL do corpo,
  lendo `request.body` manualmente e contando bytes conforme chegam — nunca
  confiando em `Content-Length`, que pode estar ausente ou mentir — e
  cancelando a leitura no instante em que o limite é excedido) e
  `decodificarUtf8Estrito` (decodificação UTF-8 estrita, de uma só vez sobre
  o buffer completo, nunca pedaço a pedaço). Ver seção dedicada abaixo.
- `aplicarDecisaoIngestaoWorker.ts` — equivalente assíncrono de
  `../webhookRecebido/aplicadorDeRascunhosWebhook.ts`: mesma disciplina de
  gate (nunca decide elegibilidade sozinho). **Antiabuso por ordenação**
  (preparação desta rodada): o ramo não-elegível (gate G1 fechado — hoje
  100% do tráfego) rejeita **antes** de qualquer tentativa de obter um stub
  do Durable Object — nenhuma alocação, nenhuma gravação, nenhum "sucesso de
  ingestão" para algo já descartado. Ver seção dedicada abaixo.
- `durableObjectDedup.ts` — o Durable Object (`DedupDurableObject`,
  armazenamento SQLite). **Desenho de roteamento**: cada instância
  corresponde a exatamente UMA chave composta `instanceId` + `messageId` —
  é quem chama (`worker.ts`) que calcula
  `env.DEDUP_DO.idFromName(codificarChaveCompostaDedup(instanceId, messageId))`
  antes de obter o stub (ver `chaveCompostaDedup.ts` abaixo). A
  deduplicação atômica nasce do ROTEAMENTO + do fato de que a
  leitura+escrita acontece dentro de **uma única chamada RPC**
  (`registrarAplicacaoSeNaoDuplicado`), sem nenhum `await` alheio entre elas
  — ver comentário de cabeçalho do arquivo e "Fontes" abaixo. **Retenção/
  limpeza** (preparação desta rodada, ver seção dedicada abaixo): cada
  registro grava seu próprio `armazenadoEmUnixMs` (relógio deste servidor,
  nunca o `momentoUnix` do remetente); `limparRegistrosMaisAntigosQue` é um
  PRIMITIVO testado, nunca chamado por nenhum caminho de produção.
- `chaveCompostaDedup.ts` — **correção de uma revisão independente desta
  rodada**: a codificação original do roteamento era
  `` `${instanceId}::${messageId}` `` (concatenação com delimitador fixo),
  que é AMBÍGUA — `('a::b', 'c')` e `('a', 'b::c')` produzem a mesma string
  `'a::b::c'` e endereçariam o MESMO Durable Object. A função única deste
  arquivo, `codificarChaveCompostaDedup`, usa `JSON.stringify([instanceId,
  messageId])` em vez disso (sem essa ambiguidade — ver o teste de colisão
  do delimitador abaixo) e é usada tanto por `worker.ts` (produção) quanto
  pelos testes, de propósito: um teste que recalculasse a chave à sua
  própria maneira não provaria nada sobre produção.
- `fixtures/smoke-teste-texto-privado.json` — a MESMA fixture usada em
  `__tests__/workerFetch.test.ts` (`PAYLOAD_TEXTO_PRIVADO_FICTICIO`),
  empacotada como arquivo para os smoke tests manuais do RUNBOOK.md — um
  teste confirma que o arquivo nunca diverge da fixture TypeScript que ele
  representa.

## Preparação de implantação desta rodada (pacote revisável — ver RUNBOOK.md)

Esta rodada é uma etapa LIMITADA sobre o Worker já revisado/testado —
**não é autorização de produção**. Autenticação real da W-API continua SEM
mecanismo verificado; o gate G1 continua fail-closed, e nada aqui inventa
assinatura/header/segredo de fornecedor nem abre bypass por
query/header/env. O objetivo é deixar um pacote offline, revisável,
pendente só de: autenticação verificada, decisões de política (retenção) e
aprovações de implantação — ver checklist final em RUNBOOK.md.

### 1) Limitar entrada (`limitarEntradaHttp.ts`)

Protege contra corpo grande demais, formato inesperado e dados sensíveis
ecoados — **antes** de qualquer alocação de Durable Object ou gravação:
- Método/rota/Content-Type/Content-Encoding verificados primeiro (barato,
  sem I/O) — `validarMetodoRotaFormato`.
- Tamanho REAL do corpo em bytes, contado conforme o stream chega — nunca
  confiando em `Content-Length` (ausente em corpos chunked, ou declarado
  menor que o real) — `lerCorpoComLimiteDeBytes`. Cancela a leitura do
  stream no INSTANTE em que o total excede o limite (256 KiB, escolha
  conservadora nossa — ver comentário no arquivo —, nunca um valor
  documentado pela W-API, que não publica um limite de payload de
  callback). Testado com: corpo exatamente no limite e limite+1; entrega em
  múltiplos chunks pequenos; sem `Content-Length`; `Content-Length`
  declarado falso (menor que o real); "stream infinito" provando
  cancelamento antecipado (nunca termina de bufferizar um corpo malicioso).
- Decodificação UTF-8 ESTRITA (`fatal: true`) numa única chamada sobre o
  buffer completo (nunca pedaço a pedaço, para não corromper um caractere
  multi-byte partido na fronteira de dois chunks de rede) — testado com
  Unicode/emoji válidos (inclusive partidos byte a byte entre chunks) e
  sequências de bytes inválidas.
- Nenhum dado sensível é ecoado: motivos de erro são sempre genéricos,
  nunca o conteúdo bruto nem o erro cru do decoder/`JSON.parse` — testado
  com um segredo fictício plantado no corpo, confirmando que nunca aparece
  na resposta. O corpo bruto fica em memória só durante a própria chamada
  de `fetch` (nunca logado/devolvido/persistido).
- **Ponto corrigido nesta rodada**: a abordagem anterior (`request.text()`
  sem limite, seguido de teste de tamanho no resultado) já teria
  bufferizado o corpo inteiro antes de rejeitar qualquer coisa — sem
  proteção real contra um corpo sem `Content-Length` ou com um valor
  falso. A leitura manual do stream, byte a byte, com cancelamento
  antecipado, é o que resolve isso.

### 2) Antiabuso por ordenação (`worker.ts` + `aplicarDecisaoIngestaoWorker.ts`)

Nenhuma alocação de Durable Object acontece para uma mensagem que o gate
G1 já descartou como não-elegível — hoje isso é **100% do tráfego real**,
já que `decidirIngestaoAutomatica.ts` não tem nenhum caminho de código que
devolva `elegivel: true`. O interruptor local `RECEPTOR_HABILITADO`
(`wrangler.jsonc`, var em texto plano — nunca secret) rejeita tudo ANTES
de ler o corpo ou olhar a rota, quando desligado (default: desligado —
qualquer valor diferente de `"true"`, incluindo ausência, resulta em 503).
Prova direta (não inferida de estado) via um `DurableObjectNamespace` real
envolvido num `Proxy` que conta chamadas de `idFromName`/`get` por
passthrough — nunca altera o comportamento, só observa: zero alocações
para uma mensagem não-elegível, e zero para dez mensagens não-elegíveis em
sequência. Controles antiabuso aqui são estritamente LOCAIS (ordenação de
código, interruptor local) — nenhum serviço novo foi adicionado, e nenhuma
afirmação de rate-limit GLOBAL é feita (isso dependeria de infraestrutura
de produção — ver RUNBOOK.md).

### 3) Retenção/limpeza testável (`durableObjectDedup.ts`)

Cada registro (observação não-elegível e aplicação efetiva) grava seu
próprio `armazenadoEmUnixMs` — o relógio DESTE servidor no momento da
escrita, nunca o `momentoUnix` do remetente (forjável). O método
`limparRegistrosMaisAntigosQue(horizonteMs, agora?)` é um **PRIMITIVO
testado, nunca chamado por nenhum caminho de produção** (guarda estrutural
em `semBackendRealWorker.test.ts` confirma que nem `worker.ts` nem
`aplicarDecisaoIngestaoWorker.ts` o referenciam).

**Efeito documentado, não escondido**: apagar o registro de aplicação
efetiva de um `messageId` cujo horizonte já passou faz com que um REPLAY
futuro daquele mesmo `messageId` seja tratado como mensagem NOVA — a
proteção de deduplicação é perdida para aquele registro específico. Isto é
testado explicitamente em `dedupDurableObject.test.ts` (bloco "retenção/
limpeza"): registro recente não é tocado; registro antigo é removido e o
replay seguinte aplica como se fosse novo (nunca "duplicado"); o mesmo vale
para a observação não-elegível, isolada da chave de aplicação.

**Decisão pendente, declarada e não inventada aqui**: qual horizonte de
retenção é seguro depende da janela real de reentrega/retry da W-API, que
esta pesquisa não encontrou documentada publicamente. Por isso nenhuma
política de retenção ativa foi implementada — o primitivo existe pronto
para quando essa decisão for tomada (ver checklist em RUNBOOK.md), mas o
default seguro continua sendo NUNCA apagar registros reais de
deduplicação até essa janela ser confirmada com o fornecedor/contrato.

## Comandos exatos (reprodução)

```bash
cd src/piloto-whatsapp-os/webhookRecebidoWorker
npm ci                                # instala EXATAMENTE as versões do package-lock.json incluído
                                       # (reprodutível — nunca resolve versões novas, ao contrário de
                                       # `npm install`); neste node_modules isolado, nunca o da raiz

npm run typecheck                    # gera worker-configuration.d.ts (wrangler types) + tsc --noEmit
npm test                             # roda os dois conjuntos (ver abaixo), nenhuma conta/login/deploy
```

`package-lock.json` está incluído no ZIP/patch desta rodada (correção —
rodadas anteriores o excluíam) exatamente para que `npm ci` funcione sem
precisar resolver versões de novo; se `node_modules/` já existir de uma
instalação anterior, pode apagá-lo antes (`rm -rf node_modules`) para uma
reprodução realmente limpa.

`npm test` executa, em sequência:
1. `vitest run --config vitest.config.ts` — testes reais dentro do runtime
   de Workers local (`dedupDurableObject.test.ts`, `workerFetch.test.ts`,
   `limitarEntradaHttp.test.ts`).
2. `vitest run --config vitest.guard.config.ts` — guarda estrutural em Node
   puro (`semBackendRealWorker.test.ts`; não roda no runtime de Workers
   porque lê arquivos com `node:fs`).

Variável `WRANGLER_SEND_METRICS=false` (já embutida nos scripts
`pretest`/`pretypecheck` do `package.json`) desliga o telemetry beacon do
Wrangler — a única chamada de rede que o Wrangler tentaria fazer sozinho;
sem essa variável, `wrangler types` tenta alcançar `sparrow.cloudflare.com`
e falha no sandbox desta sessão (proxy de egress bloqueia o host) — **nenhuma
conta é necessária para isso funcionar**, é só telemetria anônima, mas foi
desligada de propósito para manter a rodada 100% offline mesmo nesse detalhe.

**Resultado real, executado agora (rodada de correções de segurança — ver também RUNBOOK.md):**

| Comando | Resultado |
|---|---|
| `npm run typecheck` (este subpacote) | limpo |
| `vitest run --config vitest.config.ts` | **79/79** (3 arquivos), dentro do runtime real de Workers |
| `vitest run --config vitest.guard.config.ts` | **19/19** |
| Suíte da raiz (`cd ../../.. && npx vitest run`) | **220/220**, inalterada |
| `tsc --noEmit` da raiz | limpo |
| `GITHUB_REPOSITORY=gestaoeua/portal-operacional-obras npm run build` (raiz) | limpo |
| Suíte da raiz rerodada contra esse build real | **220/220**, limpo |
| `wrangler deploy --dry-run` (sem login, sem conta) | executado com sucesso — ver saída real em RUNBOOK.md §2; `--dry-run` sai antes de publicar qualquer coisa |
| `git status --porcelain` | só `src/piloto-whatsapp-os/` (novo/não rastreado) + as duas exceções pré-existentes de isolamento (`tsconfig.json`/`vite.config.ts`) — nada comitado/enviado; `dist/` gerado pelo build está no `.gitignore` |

Os números acima refletem a rodada atual de correções (não-2xx para conteúdo
descartado, parsing exato de media type/charset, leitura de stream com
limites de pedaços/prazo total, `RECEPTOR_HABILITADO=false` na config
distribuída, fixture de smoke test real derivada de
`fixturesWebhookRecebido.ts`). O ZIP/patch entregue agora inclui
`package-lock.json` (para `npm ci` reprodutível) e `fixtures/` (fixture JSON
de smoke test), que antes não estavam incluídos.

**Rodada mecânica seguinte (correções pontuais, sem nova implementação):**
o nome do parâmetro de `Content-Type` não suportado (`nomeParametro`) ainda
era ecoado na mensagem de erro — corrigido para mensagem inteiramente
genérica, com teste sentinela cobrindo o caso (`+1` teste em
`vitest.config.ts`, `+1` guarda estrutural em `vitest.guard.config.ts`,
daí 79/79 e 19/19 acima). O comentário sobre `LIMITE_MAXIMO_DE_PEDACOS`
tinha a matemática invertida (um corpo de 256 KiB em pedaços de 1 byte
geraria 262.144 pedaços — ~26x ACIMA do limite de 10.000, não "26% dele") —
corrigido só o comentário, o limite em si não mudou. A frase da seção 3 do
RUNBOOK que ainda descrevia `wrangler.jsonc` com `RECEPTOR_HABILITADO:
"true"` foi corrigida para refletir o estado real (config distribuída em
`"false"`, override `"true"` só em `vitest.config.ts`).

## O que cada teste prova, e o que NÃO prova

- **Identidade de roteamento sem ambiguidade** (`dedupDurableObject.test.ts`,
  "identidade de roteamento" — correção de uma revisão independente desta
  rodada): três casos reais contra o runtime: (1) mesmo `messageId`,
  `instanceId` diferente → Durable Objects diferentes; (2) mesma
  `instanceId`, `messageId` diferente → Durable Objects diferentes; (3) o
  **caso de colisão do delimitador** propriamente dito — `('a::b', 'c')` e
  `('a', 'b::c')`, que colidiriam sob a concatenação `` `${instanceId}::${messageId}` ``
  usada antes desta correção — aplicados em DOIS Durable Objects de
  verdade, com o rascunho de cada um coerente com a própria chave (nunca um
  cruzamento). `worker.ts` e o teste usam a MESMA função
  (`codificarChaveCompostaDedup`), então isto prova o comportamento real de
  produção, não um artefato só do teste.
- **Reentrega concorrente de verdade** (`dedupDurableObject.test.ts`,
  "CONCORRÊNCIA REAL"): `Promise.all` disparando 2 e depois 10 chamadas
  **simultâneas** de verdade contra o MESMO stub do Durable Object, dentro
  do runtime real — exatamente uma aplica, as demais veem duplicado. Isto
  roda no runtime de verdade (não é um mock de concorrência).
- **Restart/recuperação** (corrigido nesta rodada: comparação profunda do
  objeto completo, não só um campo de texto): usa `evictDurableObject` (API
  oficial de teste, ver Fontes) para descartar a instância em memória — um
  stub NOVO para a mesma chave recupera o rascunho **inteiro**, campo a
  campo (`toEqual` no objeto completo), redelivery do mesmo payload
  continua detectando duplicata, e uma redelivery com **payload diferente**
  na mesma chave nunca sobrescreve o rascunho original — a consulta final
  continua devolvendo o primeiro, byte a byte. **Isto não é um restart de
  PROCESSO do sistema operacional** (o teste roda no mesmo processo
  `vitest`) — é o mecanismo de teste oficial para simular a mesma classe de
  evento (perda do estado em memória, estado em disco sobrevivendo), e é o
  que a documentação oferece para isso.
- **Falha REAL de gravação na aplicação efetiva, nunca mockada** (corrigido
  nesta rodada — o método de teste `_SOMENTE_TESTE_demonstrarRollbackDeTransacao`
  foi **removido do artefato de produção**; nada de bypass/flag/método de
  teste permanece em `durableObjectDedup.ts`, `worker.ts` ou
  `aplicarDecisaoIngestaoWorker.ts` — guarda estrutural confirma isto por
  padrão de texto): um rascunho com um campo `texto` de 20 milhões de
  caracteres (forma válida pelo schema — nada limita o tamanho de `texto`)
  faz o runtime LOCAL de verdade (`workerd`/Miniflare) recusar a gravação
  com um erro genuíno de storage dentro do próprio método público
  `registrarAplicacaoSeNaoDuplicado` — não uma falha injetada/mockada. O
  teste confirma: a chamada devolve `erro_gravacao`; a MESMA chave,
  consultada depois, continua `nao_aplicado` (nenhum rascunho
  parcial/órfão); e uma nova tentativa com um rascunho válido na mesma
  chave aplica normalmente depois (retry bem-sucedido). O limiar exato
  (entre 8M e 10M caracteres neste runtime local) foi obtido por observação
  direta nesta rodada, não pela documentação — ver comentário no teste e
  "Fontes" abaixo.
- **Observação não envenena aplicação**: as duas são chaves de storage
  SEPARADAS dentro da mesma instância do Durable Object — testado nos dois
  sentidos.
- **Gate G1 continua fechado**: `decidirIngestaoAutomatica.ts` foi
  reaproveitado **sem nenhuma alteração** — `worker.ts` chama exatamente
  `decidirIngestaoAutomatica(normalizado.evento)`, uma única vez, sem
  cabeçalho/query/env influenciando o resultado (guarda estrutural
  confirma isto por padrão de texto).
- **Limite real de bytes do corpo** (`limitarEntradaHttp.test.ts`, 20
  testes): corpo exatamente no limite (aceito) e limite+1 (rejeitado);
  entrega em múltiplos chunks pequenos; ausência de `Content-Length`;
  `Content-Length` declarado menor que o corpo real; um "stream infinito"
  provando cancelamento antecipado (a leitura é abortada no instante em
  que o total excede o limite, nunca termina de bufferizar o resto);
  Unicode/emoji válido, inclusive partido byte a byte entre chunks; bytes
  UTF-8 inválidos rejeitados sem eco; um segredo fictício plantado no
  corpo confirmando que nunca aparece na resposta de erro.
- **Antiabuso por ordenação — zero alocação de Durable Object**
  (`workerFetch.test.ts`, blocos "proteções de ENTRADA", "interruptor
  RECEPTOR_HABILITADO" e "nenhum Durable Object é alocado"): um
  `DurableObjectNamespace` real envolvido num `Proxy` que conta chamadas
  reais de `idFromName`/`get` (nunca altera comportamento, só observa)
  confirma zero alocações para rota errada, Content-Type ausente,
  Content-Encoding presente, corpo grande demais em chunks, e para uma e
  dez mensagens não-elegíveis em sequência; o interruptor desligado/ausente
  devolve 503 com zero alocações, ligado processa normalmente (controle de
  sanidade).
- **Retenção/limpeza — primitivo testado e seu tradeoff explícito**
  (`dedupDurableObject.test.ts`, bloco "limparRegistrosMaisAntigosQue"):
  sem nenhum registro armazenado não falha; registro recente (horizonte
  não expirado) não é tocado; registro antigo (horizonte expirado,
  determinístico via parâmetro `agora` explícito — sem mockar o relógio
  global) É removido, e o REPLAY seguinte do mesmo `messageId` é tratado
  como mensagem NOVA (nunca "duplicado") — o tradeoff é demonstrado, não
  escondido; o mesmo vale, isoladamente, para a observação não-elegível.
  Guarda estrutural (`semBackendRealWorker.test.ts`) confirma que o método
  existe mas nunca é chamado por `worker.ts`/`aplicarDecisaoIngestaoWorker.ts`.

**Fora de escopo, declarado e não resolvido aqui:**
- A API oficial `ctx.storage.transaction(txn => ...)` documenta rollback
  explícito via `txn.rollback()`; para o throw-dentro-do-callback,
  **só `transactionSync()` tem rollback-on-throw documentado oficialmente**
  — `transaction()` (assíncrono, o usado aqui) não tem essa garantia
  reafirmada na documentação consultada nesta rodada. Por isso o método
  `registrarAplicacaoSeNaoDuplicado` continua com leitura+escrita simples
  (sem `transaction()`) em vez de se apoiar numa garantia de rollback não
  confirmada: a segurança vem de `storage.put` numa única chave ser
  atômico por natureza (escreve tudo ou nada) e de não haver nenhum
  `await` alheio entre a leitura e a escrita — não de um rollback de
  transação que a documentação não confirma para este método.
- O limite de 2 MB documentado para armazenamento SQLite de Durable
  Objects (ver Fontes) não é confirmado pela documentação como aplicado no
  runtime LOCAL — o teste desta rodada usa um valor (20M caracteres) obtido
  por tentativa direta neste runtime, não um número da documentação.
- Nenhuma assinatura/HMAC de callback foi inventada — cabeçalhos continuam
  só observados. O bloqueio de autenticação da W-API já foi comunicado ao
  Márcio antes desta rodada e não muda aqui.
- Nenhuma política de retenção/limpeza ATIVA foi implementada — só o
  primitivo testado (`limparRegistrosMaisAntigosQue`, nunca chamado). O
  horizonte seguro depende da janela real de reentrega/retry da W-API, não
  encontrada documentada publicamente nesta pesquisa — decisão pendente do
  contrato/documentação do fornecedor, não inventada aqui (ver RUNBOOK.md).
- Nenhum rate-limit GLOBAL existe ou é prometido — só a proteção LOCAL de
  ordenação (zero alocação de Durable Object para tráfego não-elegível) e
  o interruptor local `RECEPTOR_HABILITADO`. Um rate-limit de borda de
  verdade (por IP, por volume) dependeria de infraestrutura de produção
  (ex. Cloudflare Rate Limiting/WAF) fora do escopo desta rodada — ver
  checklist em RUNBOOK.md.
- Implantação, ativação do interruptor em produção e decisões de política
  continuam pendentes de aprovação explícita de Márcio — ver RUNBOOK.md
  para o procedimento e o checklist final.
- A recomendação Workers + Durable Objects já foi comunicada antes desta
  rodada — este trabalho é a ADAPTAÇÃO revisável dessa recomendação, não
  uma nova decisão, e **não é autorização de hospedagem/deploy**.
- Eviction/restart real de um Durable Object em produção (sob carga de
  verdade, em múltiplas regiões) não foi observado aqui — só o mecanismo de
  teste oficial que simula a classe do problema (perda de estado em
  memória). A documentação oficial consultada não detalha o comportamento
  de eviction em produção além disto.
- Nenhum deploy real foi feito, então nenhuma medição real de latência,
  cota ou comportamento sob tráfego de produção existe — só o que o runtime
  LOCAL (Miniflare) reproduz.

## Fontes oficiais consultadas nesta rodada (não memória de treinamento)

- Pacote atual: [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/)
  — o antigo `@cloudflare/vitest-pool-workers` está deprecado/renomeado.
  Versões exatas usadas (`npm registry`, consultadas nesta rodada):
  `@cloudflare/vitest-plugin@1.4.5`, `vitest@5.0.5`, `wrangler@4.151.2`.
- Instalação/config: [developers.cloudflare.com/workers/testing/vitest-integration/get-started/](https://developers.cloudflare.com/workers/testing/vitest-integration/get-started/)
  e [.../write-your-first-test/](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
  (import de `env`/`SELF` de `cloudflare:workers`, `createExecutionContext`/`waitOnExecutionContext`/`runInDurableObject`/`evictDurableObject` de `cloudflare:test`).
- API de storage/transações: [developers.cloudflare.com/durable-objects/api/sqlite-storage-api/](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
  e [.../api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/)
  — SQLite recomendado para toda classe nova; `transaction()`/`transactionSync()`;
  "a series of reads followed by writes, with no other intervening I/O,
  behaves like a transaction" (base da atomicidade de
  `registrarAplicacaoSeNaoDuplicado`).
- Input gate / output gate: [developers.cloudflare.com/durable-objects/reference/glossary/](https://developers.cloudflare.com/durable-objects/reference/glossary/).
- Exemplo oficial de teste de Durable Object (stub via `idFromName`+`get`,
  `runInDurableObject`, `evictDurableObject`, migrations `new_sqlite_classes`):
  [developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/).
- Guia inicial (padrão `exports`/`migrations` para `wrangler.jsonc`):
  [developers.cloudflare.com/durable-objects/get-started/](https://developers.cloudflare.com/durable-objects/get-started/).
- Limites de armazenamento (revisão independente nº2): backend SQLite —
  chave+valor combinados até 2 MB por linha; backend KV legado (não usado
  aqui) — valor até 128 KiB, `RangeError` documentado antes da escrita ser
  aplicada: [developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/).
  A documentação não confirma se esse limite é aplicado no runtime LOCAL —
  por isso o teste desta rodada determinou o limiar real (entre 8M e 10M
  caracteres) por tentativa direta neste runtime, não pela documentação.

Nenhuma destas fontes foi citada de memória — todas foram buscadas/lidas
nesta própria rodada antes de escrever o código.
