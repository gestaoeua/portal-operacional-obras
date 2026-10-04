// Auditoria PROGRAMÁTICA de sanitização desta publicação. Este teste não
// confia em leitura manual — ele varre (a) TODO o código-fonte publicável
// desta demo, SEM exceção de diretório — `src/demo-os-cronograma/` inteiro,
// INCLUINDO `__tests__/` (arquivos de teste também vão para o repositório
// público no push, mesmo não entrando no bundle compilado — excluir
// `__tests__/` da varredura deixaria passar um dado real escondido só num
// teste ou comentário) — e (b) o `demo-os-cronograma/index.html` aditivo na
// raiz, e (c), quando o build já rodou (`dist/` existe), a saída COMPILADA
// segue o GRAFO DE ASSETS efetivamente referenciado a partir da entrada da
// demo — o HTML, o(s) script(s) que ele carrega e quaisquer chunks que
// esses scripts importem (ex.: o chunk de runtime do React compartilhado
// com o app real) — nunca só o HTML, que sozinho não contém a lógica/dados
// da aplicação. A resolução desse grafo é AGNÓSTICA DE BASE: ela localiza
// cada asset pela convenção de diretório do Vite (`assets/`), nunca
// assumindo que o site é servido na raiz (`/`) — o GitHub Pages real deste
// repositório serve sob `/portal-operacional-obras/`, então um ref de HTML
// como `/portal-operacional-obras/assets/demo-xxxx.js` tem que resolver
// para `dist/assets/demo-xxxx.js`, não para `dist/portal-operacional-obras/assets/demo-xxxx.js`
// (que nunca existe). Ver a suíte "grafo de assets — robustez de base" mais
// abaixo, com fixtures sintéticas que provam isso (inclusive o caso de
// falha: asset ausente, e o caso de detecção: padrão proibido só alcançável
// seguindo o grafo sob um base não-raiz).
//
// MUDANÇA IMPORTANTE (correção de uma segunda revisão independente, depois
// da primeira): a versão anterior deste scanner guardava cada dado real
// proibido (nome de pessoa, cidade, endereço, ID de implantação, ID de
// planilha) como `{comprimento, SHA-256 do valor em minúsculas}`, nunca o
// valor em si. Isso ainda foi considerado inadequado: um hash de um valor
// de BAIXA ENTROPIA (um nome próprio curto, o nome de uma cidade) pode ser
// quebrado por um ataque de dicionário — alguém que já suspeite de um nome
// candidato (ex.: informação pública sobre o dono do negócio) pode
// calcular o hash desse candidato e comparar com o hash publicado para
// CONFIRMAR o palpite instantaneamente. Ou seja, mesmo um hash não é
// anonimização forte o bastante para um nome curto — continua sendo um
// dado real derivado, publicamente verificável.
//
// Por isso esta versão REMOVE POR COMPLETO qualquer representação (valor
// literal, concatenado, codificado OU hash) de qualquer dado real
// específico — nome de pessoa, cidade, endereço, codinome de projeto,
// ID de implantação específico, ID de planilha específico. Nenhum desses
// valores aparece neste arquivo em NENHUMA forma, nem mesmo derivada.
//
// A sanitização agora é garantida por três mecanismos que não dependem de
// conhecer (nem de derivar de) nenhum valor real:
//   1. LISTA DE PERMISSÃO (allow-list) sobre os dados de fixtures: cada
//      campo de endereço/cidade/responsável/origem/usuário tem que bater
//      EXATAMENTE com um valor fictício aprovado explicitamente abaixo —
//      nunca uma checagem de ausência de um valor real, sempre uma
//      checagem de presença de um valor fictício conhecido.
//   2. PADRÕES GERAIS de formato de credenciais/URLs/IDs — não o valor
//      específico de nenhuma credencial real, mas o FORMATO que qualquer
//      implantação real do Apps Script ou qualquer URL/ID de planilha do
//      Google Sheets teria (prefixo "AKfycb...", "script.google.com",
//      "spreadsheets/d/<id>" etc.) — pega qualquer credencial real desse
//      tipo, não só uma específica.
//   3. ISOLAMENTO DE IMPORTS: verificação estrutural (análise de caminhos
//      de import, não de nomes) de que nenhum arquivo desta demo importa,
//      por caminho relativo, qualquer coisa fora de `src/demo-os-cronograma/`
//      — ou seja, o cliente de rede real, a config real, o App real e o
//      backend real (`Code.gs`) ficam estruturalmente inalcançáveis a
//      partir desta demo, não só "sem nenhum nome deles aparecendo".
//
// Troca consciente: isto é estruturalmente mais seguro contra o ataque de
// dicionário do que a versão anterior, mas não detecta automaticamente se
// alguém reintroduzir, no futuro, um nome/cidade real num COMENTÁRIO solto
// que não seja um dos campos de fixtures cobertos pela allow-list (fora do
// escopo de "credencial/URL/ID" dos padrões estruturais). Por isso a
// revisão manual dos comentários continua sendo parte do processo de
// publicação — este scanner cobre o que pode ser verificado de forma
// programática e sem reintroduzir o problema do hash.
import { describe, expect, it } from 'vitest';
import { dirname, join, resolve, sep } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DEMO_OS_FIXTURES, DEMO_USUARIOS } from '../fixtures';

