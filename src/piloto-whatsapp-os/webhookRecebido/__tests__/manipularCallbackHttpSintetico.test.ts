// ISTO NÃO É UM RECEPTOR PUBLICADO (repetindo aqui o aviso de
// manipularCallbackHttpSintetico.ts): nenhum listener de rede é aberto por
// este teste ou pelo código que ele testa. É só a forma "requisição
// sintética entra, resposta sintética sai" exercitada inteiramente em
// processo, com fixtures fictícias.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmazenamentoDurabilidadeOfflineWebhook } from '../armazenamentoDurabilidadeOffline';
import { aplicarDecisaoIngestao } from '../aplicadorDeRascunhosWebhook';
import { mapearAplicacaoParaResposta, manipularCallbackWebhookRecebido } from '../manipularCallbackHttpSintetico';
import type { DecisaoIngestaoAutomatica } from '../tipos';
import { PAYLOAD_GRUPO_FICTICIO, PAYLOAD_IMAGEM_FICTICIO, PAYLOAD_TEXTO_PRIVADO_FICTICIO } from '../fixturesWebhookRecebido';

let dirTemp: string;
beforeEach(() => {
  dirTemp = mkdtempSync(join(tmpdir(), 'piloto-webhook-handler-teste-'));
});
afterEach(() => {
  rmSync(dirTemp, { recursive: true, force: true });
});

function novoArmazenamento(nomeArquivo = 'durabilidade.json') {
  return new ArmazenamentoDurabilidadeOfflineWebhook(join(dirTemp, nomeArquivo));
}

function requisicaoFicticia(corpoCru: string, cabecalhos: Record<string, string | undefined> = {}) {
  return { metodo: 'POST', cabecalhos, corpoCru };
}

describe('manipularCallbackWebhookRecebido — mensagem fictícia, caminho real completo', () => {
  it('mensagem de texto privado fictícia: 200, recebido_nao_elegivel (gate G1 fechado)', () => {
    const armazenamento = novoArmazenamento();
    const resposta = manipularCallbackWebhookRecebido(
      requisicaoFicticia(JSON.stringify(PAYLOAD_TEXTO_PRIVADO_FICTICIO), { 'x-cabecalho-ficticio': 'qualquer-valor' }),
      armazenamento
    );
    expect(resposta.status).toBe(200);
    expect(resposta.corpo.resultado).toBe('recebido_nao_elegivel');
    // Cabeçalho foi OBSERVADO (repassado), nunca usado para decidir nada.
    expect(resposta.cabecalhosObservados['x-cabecalho-ficticio']).toBe('qualquer-valor');
  });

  it('método diferente de POST: 405, não chega a processar o corpo', () => {
    const armazenamento = novoArmazenamento();
    const resposta = manipularCallbackWebhookRecebido({ metodo: 'GET', cabecalhos: {}, corpoCru: '' }, armazenamento);
    expect(resposta.status).toBe(405);
  });

  it('corpo que não é JSON válido: 400, nunca lança erro', () => {
    const armazenamento = novoArmazenamento();
    const resposta = manipularCallbackWebhookRecebido(requisicaoFicticia('{ isto não é json'), armazenamento);
    expect(resposta.status).toBe(400);
    expect(resposta.corpo.resultado).toBe('invalido');
  });

  it('grupo fictício: 200, resultado de quarentena (recebido com sucesso, fora de escopo)', () => {
    const armazenamento = novoArmazenamento();
    const resposta = manipularCallbackWebhookRecebido(requisicaoFicticia(JSON.stringify(PAYLOAD_GRUPO_FICTICIO)), armazenamento);
    expect(resposta.status).toBe(200);
    expect(resposta.corpo.resultado).toBe('quarentena_grupo_nao_suportado');
  });

  it('mídia fictícia: 200, resultado de quarentena (recebido com sucesso, fora de escopo)', () => {
    const armazenamento = novoArmazenamento();
    const resposta = manipularCallbackWebhookRecebido(requisicaoFicticia(JSON.stringify(PAYLOAD_IMAGEM_FICTICIO)), armazenamento);
    expect(resposta.status).toBe(200);
    expect(resposta.corpo.resultado).toBe('quarentena_tipo_de_conteudo_nao_suportado');
  });
});

