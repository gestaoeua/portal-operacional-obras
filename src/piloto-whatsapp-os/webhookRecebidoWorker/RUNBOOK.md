# RUNBOOK — Worker de deduplicação do piloto WhatsApp (W-API)

> ## ⚠️ NÃO PRONTO PARA RECEBER DADOS REAIS
> Este pacote é uma preparação offline, revisável — **não é autorização de
> produção, e não deve receber tráfego real de clientes em nenhuma
> circunstância ainda**. Os três bloqueios abaixo (autenticação, retenção,
> aprovação de implantação) continuam abertos. Nenhum teste local, por mais
> completo que seja, substitui essas três decisões.

**Este documento é preparação, não autorização.** Nenhum comando de
implantação (`wrangler deploy` ou equivalente) foi executado nesta rodada,
nenhuma conta Cloudflare foi usada, nenhum recurso foi criado. Tudo aqui
roda localmente (`workerd`/Miniflare via `@cloudflare/vitest-plugin`) — ver
README.md para o desenho completo e o que cada teste prova.

**Bloqueios reais que impedem produção hoje** (não "detalhes a resolver
depois" — são a razão deste pacote ainda não poder virar produção):
1. **Autenticação do callback W-API não tem mecanismo verificado.** Nenhuma
   assinatura/HMAC/segredo de fornecedor foi inventado neste código — o gate
   G1 (`decidirIngestaoAutomatica.ts`) permanece **fail-closed**
   (`elegivel: false` sempre, hoje) até que a W-API documente/forneça um
   mecanismo real de verificação.
2. **Política de retenção/limpeza de dados de deduplicação NÃO existe como
   política ativa, e a limpeza sintética testada NÃO é uma política segura
   pronta para usar.** Depende da janela real de reentrega/retry da W-API
   (contrato/documentação do fornecedor), não encontrada publicamente nesta
   pesquisa. O primitivo (`limparRegistrosMaisAntigosQue`) existe, testado,
   mas **nunca é chamado** — e o próprio teste que o exercita demonstra por
   que: apagar um registro de deduplicação faz um REPLAY daquele
   `messageId` parecer mensagem nova depois da limpeza (dedup perdida para
   esse registro). Por isso NENHUM agendamento automático (Durable Object
   Alarm/`ctx.storage.setAlarm`) nem TTL foi implementado nesta rodada —
   decisão deliberada, não uma lacuna: ligar isso automaticamente sem a
   decisão de política abaixo arriscaria apagar proteção de deduplicação
   de dados reais sem aprovação.
3. **Nenhuma aprovação de implantação foi dada.** Criar recursos numa conta
   Cloudflare real, rodar `wrangler deploy`, e ativar `RECEPTOR_HABILITADO`
   em produção são decisões de Márcio, não deste trabalho de preparação.

Enquanto qualquer um destes três pontos estiver pendente, **este pacote não
está pronto para produção** — não decida isso lendo só os testes locais.

---

## 1. Pré-requisitos (antes de qualquer implantação futura)

- [ ] Mecanismo de autenticação do callback W-API confirmado e documentado
      pelo fornecedor (assinatura, header, IP allowlist, ou o que for) —
      implementado e testado como sua própria mudança, nunca inventado.
- [ ] Decisão de retenção: horizonte de tempo seguro para
      `limparRegistrosMaisAntigosQue` (ou decisão explícita de nunca
      chamá-lo em produção) — depende do ponto acima sobre a W-API.
- [ ] Conta Cloudflare do projeto (não deste trabalho) — Durable Objects com
      armazenamento SQLite (o backend usado aqui, `new_sqlite_classes` em
      `wrangler.jsonc`) são suportados no **Workers Free**, não exigem o
      plano pago "Workers Paid" (correção desta rodada — essa exigência
      valia para o backend KV legado de Durable Objects, não para o SQLite
      usado neste subpacote). Fonte oficial:
      [developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/)
      — "Workers Free plan: Only Durable Objects with SQLite storage
      backend are available" (5 GB de armazenamento total por conta no
      Free, limite bem acima do que esta store de deduplicação usaria).
      A conta real do projeto já foi verificada por Márcio/Guardian como
      Workers Free — este runbook não reabre nem reconsulta essa conta,
      só registra o limite relevante da documentação pública.
