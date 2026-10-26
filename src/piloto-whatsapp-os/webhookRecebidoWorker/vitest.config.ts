// Config de teste ISOLADA deste subdiretório — nunca roda junto da suíte
// principal do repositório (que usa vitest 1.6.1/jsdom pela raiz). Executa
// os testes inteiramente DENTRO do runtime local de Workers (Miniflare),
// sem nenhuma conta Cloudflare, login ou deploy — ver README.md.
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // A guarda estrutural (semBackendRealWorker.test.ts) lê arquivos do disco
  // com node:fs — isso não funciona dentro do runtime de Workers (workerd),
  // que este plugin usa para todo o resto. Por isso ela roda separadamente,
  // em Node puro, via vitest.guard.config.ts — ver README.md e o script
  // "test" em package.json, que roda os dois.
  test: {
    exclude: ['**/node_modules/**', '**/__tests__/semBackendRealWorker.test.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // OVERRIDE SÓ DE TESTE (correção desta rodada) — `wrangler.jsonc`
      // (a config DISTRIBUÍDA, a que um deploy real usaria) agora declara
      // RECEPTOR_HABILITADO="false" por padrão (o estado seguro). Os
      // testes deste subpacote PRECISAM do receptor ligado para exercitar
      // o pipeline inteiro (proteções de entrada, antiabuso por
      // ordenação, etc.) — por isso ligamos aqui, só para a execução dos
      // testes, nunca no arquivo que descreve uma implantação real. Ver
      // wrangler.jsonc e README.md.
      miniflare: { bindings: { RECEPTOR_HABILITADO: 'true' } },
    }),
  ],
});