const RAIZ = resolve(__dirname, '..', '..', '..'); // .../src/demo-os-cronograma/__tests__ -> raiz do worktree
const DIR_FONTE = resolve(__dirname, '..'); // src/demo-os-cronograma/
const HTML_ENTRY = resolve(RAIZ, 'demo-os-cronograma', 'index.html');
const DIST_ROOT = resolve(RAIZ, 'dist');
const DIST_HTML_ENTRY = resolve(DIST_ROOT, 'demo-os-cronograma', 'index.html');
const ESTE_ARQUIVO = resolve(__dirname, 'sanitizacao.test.ts');

// ---------------------------------------------------------------------
// 1) Padrões GERAIS de credenciais/URLs/IDs — nunca o valor de uma
//    credencial específica, só o FORMATO que qualquer credencial real
//    desse tipo teria.
// ---------------------------------------------------------------------

// Qualquer ID de implantação real do Apps Script tem esse formato
// (prefixo "AKfycb" + corpo longo em base64url) — pega qualquer
// implantação real, não um valor específico.
const PADRAO_APPS_SCRIPT_DEPLOY_ID = /AKfycb[A-Za-z0-9_-]{40,}/;

// Qualquer URL de planilha do Google Sheets com ID embutido tem esse
// formato — de novo, o FORMATO, não um ID específico.
const PADRAO_GOOGLE_SHEETS_ID_EM_URL = /spreadsheets\/d\/[a-zA-Z0-9_-]{20,}/i;

// Domínios do Google associados a uma integração ativa de verdade — nomes
// de domínio público, não segredos em si; detectam a PRESENÇA de uma
// integração real, não um valor específico de credencial.
const DOMINIO_APPS_SCRIPT = 'script.google.com';
const DOMINIOS_GOOGLE_ADICIONAIS = ['docs.google.com', 'sheets.googleapis.com', 'script.googleusercontent.com'];

/**
 * Varre `conteudo` contra os padrões GERAIS de credenciais/URLs/IDs acima.
 * Nunca compara contra o valor de um dado real específico — só formatos.
 *
 * `ehOProprioScanner`: true SÓ para este próprio arquivo de teste — ele
 * necessariamente contém, como string literal, os nomes de domínio que
 * esta função procura em todo o resto do código (não são segredos — são
 * só nomes de domínio público usados para detectar integração ativa). Sem
 * essa exceção pontual, o scanner sempre acharia a si mesmo. As checagens
 * de FORMATO (ID do Apps Script, URL de planilha) continuam valendo mesmo
 * para este próprio arquivo — só os literais de nome de domínio são
 * pulados, e só aqui.
 */