- [ ] `wrangler login` feito pela própria pessoa responsável pela conta,
      na própria máquina dela — nunca por este trabalho, nunca com
      credenciais compartilhadas neste chat/repositório.
- [ ] Revisão humana final deste patch (código + testes + este runbook)
      por alguém com acesso à conta de produção.

## 2. Dry-run / build local vs. publicação real — a distinção que importa

| Ação | O que faz | Precisa de conta/credenciais? |
|---|---|---|
| `npm ci` | instala EXATAMENTE as versões do `package-lock.json` incluído (reprodutível) neste `node_modules` isolado | Não |
| `npm run typecheck` | `wrangler types` (gera tipos locais) + `tsc --noEmit` | Não (usa `WRANGLER_SEND_METRICS=false`) |
| `npm test` | roda os testes reais dentro do runtime local `workerd`/Miniflare | Não |
| `npx wrangler deploy --dry-run` | valida a configuração e empacota o Worker **sem publicar nada** — EXECUTADO de verdade nesta rodada, ver abaixo | Confirmado nesta rodada: **não** |
| `npx wrangler deploy` (sem `--dry-run`) | **PUBLICA de verdade**, cria recursos reais (o Durable Object namespace) | **SIM — login + conta real** (Workers Free já é suficiente para Durable Objects com SQLite — ver seção 1 — nenhum plano pago é exigido para este subpacote) |

**`wrangler deploy --dry-run` foi executado de verdade nesta rodada**
(`WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run`, sem
`wrangler login`, sem `account_id`, sem nenhuma credencial) — saída real:

```
⛅️ wrangler 4.151.2
────────────────────
Total Upload: 24.93 KiB / gzip: 6.77 KiB
Your Worker has access to the following bindings:
Binding                                           Resource
env.DEDUP_DO (DedupDurableObject)                 Durable Object
env.RECEPTOR_HABILITADO ("false")                 Environment Variable

--dry-run: exiting now.
```

Confirma três coisas: (1) o comando funciona sem login/conta — a ausência
de `account_id` neste `wrangler.jsonc` não impediu a validação/empacotamento
local; (2) o valor efetivo de `RECEPTOR_HABILITADO` que SERIA publicado é
`"false"` (o default seguro — ver wrangler.jsonc); (3) `--dry-run` realmente
"sai antes de publicar" (`exiting now`), sem nenhuma chamada de API que
criasse ou alterasse recursos. **`wrangler deploy` sem `--dry-run` não foi
executado** — isso exigiria login numa conta real.

**Regra**: qualquer comando sem `--dry-run` que contenha `deploy`, `publish`,
`create` (de recurso Cloudflare: KV namespace, D1, R2, etc.) exige uma
confirmação ESPECÍFICA e explícita da pessoa responsável pela conta, nunca
inferida de "parece que já discutimos isso antes".

## 3. Implantação FUTURA — passo a passo com placeholders (NUNCA segredos reais)

Estes comandos **não foram executados** nesta rodada — são o procedimento
preparado para quando as aprovações acima existirem.

```bash
cd src/piloto-whatsapp-os/webhookRecebidoWorker

# 1) Confirmar que os testes locais continuam passando antes de qualquer
#    passo real — nunca pule isto.
npm test

# 2) Login na conta REAL do projeto — feito pela pessoa responsável pela
#    conta, nunca por este trabalho. Abre um fluxo OAuth no navegador;
#    nenhuma credencial é digitada em texto aqui.
npx wrangler login

# 3) Dry-run primeiro — valida sem publicar nada.
npx wrangler deploy --dry-run

# 4) SÓ DEPOIS de uma confirmação explícita e específica ("sim, publicar
#    agora") da pessoa responsável pela conta:
npx wrangler deploy
```