describe('manipularCallbackWebhookRecebido — reentrega e restart, no NÍVEL DO HANDLER', () => {
  it('reentregar a MESMA requisição duas vezes não lança erro e devolve a mesma resposta as duas vezes', () => {
    const armazenamento = novoArmazenamento();
    const corpo = JSON.stringify(PAYLOAD_TEXTO_PRIVADO_FICTICIO);

    const primeira = manipularCallbackWebhookRecebido(requisicaoFicticia(corpo), armazenamento);
    const segunda = manipularCallbackWebhookRecebido(requisicaoFicticia(corpo), armazenamento);
    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(primeira.corpo.resultado).toBe(segunda.corpo.resultado);
  });

  it('restart no nível do handler: nova instância de armazenamento, mesmo arquivo, mesma requisição não quebra nem duplica nada', () => {
    const nomeArquivo = 'durabilidade-handler-restart.json';
    const corpo = JSON.stringify(PAYLOAD_TEXTO_PRIVADO_FICTICIO);

    const armazenamentoAntes = novoArmazenamento(nomeArquivo);
    manipularCallbackWebhookRecebido(requisicaoFicticia(corpo), armazenamentoAntes);

    const armazenamentoDepois = novoArmazenamento(nomeArquivo);
    const resposta = manipularCallbackWebhookRecebido(requisicaoFicticia(corpo), armazenamentoDepois);
    expect(resposta.status).toBe(200);
    expect(armazenamentoDepois.foiObservadoComoNaoElegivel(PAYLOAD_TEXTO_PRIVADO_FICTICIO.messageId)).toBe(true);
  });

  it('armazenamento corrompido: handler devolve 500, nunca finge sucesso', () => {
    const caminho = join(dirTemp, 'corrompido-handler.json');
    writeFileSync(caminho, 'json corrompido de propósito', 'utf8');
    const armazenamento = new ArmazenamentoDurabilidadeOfflineWebhook(caminho);

    const resposta = manipularCallbackWebhookRecebido(requisicaoFicticia(JSON.stringify(PAYLOAD_TEXTO_PRIVADO_FICTICIO)), armazenamento);
    expect(resposta.status).toBe(500);
    expect(resposta.corpo.resultado).toBe('armazenamento_corrompido');
  });
});

describe("SIMULAÇÃO explícita (SIMULACAO_APENAS_PARA_TESTE) — separada do caminho real bloqueado, mostra a forma de resposta HTTP de um rascunho pendente_aprovacao", () => {
  it('se decidirIngestaoAutomatica um dia devolvesse elegivel:true, esta é a resposta HTTP que o rascunho criado produziria — nunca alcançável pelo manipulador real hoje', () => {
    const armazenamento = novoArmazenamento();
    const decisaoSimulada_NUNCA_REAL: DecisaoIngestaoAutomatica = {
      elegivel: true,
      evento: {
        origem: 'webhook_w_api_callback_nao_autenticado',
        instanceId: 'instancia-ficticia-simulacao-http',
        connectedPhone: 'numero-ficticio-simulacao-http',
        messageId: 'msg-ficticio-simulacao-http-001',
        remetenteId: 'remetente-ficticio-simulacao-http',
        remetenteNome: 'Simulação HTTP Apenas De Teste',
        fromMe: false,
        momentoUnix: 1700000777,
        texto: 'Texto fictício só para testar o mapeamento de resposta HTTP — nunca um caminho real.',
        autenticidade: 'NAO_VERIFICADA',
      },
    };

    // Nota: isto chama `aplicarDecisaoIngestao` diretamente (não o handler
    // `manipularCallbackWebhookRecebido`, que nunca aceita uma decisão
    // injetada) e só reaproveita o MAPEAMENTO de resposta — exatamente para
    // nunca abrir, no handler real, um jeito de injetar uma decisão falsa.
    const aplicacao = aplicarDecisaoIngestao(decisaoSimulada_NUNCA_REAL, armazenamento);
    const resposta = mapearAplicacaoParaResposta(aplicacao, {});

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.resultado).toBe('recebido_rascunho_pendente_aprovacao');

    // Redelivery do caso simulado: dedup continua funcionando.
    const aplicacaoDuplicada = aplicarDecisaoIngestao(decisaoSimulada_NUNCA_REAL, armazenamento);
    const respostaDuplicada = mapearAplicacaoParaResposta(aplicacaoDuplicada, {});
    expect(respostaDuplicada.corpo.resultado).toBe('recebido_duplicado');
  });
});