function acharPadroesProibidos(conteudoOriginal: string, ehOProprioScanner = false): string[] {
  const achados: string[] = [];
  if (PADRAO_APPS_SCRIPT_DEPLOY_ID.test(conteudoOriginal)) {
    achados.push('contém um ID de implantação do Apps Script (padrão estrutural AKfycb...) — qualquer implantação real é proibida aqui');
  }
  if (PADRAO_GOOGLE_SHEETS_ID_EM_URL.test(conteudoOriginal)) {
    achados.push('contém um padrão de URL de planilha do Google Sheets com ID (spreadsheets/d/<id>) — esta demo não referencia nenhuma planilha real');
  }
  if (!ehOProprioScanner) {
    const conteudoMin = conteudoOriginal.toLowerCase();
    if (conteudoMin.includes(DOMINIO_APPS_SCRIPT)) {
      achados.push(`contém o domínio "${DOMINIO_APPS_SCRIPT}" — esta demo não tem integração ativa`);
    }
    for (const dominio of DOMINIOS_GOOGLE_ADICIONAIS) {
      if (conteudoMin.includes(dominio)) achados.push(`contém o domínio "${dominio}" — esta demo não tem integração ativa`);
    }
  }
  return achados;
}

function listarArquivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const resultado: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) resultado.push(...listarArquivos(caminho));
    else resultado.push(caminho);
  }
  return resultado;
}

// ---------------------------------------------------------------------
// 2) Isolamento de imports — verificação ESTRUTURAL (caminhos de import),
//    não uma lista de nomes de arquivo proibidos.
// ---------------------------------------------------------------------

function extrairEspecificadoresImport(conteudo: string): string[] {
  const especificadores = new Set<string>();
  for (const m of conteudo.matchAll(/\bfrom\s*["']([^"']+)["']/g)) especificadores.add(m[1]);
  for (const m of conteudo.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) especificadores.add(m[1]);
  for (const m of conteudo.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) especificadores.add(m[1]);
  for (const m of conteudo.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) especificadores.add(m[1]);
  return [...especificadores];
}

// ---------------------------------------------------------------------
// 3) Grafo de assets do build compilado — AGNÓSTICO DE BASE.
// ---------------------------------------------------------------------

/**
 * Resolve um `ref` (de um atributo src/href de HTML, ou de um import
 * relativo dentro de um JS compilado) para o caminho real em disco dentro
 * de `distRoot` — SEM assumir que o site é servido na raiz ("/").
 *
 * Em vez de descartar um prefixo de base assumido fixo (o bug encontrado
 * pela revisão: a versão anterior só removia uma "/" inicial, o que
 * quebra sob o base real de produção deste repositório,
 * "/portal-operacional-obras/"), localizamos o diretório "assets/"
 * (convenção padrão do Vite — `build.assetsDir` não é customizado neste
 * projeto) dentro do próprio ref e resolvemos a partir dali. Isso
 * funciona para QUALQUER valor de base, sem precisar saber esse valor com
 * antecedência nem duplicar a lógica de `resolveBase()` do
 * `vite.config.ts` — prova disso nos testes sintéticos abaixo, com um
 * base fictício (nunca o nome real do repositório).
 */
function resolverCaminhoDeAsset(ref: string, distRoot: string): string {
  const MARCADOR = 'assets/';
  const idx = ref.lastIndexOf(MARCADOR);
  if (idx !== -1) return join(distRoot, ref.slice(idx));
  // Sem o marcador "assets/" explícito no ref (típico de um import
  // relativo interno de um chunk JS para outro, ex.: "./client-xxxx.js")
  // — todo chunk JS/CSS deste build vive em dist/assets/, então
  // resolvemos ali.
  return join(distRoot, 'assets', ref.replace(/^\.?\//, ''));
}

/**
 * Segue o grafo de assets REALMENTE referenciado a partir de um HTML de
 * entrada: extrai src/href de <script>/<link>, resolve contra `distRoot`
 * (de forma agnóstica de base — ver `resolverCaminhoDeAsset`), lê cada
 * arquivo e, para os `.js`, também procura por mais imports locais de
 * chunk para pegar chunks compartilhados (como o runtime do React) que o
 * HTML só referencia indiretamente via import dentro do JS. Nunca aceita
 * o HTML sozinho como "bundle completo", e lança erro (nunca passa em
 * silêncio) se um asset referenciado não existir em disco.
 */
function seguirGrafoDeAssets(htmlPath: string, distRoot: string): { path: string; conteudo: string }[] {
  const lidos = new Map<string, string>();
  const pendentes: string[] = [htmlPath];
  const visitados = new Set<string>();

  while (pendentes.length > 0) {
    const atual = pendentes.pop()!;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    if (!existsSync(atual)) {
      throw new Error(`Asset referenciado não encontrado no disco: ${atual}`);
    }
    const conteudo = readFileSync(atual, 'utf-8');
    lidos.set(atual, conteudo);

    if (atual.endsWith('.html')) {
      const refs = [
        ...conteudo.matchAll(/<script[^>]*\ssrc="([^"]+)"/g),
        ...conteudo.matchAll(/<link[^>]*\shref="([^"]+)"[^>]*rel="(?:stylesheet|modulepreload)"/g),
        ...conteudo.matchAll(/<link[^>]*rel="(?:stylesheet|modulepreload)"[^>]*\shref="([^"]+)"/g),
      ].map((m) => m[1]);
      for (const ref of refs) pendentes.push(resolverCaminhoDeAsset(ref, distRoot));
    } else if (atual.endsWith('.js')) {
      const imports = [...conteudo.matchAll(/from"([^"]+\.js)"/g), ...conteudo.matchAll(/import"([^"]+\.js)"/g)].map((m) => m[1]);
      for (const imp of imports) pendentes.push(resolverCaminhoDeAsset(imp, distRoot));
    }
  }

  return [...lidos.entries()].map(([path, conteudo]) => ({ path, conteudo }));
}