`wrangler.jsonc` deste subpacote já define `"vars": { "RECEPTOR_HABILITADO":
"false" }` — este é o valor DISTRIBUÍDO/implantável (o estado seguro por
default). O valor `"true"` só existe como override **exclusivo dos testes**,
em `vitest.config.ts` (`miniflare.bindings.RECEPTOR_HABILITADO`), e nunca é
lido de `wrangler.jsonc` nem afeta um deploy real (ver comentário em ambos os
arquivos). Para uma implantação real:

```jsonc
// Em wrangler.jsonc, antes do deploy real: decidir explicitamente —
// "false" (ou remover a linha) deixa o receptor DESLIGADO mesmo depois do
// deploy (503 para tudo, sem ler corpo nem alocar Durable Object) — o
// estado mais seguro para uma primeira implantação, até que a decisão de
// ativação seja tomada separadamente.
"vars": {
  "RECEPTOR_HABILITADO": "false"
}
```

Nenhum ID de conta (`account_id`), token, ou segredo real aparece em
nenhum arquivo deste subpacote — confirmado pela guarda estrutural
(`semBackendRealWorker.test.ts`, teste de `account_id`). Um `account_id`
real só entraria no momento do deploy de verdade, através do próprio
`wrangler` (login interativo), nunca escrito em um arquivo de configuração
versionado.

## 4. Smoke tests sintéticos (depois de um deploy real, antes de considerar "ativo")

**O payload tem que ser o formato BRUTO que a W-API realmente envia ao
callback** (`event`/`instanceId`/`connectedPhone`/`messageId`/`isGroup`/
`fromMe`/`chat`/`sender`/`moment`/`msgContent` — ver
`../webhookRecebido/tipos.ts` e `validarPayloadBruto.ts`), **nunca** o
objeto já normalizado internamente (`instanceId`/`messageId`/`remetenteId`/
`texto`/`momentoUnix`, que é o que `decidirIngestaoAutomatica` recebe
DEPOIS do processamento — um smoke test que postasse isso não estaria
testando o endpoint real, só uma forma que o endpoint nem aceita).

Por isso os comandos abaixo usam o arquivo
`fixtures/smoke-teste-texto-privado.json`, já empacotado neste subpacote
(incluído no ZIP/patch desta rodada) — é EXATAMENTE a mesma fixture usada
em `__tests__/workerFetch.test.ts` (`PAYLOAD_TEXTO_PRIVADO_FICTICIO`,
`../webhookRecebido/fixturesWebhookRecebido.ts`; um teste nessa suíte
confirma que o arquivo nunca diverge da fixture), então o que você roda
aqui manualmente é exatamente o que a suíte automatizada já provou que o
Worker rejeita. `instanceId`/`messageId`/`sender.id` nela são claramente
fictícios (sufixo `-ficticia-`/`-ficticio-`) — **nunca use um
instanceId/messageId/sender.id ou texto de um cliente real num smoke
test, nem em produção, nem "só para testar"**.

