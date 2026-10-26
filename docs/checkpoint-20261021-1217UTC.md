# RSF — checkpoint 21/10/2026 12:17 UTC

Este registro supera os bloqueios de navegador/Library e a correção pendente descritos em checkpoint-20261021-0806.md.

## Correções concluídas

Claude foi recuperado na sessão existente, terminou a compactação e entregou cópia defensiva por campos explicitamente permitidos em catalogs/model.ts e properties/model.ts. Membros, equipes, serviços, propriedades e unidades não reutilizam os objetos recebidos. Campos extras não atravessam o contrato; IDs são preservados exatamente e IDs compostos só de espaços são negados. Nomes/descrições são aparados apenas para apresentação. Mensagens de erro do integrador não são exibidas literalmente.

Claude também criou testes de renderização Propriedades/Unidades para troca de projeto, estados loading/error, busca e distinção entre não integrado e vazio confirmado. Três asserções iniciais falharam porque a propriedade aparece em duas tabelas; ele corrigiu as contagens e preservou a asserção de zero dados anteriores após a troca.

Codex integrou as rotas de Equipes/Serviços, adicionou teste independente de preservação de IDs com espaços externos e fallback visual para membro sem nome. Autoria ficou separada: Claude em properties, Codex em catalogs nesse último ajuste, sem edição simultânea do mesmo arquivo.

Gemini encerrou FD1 (cópia defensiva) com base nos trechos exatos apresentados de catalogs/model.ts. O parecer não certifica o repositório completo, Propriedades/Unidades ou produção.

- Claude: https://claude.ai/chat/60750fab-bdd2-8420-bd2f-a8d7d753e240
- Gemini: https://gemini.google.com/app/3fbe09f8ef4d1890

## Validação

- Vitest Windows: **289/289 testes, 31 arquivos**, log ../vitest-accepted-20261021.txt.
- TypeScript noEmit: aprovado.
- Vite build (campo, central, demo): aprovado, preservando arquivos anteriores em dist.
- 37 testes OS/backend compatível/interface privada já aprovados na rodada anterior; estes arquivos não foram alterados nesta rodada.
- Nenhuma alegação de execução dos 79 testes Worker no Windows.

## Capturas Library confirmadas

Upload direto por library_create_library_file retornou succeeded para ambos. As falhas anteriores do helper não foram confundidas com sucesso.

- Desktop: libfile_f8686dd152e4819191d2fdd15d7a69f2 — rsf-pilot-desktop.png, 2544×1382.
- Mobile: libfile_4c6244e8c68c8191a0269f4e0e4fb9e7 — rsf-pilot-mobile.png, 390×2400.

Ambas mostram exclusivamente a prévia fictícia local. A mobile usa frame de 390 CSS pixels, não emulação de aparelho físico. Recibos preservados em ../screenshots/library-receipts.json. Python Windows não suporta os.setxattr; metadados retornados estão no recibo, não foram alegados como atributos aplicados.

## Estado real / dependências

Piloto privado permanece **v3**, mesma implantação, Somente eu, v2 disponível para rollback. Nenhuma implantação adicional nesta rodada; hash de integration/Code.production-compatible.gs permanece cbc44896b550d522dedbac69cfaca343ec1f34fda63c62c21a146b02be692f84.

https://script.google.com/macros/s/AKfycbz7nGIzthl0FsvzyGGFeTTLJQhlh1Bpou2-43Z_lxA_RzdJJVkXryfh4ZrQ-V8Xb_Abmg/exec?pilot=1

A UI foi consultada sem recarregar nem ler senha/token e permanece na tela de login. Portanto **persistência real ainda não validada**, nenhum novo comando OS enviado à planilha nesta rodada. Próxima dependência: login legítimo do usuário no piloto e validação criar/listar/reabrir/atribuir/avançar/histórico real. Não solicitar senha no chat.

Propriedades, Unidades, Equipes e Serviços permanecem explicitamente não integrados até existir fonte real e contrato autorizado. Projeto não foi convertido em propriedade; Salas não foram convertidas em unidades; Usuarios não foram convertidos em equipes. Não houve compra, exclusão, novo OAuth, mudança de acesso, webhook WhatsApp ou publicação pública.
