import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The recovered central uses node:test. Keep it out of Vitest collection.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/piloto-whatsapp-os/webhookRecebidoWorker/**'],
  },
});