```bash
cd src/piloto-whatsapp-os/webhookRecebidoWorker

# Com RECEPTOR_HABILITADO="false" (estado inicial seguro, o default deste
# subpacote — ver wrangler.jsonc): espera-se 503 para QUALQUER requisição,
# mesmo bem formada, mesmo com o payload fictício válido abaixo.
curl -i -X POST "https://<worker-url>/webhook-w-api" \
  -H "Content-Type: application/json" \
  --data-binary @fixtures/smoke-teste-texto-privado.json
# Esperado: HTTP 503, corpo {"resultado":"receptor_desabilitado",...}

# Depois de decidir ativar (RECEPTOR_HABILITADO="true", novo deploy):
# 1) Payload bruto fictício, bem formado: espera-se 503 (NUNCA 2xx —
#    correção desta rodada) com "recebido_nao_elegivel". Autenticidade do
#    remetente continua sem mecanismo verificado (gate G1 fechado) — isto
#    é o comportamento CORRETO hoje, nunca um erro a "corrigir" ativando
#    alguma coisa.
curl -i -X POST "https://<worker-url>/webhook-w-api" \
  -H "Content-Type: application/json" \
  --data-binary @fixtures/smoke-teste-texto-privado.json
# Esperado: HTTP 503, corpo {"resultado":"recebido_nao_elegivel",...}

# 2) Rota errada — espera-se 404.
curl -i -X POST "https://<worker-url>/rota-errada" -H "Content-Type: application/json" -d '{}'

# 3) Content-Type errado — espera-se 415.
curl -i -X POST "https://<worker-url>/webhook-w-api" -H "Content-Type: text/plain" -d 'oi'

# 4) Método errado — espera-se 405 com o cabeçalho "Allow: POST".
curl -i -X GET "https://<worker-url>/webhook-w-api"

# 5) Corpo grande demais — espera-se 413 (ajuste o tamanho para passar de
#    TAMANHO_MAXIMO_CORPO_BYTES, hoje 256 KiB). Gerado num ARQUIVO
#    separado primeiro — nunca como argumento inline de shell (300 KB num
#    argumento de linha de comando é frágil e, em alguns shells, pode
#    exceder limites do próprio sistema):
python3 -c "import json; json.dump({'x': 'a' * 300_000}, open('/tmp/smoke-corpo-grande.json', 'w'))"
curl -i -X POST "https://<worker-url>/webhook-w-api" -H "Content-Type: application/json" \
  --data-binary @/tmp/smoke-corpo-grande.json
rm -f /tmp/smoke-corpo-grande.json
```

Cada resposta deve incluir o cabeçalho `x-cabecalhos-observados-count` (só
a contagem, nunca os valores) — confirma que a auditoria de cabeçalhos
está ativa sem expor nada sensível.

**Nunca** rode estes smoke tests contra um `instanceId`/`messageId`/
`sender.id` de um cliente real, e nunca envie um corpo com um número de
telefone, nome ou texto de mensagem real — mesmo em produção, mesmo "só
para testar".

## 5. Desativação / rollback

**A ordem importa: desativação segura PRIMEIRO, sempre.** Qualquer
incidente começa desligando o receptor (abaixo) — nunca um rollback de
código, e nunca qualquer comando que toque o binding/classe/storage do
Durable Object. Um rollback de código só deveria ser considerado DEPOIS,
e só com autorização explícita futura de quem decide a implantação —
nunca como primeira reação.

**Desativação rápida (reversível, não destrutiva) — o procedimento padrão
e preferido para qualquer incidente:**
```jsonc
// wrangler.jsonc
"vars": {
  "RECEPTOR_HABILITADO": "false"
}
```
seguido de `npx wrangler deploy` (ou `--dry-run` primeiro, como sempre).
Isto faz o Worker devolver 503 para tudo, **sem tocar em nenhum dado já
armazenado** nos Durable Objects — os registros de deduplicação
permanecem intactos, prontos para quando o receptor for religado. Isto
preserva o binding (`DEDUP_DO`), a classe (`DedupDurableObject`) e todo o
storage — nada disso é removido ou alterado por esta desativação.

**NUNCA, como parte de uma desativação/rollback, rode um comando que
apague dados dos Durable Objects** (por exemplo, remover o `durable_object`
binding do `wrangler.jsonc`, remover/renomear a classe `DedupDurableObject`
sem uma migração explícita, ou qualquer comando de "limpar"/"resetar"
namespace de Durable Object) — isso destruiria os registros de
deduplicação (incluindo a proteção de observação não-elegível e a de
aplicação efetiva), e uma reentrega de uma mensagem antiga depois disso
pareceria nova (mesmo efeito documentado na seção de retenção do
README.md, mas acionado por acidente, não por decisão de política). **Este
runbook nunca promete rollback de DADOS, nem a exclusão de recursos** —
só o rollback de CÓDIGO abaixo, que por natureza não toca no storage.

