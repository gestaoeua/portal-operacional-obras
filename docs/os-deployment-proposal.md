# Proposta de integração — pendente, não executada

## Marco verificado às 04:58 UTC

A entrada aditiva /central/ está implementada. src/App.tsx, App.css, api.ts, config.ts, fieldApi.ts, main.tsx, types.ts, vite-env.d.ts e index.html da raiz foram restaurados do commit base. O build gera campo + central + demo separadamente.

O candidato preferido para revisão é integration/Code.production-compatible.gs, gerado por node tests/build-compatible-backend.cjs. Ele preserva as funções login_, session_, hash_, safeEqual_, enter_ e exit_ originais e acrescenta o roteador OS ao doPost. As novas ações OS revalidam conta ativa/papel e grant dentro do lock, inclusive antes de replay. NÃO usar apps-script/Code.gs diretamente para produção: ele ainda contém a foundation com alterações de autenticação separadas. Nunca instalar os dois arquivos juntos no mesmo Apps Script.

29 testes OS/UI passaram contra o candidato compatível. Fluxo confirmado também via Chrome com fixture HTTP exclusivamente local: criar, atribuir, seis etapas, reabrir, recarregar a página, autenticar novamente e abrir os oito eventos. Isso não é teste de persistência do Google Sheets real.

Endpoint proposto: nova versão/deployment homologado do Apps Script, URL exata ainda NÃO criada nem inventada, configurada somente em VITE_RSF_CENTRAL_API_URL. O campo mantém sua configuração original. Caminho proposto da central após autorização: https://gestaoeua.github.io/portal-operacional-obras/central/. Antes de publicar qualquer deployment, confirmar a identidade/projeto Apps Script existente e a autorização de acesso, sem conceder novo OAuth implicitamente.

Além das ações OS, o adaptador compatível acrescenta listRooms autenticado e logout explícito para o cliente central; listWorkOrders legado fica desabilitado nesse candidato. GET e operações antigas do campo permanecem originais. Mudança de schema proposta: somente OS_Eventos e OS_Acessos descritas abaixo. IDs de projetos e membros reais aguardam definição explícita; nenhuma permissão é inferida por papel.

Este checkout é preparação local. Não publicar seu index.html sobre o app de campo: a foundation recebida transforma a entrada principal em central. A entrega deve separar central em uma entrada aditiva, preservar a entrada de campo do commit base e revisar os assets compartilhados antes de publicar.

## Mudanças de dados propostas

O novo código usa duas abas adicionais no workbook operacional obtido por getSpreadsheet_(), sem migrar ou atribuir projeto às OS legadas:

- OS_Acessos: ProjetoId, Usuario.
- OS_Eventos: RequestId, OsId, ProjetoId, TipoEvento, StatusAnterior, StatusNovo, ResponsavelAnterior, ResponsavelNovo, UsuarioId, PapelUsuario, CriadoEm, Revisao, Origem, OrigemDetalhe, Motivo, Escopo, ComandoCanonico.

OS_Eventos é o journal autoritativo. Cada comando acrescenta uma linha; estado e histórico derivam desse journal. Não apagar, reordenar ou corrigir linhas manualmente durante operação. O lock do Apps Script não bloqueia editores diretos da planilha. O custo de leitura integral precisa ser medido antes de ampliar o piloto.

setupOsOperacional existe como utilitário manual e NÃO foi executado. Antes de autorizar qualquer mudança real, confirmar o workbook alvo, os IDs reais dos projetos, a lista explícita de usuários autorizados por projeto, a política de criação/atribuição/conclusão e a identidade de implantação. Não copiar usuários, hashes ou dados reais para fixtures.

## Sequência proposta para aprovação

1. Finalizar regressões locais e revisão do código, incluindo grant revogado durante espera do lock, repetição após falha ambígua e integridade do journal.
2. Preparar entrada central aditiva com o design recuperado. Conferir que o build de campo original continua presente e funcional.
3. Separar o diff de autenticação introduzido pela foundation. Nenhuma alteração de login, sessões ou algoritmo de senha pode ser promovida como parte implícita da OS.
4. Com autorização específica, usar ambiente privado de homologação e dados fictícios. Criar somente as duas abas acima e grants de teste aprovados. Não executar setupSistema, reset ou migração de usuários.
5. Validar no Apps Script real: criar, recarregar, atribuir, avançar etapas, concluir, reabrir e confirmar histórico; negar acesso cruzado e duplicação. Os testes VM não comprovam comportamento real de Sheets, redirects/CORS ou quotas.
6. Apresentar URL exata da central, versão do backend, diff final, evidências e rollback para validação humana. Só então solicitar autorização para publicar produção.

## WhatsApp

O pacote permanece desligado por padrão. Seus testes sintéticos não comprovam recebimento do provedor. A origem whatsapp_prep do ledger indica transcrição manual, não mensagem autenticada automaticamente.

Para o teste real, ainda faltam autenticação verificável de entrada, escopo do número/remetente/projeto piloto e integração efetiva do evento verificado ao ledger. Um Bearer usado para configurar webhook não comprova a autenticidade do callback. Não conectar um webhook geral que receba conversas de terceiros nem cadastrar secrets sem autorização específica.

## Rollback proposto

Preservar versão/URL de backend e build de campo atuais. Publicação aditiva permite retirar a nova entrada e desligar receptor sem excluir OS_Eventos/OS_Acessos nem dados já registrados. Reconciliar gravações ambíguas por RequestId; nunca resolver com reenvio que gera novo identificador automaticamente.
