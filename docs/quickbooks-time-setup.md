# Quem está trabalhando: ligar o QuickBooks Time

A tela **Quem está trabalhando** da central lê o ponto de hoje no QuickBooks Time. Ela mostra quem está com ponto aberto, em qual obra, quantas pessoas há por obra, quem já saiu e quem ainda não bateu ponto.

- Somente leitura: o portal nunca altera o ponto.
- Só perfis **gestor** e **diretor** veem a tela e os dados. O perfil executor recebe `FORBIDDEN`.
- O token do QuickBooks Time fica só em **Script Properties** do Apps Script. Ele nunca vai para o repositório nem para o navegador.
- O resultado fica em cache por 60 segundos, e a tela se atualiza sozinha a cada 2 minutos.

## 1. Gerar o token no QuickBooks Time (uma vez)

1. Entre no QuickBooks Time como administrador.
2. Vá em **Feature Add-ons → Manage Add-ons → API → Install**.
3. Abra o add-on API e clique em **Add a new application**. Dê um nome, por exemplo "Portal RSF", e salve.
4. Copie o **Access Token** gerado. Ele é uma senha: não mande por e-mail ou chat e não cole no código.

## 2. Guardar o token no Apps Script

1. Abra o projeto Apps Script do portal e substitua o `Code.gs` pelo conteúdo de `apps-script/Code.gs`.
2. Vá em **Configurações do projeto → Propriedades do script → Adicionar propriedade**.
   - Propriedade: `QBTIME_ACCESS_TOKEN`
   - Valor: o token copiado no passo 1
3. Faça **Implantar → Gerenciar implantações → Editar → Nova versão**. Na primeira execução, o Google vai pedir autorização para "conectar a um serviço externo" (UrlFetchApp). Aceite.

## 3. Conferir

Entre na central como gestor e abra **Quem está trabalhando**. Mensagens possíveis:

| Mensagem | Causa | Correção |
|---|---|---|
| Conexão com o QuickBooks Time ainda não configurada | Falta `QBTIME_ACCESS_TOKEN` | Passo 2 |
| O acesso ao QuickBooks Time expirou ou foi revogado | Token inválido ou revogado | Gere outro token (passo 1) |
| A conexão segura ainda não foi configurada | O build da central não tem `VITE_RSF_CENTRAL_API_URL` | Configurar a URL do backend no build (ver README) |

## O que a tela considera

- **Trabalhando agora**: registros de hoje com `on_the_clock = true`.
- **Já saíram hoje**: registros de hoje encerrados.
- **Sem ponto hoje**: usuários **ativos** no QuickBooks Time sem nenhum registro hoje. Isso inclui administradores que não batem ponto.
- **Obra**: o *job code* do registro. Um subitem aparece como "Cliente › Serviço".
- **Visão geral** mostra o bloco "Quem está trabalhando agora" (com link para a página completa) e os gráficos de horas.
- **Horas por cliente** (pizza) e **horas por funcionário**: Hoje, Esta semana (desde segunda) ou Este mês. O cliente é o job code de nível mais alto, e a soma inclui quem ainda está com ponto aberto.
- Fica em vermelho quem passa de 10h com ponto aberto, para conferir se alguém esqueceu de bater a saída.
- O dia é calculado no fuso America/New_York.
