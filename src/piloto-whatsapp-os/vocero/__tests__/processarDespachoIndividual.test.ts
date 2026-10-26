import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmazenamentoDurabilidadeOffline } from '../armazenamentoDurabilidadeOffline';
import { processarDespachoIndividual } from '../processarDespachoIndividual';
import {
  CABECALHOS_JSON_INVALIDO_FICTICIO,
  CORPO_CRU_JSON_INVALIDO_FICTICIO,
  DESPACHO_INDIVIDUAL_SO_IMAGEM_FICTICIO,
  DESPACHO_INDIVIDUAL_TEXTO_E_IMAGEM_FICTICIO,
  DESPACHO_INDIVIDUAL_TEXTO_FICTICIO,
  DESPACHO_MESSAGES_VAZIO_FICTICIO,
  DESPACHO_RAFAGA_COM_MENSAGEM_REPETIDA_FICTICIO,
  DESPACHO_SEM_CONTACT_FICTICIO,
  SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
} from '../fixturesVoceroFicticias';

// Cada teste usa seu próprio diretório temporário (fora do workspace do
// projeto, nunca em src/) para o arquivo de durabilidade do piloto — nunca
// o mesmo arquivo entre testes, exceto quando o próprio teste quer provar
// "restart" (reabrir deliberadamente o mesmo arquivo).
let dirTemp: string;
beforeEach(() => {
  dirTemp = mkdtempSync(join(tmpdir(), 'piloto-vocero-teste-'));
});
afterEach(() => {
  rmSync(dirTemp, { recursive: true, force: true });
});

function novoArmazenamento(nomeArquivo = 'durabilidade.json') {
  return new ArmazenamentoDurabilidadeOffline(join(dirTemp, nomeArquivo));
}

describe('processarDespachoIndividual — caminho feliz (dados fictícios)', () => {
  it('um despacho individual de texto válido produz um rascunho pendente_aprovacao, nunca uma OS real', () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('rascunho_criado');
    if (resultado.tipo !== 'rascunho_criado') throw new Error('esperado rascunho_criado');
    expect(resultado.rascunho.status).toBe('pendente_aprovacao');
    expect(resultado.rascunho.dispatchId).toBe('dsp-ficticio-001');
    expect(resultado.rascunho.mensagens).toHaveLength(1);
    expect(resultado.rascunho.mensagens[0].texto).toContain('prazo para pintura da fachada');
    expect(resultado.rascunho.midiasNaoProcessadas).toEqual([]);
    expect(resultado.rascunho.origem).toBe('vocero_despacho_individual_nao_autenticado_em_producao');
  });
});

describe('processarDespachoIndividual — duplicata por dispatchId (idempotência)', () => {
  it('reenviar o MESMO despacho (mesmo dispatchId) não cria um segundo rascunho', () => {
    const armazenamento = novoArmazenamento();
    const entrada = {
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    };
    const primeiro = processarDespachoIndividual(entrada);
    expect(primeiro.tipo).toBe('rascunho_criado');

    const segundo = processarDespachoIndividual(entrada);
    expect(segundo.tipo).toBe('duplicado');
    if (segundo.tipo !== 'duplicado') throw new Error('esperado duplicado');
    expect(segundo.dispatchId).toBe('dsp-ficticio-001');
  });
});

describe('processarDespachoIndividual — replay/restart (sobrevive a reabrir o processo)', () => {
  it('uma instância NOVA de armazenamento, apontando para o MESMO arquivo, ainda reconhece o dispatchId como já processado', () => {
    const nomeArquivo = 'durabilidade-restart.json';
    const armazenamentoAntesDoRestart = novoArmazenamento(nomeArquivo);
    const primeiro = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento: armazenamentoAntesDoRestart,
    });
    expect(primeiro.tipo).toBe('rascunho_criado');

    // Simula um restart: NOVA instância, mesmo caminho de arquivo em disco —
    // não reaproveita nada em memória da instância anterior.
    const armazenamentoDepoisDoRestart = novoArmazenamento(nomeArquivo);
    const consulta = armazenamentoDepoisDoRestart.dispatchJaProcessado('dsp-ficticio-001');
    expect(consulta.processado).toBe(true);

    const segundo = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento: armazenamentoDepoisDoRestart,
    });
    expect(segundo.tipo).toBe('duplicado');
  });
});