**Rollback de código** (voltar a uma versão anterior do Worker) — **só
depois de desativar (acima), e só com autorização futura explícita**: use
o histórico de deploys do `wrangler`/painel Cloudflare para reimplantar
uma versão anterior. Isto preserva o storage dos Durable Objects — a
documentação da plataforma descreve o armazenamento como sobrevivendo a
reimplantações de código — mas confirme isso no painel real antes de
depender disso em um incidente de verdade, nunca presuma.

**Incompatibilidade real introduzida nesta rodada, que um rollback de
código precisa respeitar**: `durableObjectDedup.ts` passou a envelopar
cada registro de aplicação efetiva com `armazenadoEmUnixMs` (ver seção de
retenção no README.md) — o valor armazenado na chave `aplicacao_efetiva`
mudou de um `RascunhoOSWebhookRecebido` solto para um envelope
`{ armazenadoEmUnixMs, rascunho }`. Uma versão de código ANTERIOR a esta
rodada, se reimplantada por cima de dados já gravados no formato NOVO,
tentaria ler esse envelope como se fosse o rascunho direto — a validação
de formato existente (`validarRascunhoLidoDoStorage`) rejeitaria isso
como `formato_inesperado`/`erro_gravacao`, nunca silenciosamente
corromperia o dado, mas o comportamento (recusar) seria inesperado para
quem não sabe desta mudança. **Enquanto o Worker nunca foi implantado de
verdade (como hoje), isto é só uma nota de design — não há dados reais no
formato antigo para colidir.** Se algum dia houver uma implantação real
seguida desta correção, um rollback de código para antes desta rodada
NÃO deve ser feito sem primeiro confirmar que não há registros no formato
novo, ou sem uma migração de dados equivalente.

Se algum dia for necessário apagar dados de deduplicação de propósito
(por exemplo, por pedido de exclusão de um cliente), isso é uma decisão de
política separada, explícita, documentada por escrito — nunca um efeito
colateral de uma desativação de emergência, e nunca algo que este runbook
executa ou recomenda por conta própria.

## 6. Checklist final de decisões necessárias para ativar em produção

- [ ] Mecanismo de autenticação do callback W-API confirmado, implementado
      e testado (não este pacote — uma mudança futura e específica).
- [ ] Decisão de retenção/limpeza: horizonte real (ou "nunca limpar") para
      `limparRegistrosMaisAntigosQue`, com a janela de reentrega da W-API
      confirmada por contrato/documentação do fornecedor.
- [ ] Valor real de `RECEPTOR_HABILITADO` para a implantação decidido
      explicitamente (recomendação: começar com `"false"` mesmo depois do
      primeiro deploy, ativar só depois dos smoke tests sintéticos).
- [ ] Limites conservadores deste pacote (256 KiB de corpo,
      `application/json` apenas, sem `Content-Encoding`) confirmados contra
      o tamanho/formato real de payloads de produção da W-API — ajustar
      `TAMANHO_MAXIMO_CORPO_BYTES` em `limitarEntradaHttp.ts` se necessário,
      nunca aumentar "só para garantir" sem um motivo real observado.
- [ ] Aprovação explícita e específica de Márcio (ou de quem tiver acesso à
      conta Cloudflare real) para: criar o Durable Object namespace na conta
      real, e para o primeiro `wrangler deploy` sem `--dry-run`.
- [x] Plano da conta Cloudflare real: Workers Free já suporta Durable
      Objects com armazenamento SQLite (ver seção 1) — já confirmado por
      Márcio/Guardian, nada pendente aqui.
- [ ] Teste isolado de clientes reais: confirmado que nenhum smoke test ou
      verificação pós-deploy usa um número de telefone, nome ou mensagem de
      um cliente de verdade — só dados sintéticos, sempre.

Enquanto qualquer item desta lista estiver em aberto, este trabalho
permanece no estado "pacote offline revisável" — não "pronto para
produção".
