// Guarda ESTRUTURAL: prova, programaticamente, que o submódulo
// `webhookRecebido/` (autenticidade sempre 'NAO_VERIFICADA' — ver tipos.ts)
// nunca é conectado, neste código, a um backend real de persistência nem faz
// qualquer chamada de rede. Uso é só em testes/simulação offline — ligar a
// um backend real é um passo futuro deliberadamente NÃO feito aqui.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR_WEBHOOK_RECEBIDO = resolve(__dirname, '..');

function listarArquivosDeProducao(dir: string): string[] {
  const resultado: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) {
      if (nome === '__tests__') continue; // só código de produção, não os próprios testes
      resultado.push(...listarArquivosDeProducao(caminho));
    } else if (caminho.endsWith('.ts')) {
      resultado.push(caminho);
    }
  }
  return resultado;
}

const PADROES_DE_REDE_OU_PERSISTENCIA_REAL = [
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\bhttp\.request\b/,
  /\bhttps\.request\b/,
  /\bXMLHttpRequest\b/,
  /\bUrlFetchApp\b/, // forma do Google Apps Script de fazer chamada de rede real
  /\bWebSocket\b/,
];

describe('webhookRecebido — nunca conectado a backend real/persistência (correção de segurança, verificação estrutural)', () => {
  const arquivos = listarArquivosDeProducao(DIR_WEBHOOK_RECEBIDO);

  it('existe mais de um arquivo de produção para a varredura fazer sentido', () => {
    expect(arquivos.length).toBeGreaterThan(3);
  });

  it('nenhum arquivo de produção deste submódulo contém um padrão de chamada de rede real', () => {
    const achados: string[] = [];
    for (const arq of arquivos) {
      const conteudo = readFileSync(arq, 'utf-8');
      for (const padrao of PADROES_DE_REDE_OU_PERSISTENCIA_REAL) {
        if (padrao.test(conteudo)) achados.push(`${arq}: padrão de rede encontrado (${padrao})`);
      }
    }
    expect(achados).toEqual([]);
  });

  it('nenhum arquivo de produção deste submódulo importa o criador de rascunhos NÃO RELACIONADO da raiz do piloto (aplicadorDeRascunhos.ts, pipeline fictício diferente, sem gate de elegibilidade) — só o aplicador LOCAL (aplicadorDeRascunhosWebhook.ts, gateado) pode existir aqui (correção de arquitetura, retomada 2026-10-20: este submódulo passou a ter um aplicador próprio, deliberadamente)', () => {
    const achados: string[] = [];
    for (const arq of arquivos) {
      const conteudo = readFileSync(arq, 'utf-8');
      // 'aplicadorDeRascunhos' seguido de 'Webhook' é o aplicador LOCAL, gateado — permitido.
      // 'aplicadorDeRascunhos' SEM o sufixo 'Webhook' seria o da raiz do piloto — nunca permitido aqui.
      const referencias = conteudo.match(/aplicadorDeRascunhos(?!Webhook)/gi) ?? [];
      if (referencias.length > 0) achados.push(`${arq}: referencia aplicadorDeRascunhos não-local (${referencias.length}x)`);
    }
    expect(achados).toEqual([]);
  });

  it('o aplicador LOCAL de rascunhos (aplicadorDeRascunhosWebhook.ts) nunca decide elegibilidade sozinho — não importa/chama decidirIngestaoAutomatica, só reage a uma DecisaoIngestaoAutomatica já pronta', () => {
    const arquivoAplicador = arquivos.find((a) => a.endsWith('aplicadorDeRascunhosWebhook.ts'));
    expect(arquivoAplicador, 'aplicadorDeRascunhosWebhook.ts deveria existir para esta verificação fazer sentido').toBeDefined();
    const conteudo = readFileSync(arquivoAplicador!, 'utf-8');
    expect(conteudo).not.toMatch(/decidirIngestaoAutomatica\s*\(/);
    // Prova estrutural do gate: o caminho de criação de rascunho só é alcançado depois de checar `!decisao.elegivel` e retornar cedo.
    expect(conteudo).toMatch(/if\s*\(\s*!decisao\.elegivel\s*\)/);
  });

  it("nenhum arquivo de produção deste submódulo contém um rótulo 'SIMULACAO' — simulações de elegivel:true vivem só em código de teste, nunca em produção", () => {
    const achados: string[] = [];
    for (const arq of arquivos) {
      const conteudo = readFileSync(arq, 'utf-8');
      if (/SIMULACAO/i.test(conteudo)) achados.push(`${arq}: contém rótulo SIMULACAO`);
    }
    expect(achados).toEqual([]);
  });

  it('a decisão de ingestão automática nunca usa um valor de autenticidade diferente de NAO_VERIFICADA em código de produção (nenhuma atribuição literal a outro valor)', () => {
    const achados: string[] = [];
    for (const arq of arquivos) {
      const conteudo = readFileSync(arq, 'utf-8');
      // procura qualquer string literal de autenticidade que não seja 'NAO_VERIFICADA'
      const literais = conteudo.match(/autenticidade\s*:\s*'([A-Z_]+)'/g) ?? [];
      for (const literal of literais) {
        if (!literal.includes("'NAO_VERIFICADA'")) achados.push(`${arq}: ${literal}`);
      }
    }
    expect(achados).toEqual([]);
  });
});
