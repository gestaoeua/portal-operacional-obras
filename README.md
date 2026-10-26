# RSF · Portal Operacional

Evolução incremental do portal existente, preservando o cadastro de locais e o histórico de campo. React/TypeScript + adaptador Apps Script para as fontes Google Sheets existentes.

## Estado atual: preparação, não liberação para produção

**Não publique esta versão em produção.** O frontend e os testes locais não eliminam os bloqueios de autenticação, persistência e acesso descritos em [docs/backend-security.md](docs/backend-security.md).

A versão antiga deste README indicava que só faltava publicar. Essa afirmação foi retirada após revisão do código: o armazenamento legado de senhas usa SHA-256 sem salt individual, o controle de tentativas é efêmero, e as gravações entre abas não são transacionais. Não crie contas de produção com esse mecanismo.

## O que foi implementado

- Interface responsiva preto/vermelho baseada nas seis referências aprovadas, sem copiar seus exemplos fictícios
- Login, consulta autenticada de locais, histórico e execução de campo
- OS em leitura autenticada, preservando o ID, endereço, status, escopo, proteções, dependências e observações da fonte original
- Filtros de locais, detalhes de OS e retorno à lista
- Sem persistência de tokens no navegador; logout revoga a sessão no servidor
- Validação de perfis e conta ativa, prevenção de saída repetida e validação de esquema antes de gravar
- Indicadores de locais e registros reais, sem equiparar serviço finalizado a unidade pronta para locação
- Estado explícito de indisponibilidade para fotos/aprovações que ainda não existem como dados estruturados

A aba OS não é uma nova base. O servidor consulta a fonte existente separadamente. Não há cópia de registros de clientes/funcionários no pacote da aplicação.

## Fontes e limites

- `Salas` e `Registros`: permanecem na planilha configurada pelo backend original
- `OS`: outra planilha, configurada no servidor por `OS_SPREADSHEET_ID` em Script Properties; leitura apenas para gestor/diretor
- Nenhuma associação automática entre OS, MARKs de salas e projetos de custos
- `Projetos` e `Clientes` do backend ainda não possuem cadastro consolidado
- Divergências entre cópias de salas devem ser reconciliadas pelo responsável; nunca sobrescrever a fonte atual usando uma cópia
- Fotografias, checklist de qualidade, autorização de entrega, responsáveis e prazos necessitam contrato aditivo e revisão de acesso

## Desenvolvimento local

```sh
npm ci
npm test
npm run build
```

Para testar a integração apenas em staging isolado, copie `.env.example` para `.env.local` e configure `VITE_APPS_SCRIPT_URL` com a URL de um backend autenticado já verificado. Essa variável contém apenas URL, nunca senha, token ou segredo. Sem configuração, a aplicação falha de forma explícita.

```sh
npm run dev -- --host 127.0.0.1
```

`tests/ui.cjs` usa Playwright/Chromium e dados sintéticos interceptados em `/test-api`. Não usa dados nem credenciais reais. Os testes de backend executam Apps Script em um VM com serviços simulados; não comprovam comportamento de implantação Google.

## Portões obrigatórios para publicação

1. Aprovar público e matriz de acesso: gestão, equipe e/ou clientes
2. Substituir autenticação legada por mecanismo consolidado, com recuperação e proteção contra abuso
3. Revisar isolamento por projeto/cliente e restringir fontes/fotos/documentos
4. Definir backup, trilha de auditoria, idempotência e recuperação de gravações
5. Validar schemas e dados em staging, incluindo sessões expiradas, falhas de rede, cliques repetidos e permissões
6. Confirmar configurações de implantação e de fontes sem publicar dados no repositório
7. Revisar exposição da implantação antiga e planejar substituição/rollback
8. Somente então autorizar e executar implantação; verificar commit e CI exatos

O workflow de publicação já existente permanece no repositório. Ele não foi executado por este trabalho. Não mescle esta preparação em `main` antes dos portões acima.