describe('processarDespachoIndividual — deduplicação de mensagem individual entre dispatchIds diferentes', () => {
  it('uma ráfaga seguinte que repete uma mensagem já vista (em outro dispatchId) só traz a mensagem genuinamente nova', () => {
    const armazenamento = novoArmazenamento();

    const primeiro = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(primeiro.tipo).toBe('rascunho_criado');

    // dispatchId diferente (dsp-ficticio-004), repete a mensagem
    // 'msg-ficticio-d1-a' do despacho 1 e traz uma mensagem nova de verdade.
    const segundo = processarDespachoIndividual({
      corpoCru: DESPACHO_RAFAGA_COM_MENSAGEM_REPETIDA_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_RAFAGA_COM_MENSAGEM_REPETIDA_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(segundo.tipo).toBe('rascunho_criado');
    if (segundo.tipo !== 'rascunho_criado') throw new Error('esperado rascunho_criado');
    // Só a mensagem nova aparece no rascunho — a repetida foi deduplicada por messages[].id.
    expect(segundo.rascunho.mensagens).toHaveLength(1);
    expect(segundo.rascunho.mensagens[0].id).toBe('msg-ficticio-d4-novo');
    expect(segundo.rascunho.mensagens[0].texto).toContain('fundos');
  });
});

describe('processarDespachoIndividual — assinatura inválida (fail-closed, nunca processa)', () => {
  it('assinatura ausente/inválida nunca gera rascunho, nunca lança', () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: { ...DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos, assinatura: 'sha256=' + '0'.repeat(64) },
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('assinatura_invalida');
    expect(armazenamento.dispatchJaProcessado('dsp-ficticio-001').processado).toBe(false);
  });

  it('sem segredo HMAC fornecido, fail-closed — nunca processa mesmo com assinatura "correta" aparente', () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos,
      segredoHmac: undefined,
      armazenamento,
    });
    expect(resultado.tipo).toBe('assinatura_invalida');
  });
});

describe('processarDespachoIndividual — entradas inválidas (nunca lança, nunca cria rascunho)', () => {
  it('JSON malformado no corpo cru → invalido', () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: CORPO_CRU_JSON_INVALIDO_FICTICIO,
      cabecalhos: CABECALHOS_JSON_INVALIDO_FICTICIO,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('invalido');
  });

  it("despacho sem 'contact' → invalido", () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_SEM_CONTACT_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_SEM_CONTACT_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('invalido');
  });

  it("despacho com 'messages' vazio → invalido", () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_MESSAGES_VAZIO_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_MESSAGES_VAZIO_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('invalido');
  });

  it('X-Vocero-Dispatch-Id do cabeçalho divergente do dispatchId do corpo → invalido', () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.corpoCru,
      cabecalhos: { ...DESPACHO_INDIVIDUAL_TEXTO_FICTICIO.cabecalhos, dispatchId: 'dsp-ficticio-outro-totalmente-diferente' },
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('invalido');
  });
});

describe('processarDespachoIndividual — mídia em quarentena (gate: texto-apenas, V2)', () => {
  it('despacho só com imagem (sem texto) → quarentena_sem_texto_processavel, nenhum rascunho criado', () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_SO_IMAGEM_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_SO_IMAGEM_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('quarentena_sem_texto_processavel');
    // O dispatchId fica marcado como processado (sem rascunho) — reenviar não reabre quarentena como se fosse novo.
    const consulta = armazenamento.dispatchJaProcessado('dsp-ficticio-002');
    expect(consulta.processado).toBe(true);
    if (!consulta.processado) throw new Error('esperado processado');
    expect(consulta.rascunhoId).toBeNull();
  });

  it('despacho com texto + imagem na mesma ráfaga → rascunho criado só com o texto; a imagem fica listada como mídia não processada', () => {
    const armazenamento = novoArmazenamento();
    const resultado = processarDespachoIndividual({
      corpoCru: DESPACHO_INDIVIDUAL_TEXTO_E_IMAGEM_FICTICIO.corpoCru,
      cabecalhos: DESPACHO_INDIVIDUAL_TEXTO_E_IMAGEM_FICTICIO.cabecalhos,
      segredoHmac: SEGREDO_HMAC_DE_TESTE_NUNCA_REAL,
      armazenamento,
    });
    expect(resultado.tipo).toBe('rascunho_criado');
    if (resultado.tipo !== 'rascunho_criado') throw new Error('esperado rascunho_criado');
    expect(resultado.rascunho.mensagens).toHaveLength(1);
    expect(resultado.rascunho.mensagens[0].texto).toContain('Segue uma foto');
    expect(resultado.rascunho.midiasNaoProcessadas).toEqual(['media-ficticio-002']);
  });
});
