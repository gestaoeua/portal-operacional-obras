# Entrega local RSF OS — não publicada

Base: gestaoeua/portal-operacional-obras, commit c0f3833d529602621ce07035e7a831e4b6639ae6. Branch local: rsf-os-pilot-20261021.

## Reproduzir

1. Obter checkout do commit base e aplicar os arquivos de overlay do pacote, preservando caminhos relativos.
2. Instalar dependências da raiz com npm ci (ou pnpm install --frozen-lockfile --ignore-scripts). Node 24.19.0 foi usado localmente. Não precisa de credenciais de produção.
3. Em PowerShell, executar ./tests/run-local-checks.ps1. O script gera o candidato compatível e interrompe no primeiro erro. Testes usam somente contas e ordens fictícias.
4. Para navegador, em um terminal: definir RSF_OS_BACKEND_FILE=integration/Code.production-compatible.gs e executar node tests/local-os-fixtures.cjs. Em outro, definir VITE_RSF_CENTRAL_API_URL=http://127.0.0.1:8789 e VITE_RSF_FIXTURE_MODE=true; executar node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort.
5. Abrir http://127.0.0.1:5173/central/. O harness de teste contém as contas fictícias e a credencial sintética; nunca usar credenciais reais nesse servidor. Encerrar os dois processos após a validação. As fixtures são voláteis.

## Resultados finais

- 34 testes OS/API/UI passando contra integration/Code.production-compatible.gs.
- TypeScript sem erros e build Vite com três entradas: campo, central, demo.
- 220 testes Vitest da raiz passando após o build final.
- 19 guards do Worker passaram na instalação isolada do Worker.
- Os 79 testes de runtime Worker NÃO foram reproduzidos no Windows: falha de inicialização cloudflare:test-internal. O receptor continua desabilitado e não implantado.
- Chrome: criação, atribuição, todas as etapas, conclusão, reabertura, reload e recuperação dos 8 eventos. Evidência visual capturada no thread, sem dados reais.

## Arquivos centrais

- src/central/OsOperacional.tsx: interface funcional do ledger.
- src/central/App.tsx e central/index.html: central aditiva.
- integration/Code.production-compatible.gs: candidato aditivo com autenticação/operações antigas preservadas.
- apps-script/Code.gs: versão de desenvolvimento baseada na foundation; NÃO publicar silenciosamente, pois contém alterações de autenticação fora do escopo aprovado.
- docs/os-deployment-proposal.md: mudanças exatas propostas, autorização e rollback.
- docs/os-final-review.md: pareceres Claude/Gemini, avaliação independente e limites.

Não instalar dois arquivos que definem doPost no mesmo projeto Apps Script. Não copiar a fixture para produção. Não fazer push para main: o workflow existente publica dist automaticamente. Nenhuma aba, grant, deployment, OAuth, segredo ou produção foi alterado nesta entrega.

## Pendente para homologação

Autorização para OS_Acessos e OS_Eventos, grant explícito do piloto, identificação do projeto Apps Script/identidade de implantação e teste de leitura/escrita em Sheets real. Endpoint central novo ainda não criado. WhatsApp depende de autenticação de entrada comprovada e isolamento autorizado de remetente/projeto. O rótulo whatsapp_prep não autentica mensagens nem conecta o webhook ao ledger.
