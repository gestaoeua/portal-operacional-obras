// =============================================================================
// CONFIGURAÇÃO DO PAINEL — edite APENAS a linha abaixo depois de publicar o
// Apps Script (veja o README.md, seção "Publicar o Apps Script").
// =============================================================================
//
// Cole aqui a URL de implantação do Apps Script (termina em "/exec").
// Exemplo: "https://script.google.com/macros/s/AKfycb.../exec"
//
// Esta URL não é um segredo: ela aponta para um endpoint público, somente
// leitura (GET), que não expõe nenhuma credencial. Ainda assim, ela só
// funciona para retornar os dados da planilha configurada pelo dono do
// projeto — nenhum visitante consegue alterar nada por aqui.
export const APPS_SCRIPT_URL =
  'COLE_AQUI_A_URL_DE_IMPLANTACAO_DO_APPS_SCRIPT';

// Intervalo (em milissegundos) que o navegador espera pela resposta da API
// antes de mostrar a mensagem de erro amigável.
export const FETCH_TIMEOUT_MS = 15000;
