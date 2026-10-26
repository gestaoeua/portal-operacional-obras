# Revisão final local — 21 outubro 2026

## Participação e pareceres

Claude implementou a primeira versão do ledger e seus testes na sessão https://claude.ai/chat/60750fab-bdd2-8420-bd2f-a8d7d753e240. A compactação interrompeu o progresso; Codex corrigiu a implementação, construiu a interface e separou o app de campo. Claude terminou posteriormente a compactação e fez revisão textual dos arquivos finais: não apontou novo bloqueador de backend/UI, apontando ajustes documentais (comentário do gate pré-lock e variável de ambiente). Ambos foram corrigidos. A visão legada WorkOrders permanece como referência, fora da navegação operacional; não se atribui projeto às OS legadas implicitamente.

Gemini revisou trechos de código e o desenho em https://gemini.google.com/app/3fbe09f8ef4d1890. Confirmou a necessidade de revalidar grant sob lock e rejeitar destinos inválidos de reabertura. Após as correções, verificou pelo trecho de UI que o retry reutiliza o comando imutável, campos/navegação ficam bloqueados em incerteza, erros determinísticos preservam o formulário e respostas incompletas não são tratadas como sucesso.

Avaliação independente das observações finais do Gemini:

- A alegação de que session.token seria acessado antes do try não se confirmou: o acesso estava dentro do try. Ainda assim, os setters iniciais foram movidos para dentro dele para tornar a estrutura inequívoca.
- O risco de resposta assíncrona após desmontagem foi tratado com a geração da consulta: sucesso, erro e finalização só atualizam a UI se a geração ainda corresponde. Não se cancela nem se presume revertida uma gravação já enviada.
- Revogação de acesso ao projeto agora limpa ordens, responsáveis e detalhe previamente carregados.
- Codex identificou adicionalmente HTTP 503/JSON inválido após possível persistência. REQUEST_FAILED conserva o comando para reconciliação; teste reproduz HTTP 503 depois de gravar e verifica que o retry não duplica.

Nenhum parecer equivale a validação de produção. Gemini não executou os testes locais; Codex executou e conferiu seus resultados.

## Persistência e limites

OS_Eventos é a única gravação de cada comando. Falha antes de append e falha de flush depois de append são cobertas por testes com o mesmo RequestId; o servidor deduplica antes de avaliar o estado já avançado. UUID, comando canônico, projeto e ator impedem reutilização indevida do identificador. Sessão atual e grant são revalidados antes de replay. A revisão esperada é obrigatória em mudanças de OS existentes.

O lock serializa somente chamadas deste Apps Script. Não impede edição manual por proprietários/editores da planilha, nem outro projeto Apps Script escrevendo diretamente nas mesmas abas. É necessário manter um único escritor do ledger e conferir a política de edição antes da homologação. Nenhuma proteção/permissão real foi alterada.

O ledger faz leituras integrais e valida a sequência do projeto; não foi submetido a benchmark real do Google Sheets. Não se deve inferir latência, capacidade ou segurança de quota a partir dos testes Node. A corrupção de um evento falha fechado e pode bloquear o projeto até reconciliação administrativa.

O candidato compatível mantém o comportamento de autenticação legado solicitado. As rotas antigas não recebem silenciosamente a revalidação de conta das novas rotas OS. Não há alteração de senha, algoritmo MP|+SHA256, formato do cache legado ou TTL de seis horas.

Comando incerto fica em memória, sem credenciais ou rascunhos em storage do navegador. O operador deve reconciliar antes de fechar a aba. Ignorar o aviso de saída perde o comando volátil; usar o RequestId exibido e o histórico para reconciliação antes de criar outra OS.

## Evidência visual

Chrome foi operado por CUA em http://127.0.0.1:5173/central/ com backend de fixtures em 127.0.0.1:8789. Fluxo completo atingiu revisão 8, incluindo conclusão e reabertura. Após reload completo e novo login fictício, a OS e os oito eventos reapareceram. Screenshot integral foi capturado no thread, com banner AMBIENTE DE TESTE, dados fictícios e WhatsApp não integrado. O servidor de fixtures é volátil: isso prova recuperação após recarga do cliente, não durabilidade após reinício do servidor nem persistência real no Sheets.

## Identificação somente leitura do deployment existente

src/config.ts no commit base aponta para:
https://script.google.com/macros/s/AKfycbwcgH3vyBcIUPxLz5KWSF5m_F6WjwPJLATfJcMNjEWdfAyBPdty28SogjwFYkV5lz6a/exec

Não foi chamado esse endpoint nem lido qualquer valor operacional. Não existe .clasp.json no checkout; o Apps Script project ID e a identidade de implantação não foram confirmados. O workflow GitHub Pages publica dist em push para main. Portanto, não fazer push/merge antes da autorização explícita e validação da URL central. O endpoint novo proposto ainda não existe.
