// Guarda de sanitização para este módulo isolado — mesmo princípio usado em
// src/demo-os-cronograma/__tests__/sanitizacao.test.ts: padrões GERAIS de
// formato (nunca o valor de uma credencial específica), para pegar
// qualquer credencial real que viesse a ser colada por engano neste piloto
// ainda-não-conectado.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR_FONTE = resolve(__dirname, '..');

const PADRAO_APPS_SCRIPT_DEPLOY_ID = /AKfycb[A-Za-z0-9_-]{40,}/;
// Qualquer URL http(s) de verdade é suspeita aqui — este módulo não tem
// nenhuma integração real, então toda referência deveria ser só texto
// (nome do provedor em comentário) ou uma fixture claramente rotulada
// (contendo "exemplo"/"fixture"), nunca uma URL navegável de fato.
const PADRAO_URL_REAL = /https?:\/\/(?!\S*(?:exemplo|fixture))\S+/i;

// CORREÇÃO (rodada W-API/Durable Objects, 2026-10-20): este módulo passou a
// ter um subpacote NPM isolado (`webhookRecebidoWorker/`, node_modules e
// lockfile próprios — ver seu README.md) para testar uma adaptação
// Cloudflare Workers localmente. `node_modules/` é código de TERCEIROS
// (dependências vendorizadas, nunca escrito por nós) e nunca deveria ser
// varrido por este scanner — ele sempre existiu para pegar credencial/URL
// colada por engano em código NOSSO; por isso continua ignorado abaixo.
//
// CORREÇÃO (revisão independente final desta rodada): uma versão anterior
// deste arquivo, nesta mesma rodada, ignorava QUALQUER `.d.ts` — amplo
// demais, já que um `.d.ts` escrito à mão (não gerado por ferramenta)
// deveria continuar sendo varrido normalmente. Agora só o arquivo GERADO
// específico (`webhookRecebidoWorker/worker-configuration.d.ts`, saída de
// `wrangler types`, reproduzível por comando — ver README.md do subpacote;
// contém links de documentação da Cloudflare/MDN no cabeçalho, não um
// endpoint/credencial deste piloto) é ignorado por CAMINHO EXATO, nunca por
// extensão — qualquer outro `.d.ts` deste módulo continua sendo varrido
// como qualquer outro arquivo `.ts`.
//
// Nota de escopo: além destes comentários, as duas linhas de exclusão em
// `tsconfig.json`/`vite.config.ts` da raiz (ver README.md do subpacote) e
// este arquivo de teste são as ÚNICAS mudanças desta rodada fora de
// `src/piloto-whatsapp-os/` em si — o resto do repositório (R3, apps-script,
// demo-os-cronograma) não foi tocado.
const ARQUIVO_GERADO_IGNORADO = join(DIR_FONTE, 'webhookRecebidoWorker', 'worker-configuration.d.ts');

function listarArquivos(dir: string): string[] {
  const resultado: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules') continue;
    const caminho = join(dir, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) resultado.push(...listarArquivos(caminho));
    else resultado.push(caminho);
  }
  return resultado;
}

describe('Piloto WhatsApp→OS — nenhum dado real, nenhum endpoint real, nenhuma credencial', () => {
  it('nenhum arquivo deste módulo contém um ID de implantação real do Apps Script nem uma URL http(s) navegável de fato', () => {
    const arquivos = listarArquivos(DIR_FONTE).filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && f !== ARQUIVO_GERADO_IGNORADO
    );
    expect(arquivos.length).toBeGreaterThan(3);
    const achados: string[] = [];
    for (const arq of arquivos) {
      const conteudo = readFileSync(arq, 'utf-8');
      if (PADRAO_APPS_SCRIPT_DEPLOY_ID.test(conteudo)) achados.push(`${arq}: contém um ID de implantação do Apps Script`);
      if (PADRAO_URL_REAL.test(conteudo)) achados.push(`${arq}: contém uma URL http(s) que não é claramente de exemplo/fixture`);
    }
    expect(achados).toEqual([]);
  });
});