// ---------------------------------------------------------------------
// 4) Lista de permissão (allow-list) para os dados de fixtures — nunca
//    uma checagem de ausência de um valor real, sempre uma checagem de
//    presença de um valor fictício aprovado explicitamente.
// ---------------------------------------------------------------------

const ENDERECOS_FICTICIOS_PERMITIDOS = new Set([
  '100 Example St',
  '200 Placeholder Ave',
  '300 Fictional Ln',
  '400 Anyroad Dr',
  'Endereço de teste',
  'Endereço de teste 2',
]);
const CIDADES_FICTICIAS_PERMITIDAS = new Set(['Sample City, NH', 'Demo City, NH', 'Test City, NH', 'Model City, NH', 'Cidade de teste']);
const RESPONSAVEIS_FICTICIOS_PERMITIDOS = new Set(['Perfil de teste']);
const ORIGENS_TESTE_PERMITIDAS = new Set(['piloto-exemplo', '', undefined]);
const USUARIOS_FICTICIOS_PERMITIDOS = new Set(['gestor-demo', 'gestor-sem-config-demo']);

describe('Sanitização — auditoria programática sem nenhuma representação de dado real (nem hash, nem concatenação, nem codificação)', () => {
  it('TODO o código publicável desta demo (src/demo-os-cronograma/ inteiro, inclusive __tests__/) não contém nenhum padrão proibido (credencial/URL/ID)', () => {
    const arquivos = listarArquivos(DIR_FONTE);
    expect(arquivos.length).toBeGreaterThan(5); // a varredura tem que achar algo real — nunca passar "vazio" por engano
    const achados: string[] = [];
    for (const arq of arquivos) {
      const conteudo = readFileSync(arq, 'utf-8');
      for (const a of acharPadroesProibidos(conteudo, arq === ESTE_ARQUIVO)) achados.push(`${arq}: ${a}`);
    }
    expect(achados).toEqual([]);
  });

  it('demo-os-cronograma/index.html (entry point aditivo na raiz) não contém nenhum padrão proibido', () => {
    expect(existsSync(HTML_ENTRY)).toBe(true);
    const conteudo = readFileSync(HTML_ENTRY, 'utf-8');
    expect(acharPadroesProibidos(conteudo)).toEqual([]);
  });

  it('isolamento de imports: nenhum arquivo desta demo importa, por caminho relativo, nada fora de src/demo-os-cronograma/ — o cliente de rede real, a config real, o App real e o backend real (Code.gs) ficam estruturalmente inalcançáveis', () => {
    const arquivos = listarArquivos(DIR_FONTE);
    const achados: string[] = [];
    for (const arq of arquivos) {
      const conteudo = readFileSync(arq, 'utf-8');
      for (const spec of extrairEspecificadoresImport(conteudo)) {
        if (!spec.startsWith('.')) continue; // pacote externo (react, vitest, node:*, @testing-library/*, etc.) — não é risco de isolamento
        const resolvido = resolve(dirname(arq), spec);
        const dentro = resolvido === DIR_FONTE || resolvido.startsWith(DIR_FONTE + sep);
        if (!dentro) achados.push(`${arq}: importa "${spec}" (resolve para ${resolvido}, fora de ${DIR_FONTE})`);
      }
    }
    expect(achados).toEqual([]);
  });

  it('lista de permissão: todo endereço/cidade/responsável/origem de teste/usuário nas fixtures é um valor fictício aprovado explicitamente (prova por presença, nunca por ausência de um valor real)', () => {
    expect(DEMO_OS_FIXTURES.length).toBeGreaterThan(0);
    const achados: string[] = [];
    for (const os of DEMO_OS_FIXTURES) {
      if (os.Endereco && !ENDERECOS_FICTICIOS_PERMITIDOS.has(os.Endereco)) achados.push(`${os.OS}: Endereco "${os.Endereco}" não está na lista de permissão`);
      if (os.Cidade && !CIDADES_FICTICIAS_PERMITIDAS.has(os.Cidade)) achados.push(`${os.OS}: Cidade "${os.Cidade}" não está na lista de permissão`);
      if (os.Responsavel && !RESPONSAVEIS_FICTICIOS_PERMITIDOS.has(os.Responsavel)) achados.push(`${os.OS}: Responsavel "${os.Responsavel}" não está na lista de permissão`);
      if (!ORIGENS_TESTE_PERMITIDAS.has(os.OrigemTeste)) achados.push(`${os.OS}: OrigemTeste "${os.OrigemTeste}" não está na lista de permissão`);
    }
    for (const u of DEMO_USUARIOS) {
      if (!USUARIOS_FICTICIOS_PERMITIDOS.has(u.usuario)) achados.push(`usuário "${u.usuario}" não está na lista de permissão`);
    }
    expect(achados).toEqual([]);

    // Confirma também que os rótulos visíveis na UI e nos testes usam os
    // mesmos substitutos fictícios aprovados (prova que a sanitização
    // substituiu, não só apagou).
    const previaDemo = readFileSync(join(DIR_FONTE, 'PreviaDemo.tsx'), 'utf-8');
    expect(previaDemo).toContain('Gestor Demo'); // rótulo visível no seletor "Ver como"
    const authTest = readFileSync(join(DIR_FONTE, '__tests__', 'authorization.test.ts'), 'utf-8');
    expect(authTest).toContain('gestor-exemplo');
  });

  it('CHECAGEM MAIS FORTE — se já existe build (dist/), o GRAFO DE ASSETS efetivamente referenciado pela entrada da demo (HTML + todo JS/CSS que ele carrega, inclusive chunks compartilhados), resolvido de forma agnóstica de base, não contém nenhum padrão proibido', () => {
    if (!existsSync(DIST_HTML_ENTRY)) {
      console.warn('[sanitizacao.test.ts] dist/demo-os-cronograma/index.html ainda não existe — rode "npm run build" antes para a checagem mais forte.');
      return;
    }
    const assets = seguirGrafoDeAssets(DIST_HTML_ENTRY, DIST_ROOT);

    // Nunca aceitar só o HTML como "bundle completo" — tem que ter lido
    // pelo menos um .js de verdade (é onde a lógica/dados vivem).
    const arquivosJs = assets.filter((a) => a.path.endsWith('.js'));
    const arquivosCss = assets.filter((a) => a.path.endsWith('.css'));
    expect(assets.some((a) => a.path.endsWith('.html'))).toBe(true);
    expect(arquivosJs.length).toBeGreaterThan(0);
    expect(arquivosCss.length).toBeGreaterThan(0);
    for (const js of arquivosJs) expect(js.conteudo.length).toBeGreaterThan(0);

    const achados: string[] = [];
    for (const { path, conteudo } of assets) {
      for (const a of acharPadroesProibidos(conteudo)) achados.push(`${path}: ${a}`);
    }
    expect(achados).toEqual([]);

    // Evidência do que foi varrido (para o manifesto de entrega — não é
    // uma asserção, é um registro, impresso sempre que o build existe).
    console.log(
      '[sanitizacao.test.ts] grafo de assets varrido:\n' +
        assets.map((a) => `  - ${a.path} (${a.conteudo.length} bytes)`).join('\n')
    );
  });

  describe('grafo de assets — robustez de base (regressão: o GitHub Pages real deste repositório NÃO serve na raiz "/")', () => {
    it('segue corretamente o grafo quando o HTML referencia assets sob um base não-raiz (ex.: "/nome-do-repo/", como o GitHub Pages real produz) — usa um base SINTÉTICO, nunca o nome real do repositório', () => {
      const distTemp = mkdtempSync(join(tmpdir(), 'sanitizacao-base-'));
      try {
        const baseSintetico = '/exemplo-org/exemplo-repo/';
        mkdirSync(join(distTemp, 'demo-os-cronograma'), { recursive: true });
        mkdirSync(join(distTemp, 'assets'), { recursive: true });
        writeFileSync(
          join(distTemp, 'demo-os-cronograma', 'index.html'),
          `<!doctype html><html><head>
            <script type="module" src="${baseSintetico}assets/demo-fake.js"></script>
            <link rel="stylesheet" href="${baseSintetico}assets/demo-fake.css">
          </head><body></body></html>`,
          'utf-8'
        );
        writeFileSync(join(distTemp, 'assets', 'demo-fake.js'), 'console.log("fixture sintética de teste — sem dado real");', 'utf-8');
        writeFileSync(join(distTemp, 'assets', 'demo-fake.css'), 'body{color:#000}', 'utf-8');

        const assets = seguirGrafoDeAssets(join(distTemp, 'demo-os-cronograma', 'index.html'), distTemp);
        expect(assets.some((a) => a.path.endsWith('demo-fake.js') && a.conteudo.length > 0)).toBe(true);
        expect(assets.some((a) => a.path.endsWith('demo-fake.css') && a.conteudo.length > 0)).toBe(true);
      } finally {
        rmSync(distTemp, { recursive: true, force: true });
      }
    });

    it('lança erro (nunca passa em silêncio) quando um asset referenciado pelo HTML não existe em disco, mesmo sob um base não-raiz', () => {
      const distTemp = mkdtempSync(join(tmpdir(), 'sanitizacao-faltando-'));
      try {
        const baseSintetico = '/exemplo-org/exemplo-repo/';
        mkdirSync(join(distTemp, 'demo-os-cronograma'), { recursive: true });
        writeFileSync(
          join(distTemp, 'demo-os-cronograma', 'index.html'),
          `<!doctype html><html><head><script type="module" src="${baseSintetico}assets/nao-existe.js"></script></head><body></body></html>`,
          'utf-8'
        );
        expect(() => seguirGrafoDeAssets(join(distTemp, 'demo-os-cronograma', 'index.html'), distTemp)).toThrow(/não encontrado/);
      } finally {
        rmSync(distTemp, { recursive: true, force: true });
      }
    });

    it('detecta um padrão proibido (sintético, fabricado só no FORMATO de um ID real) dentro de um asset só alcançável seguindo o grafo sob um base não-raiz', () => {
      const distTemp = mkdtempSync(join(tmpdir(), 'sanitizacao-proibido-'));
      try {
        const baseSintetico = '/exemplo-org/exemplo-repo/';
        mkdirSync(join(distTemp, 'demo-os-cronograma'), { recursive: true });
        mkdirSync(join(distTemp, 'assets'), { recursive: true });
        writeFileSync(
          join(distTemp, 'demo-os-cronograma', 'index.html'),
          `<!doctype html><html><head><script type="module" src="${baseSintetico}assets/demo-fake.js"></script></head><body></body></html>`,
          'utf-8'
        );
        // Conteúdo inteiramente sintético/fabricado — nunca um ID real, só
        // no FORMATO de um ID de implantação do Apps Script.
        const idFalsoDeTeste = 'AKfycb' + 'x'.repeat(50);
        writeFileSync(join(distTemp, 'assets', 'demo-fake.js'), `const x = "${idFalsoDeTeste}";`, 'utf-8');

        const assets = seguirGrafoDeAssets(join(distTemp, 'demo-os-cronograma', 'index.html'), distTemp);
        const achados = assets.flatMap(({ path, conteudo }) => acharPadroesProibidos(conteudo).map((m) => `${path}: ${m}`));
        expect(achados.some((a) => a.includes('Apps Script'))).toBe(true);
      } finally {
        rmSync(distTemp, { recursive: true, force: true });
      }
    });
  });
});
