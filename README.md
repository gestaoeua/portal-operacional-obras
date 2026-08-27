# Mapa de Progresso — Portal Operacional

Sistema modular para tablets, hospedado no GitHub Pages e alimentado por Google Sheets.

## O que está pronto

- Login por usuário e senha, com perfis `executor`, `gestor` e `diretor`.
- Executor: escolhe o local, registra entrada, toca no serviço executado, no status final e em **Sair e salvar**.
- Gestor: equipe ativa, locais em execução e histórico de serviços.
- Diretor: progresso geral, distribuição por status e volume de registros.
- A saída grava o histórico na aba `Registros` e atualiza o status na aba `Salas`.
- Planta, MARKs, serviços, observações, coordenadas e identidade visual existentes foram preservados.
- O modo de demonstração está desativado; nenhuma senha padrão é publicada.

## Estrutura desacoplada

- `src/`: interface do tablet e painéis por perfil.
- `src/fieldApi.ts`: única ligação da interface com o banco; permite trocar Sheets por outro banco no futuro sem refazer as telas.
- `apps-script/Code.gs`: API e criação das abas do banco.
- `public/floor-plan.png`: planta do projeto atual.
- `data/salas-inicial.csv`: cadastro atual dos locais.

Cada novo projeto poderá ter seu próprio registro na aba `Projetos`, sua planta e suas salas sem misturar histórico de clientes diferentes. A próxima evolução natural é adicionar `ProjetoID` às salas e registros quando houver um segundo projeto real.

## Publicação (única etapa pendente)

1. Na planilha, abra **Extensões → Apps Script** e substitua o código pelo arquivo `apps-script/Code.gs`.
2. No seletor de funções, execute uma vez `setupSistema`. Isso cria, sem apagar `Salas`, as abas `Usuarios`, `Registros`, `Projetos` e `Clientes`.
3. Cadastre cada usuário na aba `Usuarios`. Gere o hash da senha chamando `gerarSenhaHash('SENHA FORTE')` no Apps Script e cole o resultado em `SenhaHash`.
4. Use **Implantar → Gerenciar implantações → Editar → Nova versão → Implantar**, executando como você e permitindo acesso a qualquer pessoa.
5. Copie a URL terminada em `/exec` para `src/config.ts`.
6. Confirme que `DEMO_MODE` permanece como `false` em `src/fieldApi.ts`.
7. Envie estes arquivos à branch de publicação do GitHub. O workflow em `.github/workflows/deploy.yml` faz o restante.

## Segurança

O repositório não contém usuários nem senhas padrão. As credenciais são criadas apenas na planilha privada, com senha armazenada como hash.

## Validação realizada

- TypeScript sem erros.
- Regras de login, sessão, perfis, entrada única, saída e atualização de status revisadas.
- Layout responsivo: botões grandes, sem escrita no fluxo do executor e adaptação para tablet/celular.
- Site público atual não foi alterado.

## Comandos locais

```bash
npm install
npm run build
npm run dev
```
