// Config SEPARADA, em Node puro (sem o runtime de Workers), só para a
// guarda estrutural `semBackendRealWorker.test.ts` — que lê arquivos do
// disco com node:fs, algo que não está disponível dentro do workerd usado
// pela config principal (vitest.config.ts). Ver README.md.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/semBackendRealWorker.test.ts'],
  },
});
