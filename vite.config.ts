import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path para o GitHub Pages.
//
// Quando o build roda dentro do GitHub Actions, a variável de ambiente
// GITHUB_REPOSITORY já vem preenchida como "usuario/nome-do-repo", então
// calculamos o base automaticamente — não é preciso editar nada aqui na
// maioria dos casos.
//
// Exceção: se o repositório for do tipo "usuario.github.io" (página raiz
// do usuário/organização), o base deve ser "/" (é o que o código abaixo já
// faz automaticamente).
//
// Rodando localmente (npm run dev / npm run build fora do Actions) o base
// cai para "/".
function resolveBase(): string {
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repo) return '/';
  if (repo.toLowerCase().endsWith('.github.io')) return '/';
  return `/${repo}/`;
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
