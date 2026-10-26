// Testes do Durable Object de deduplicação, rodando DENTRO do runtime real
// de Workers local (Miniflare, via @cloudflare/vitest-plugin) — nenhuma
// conta Cloudflare, nenhum login, nenhum deploy. Ver README.md para os
// comandos exatos e as fontes oficiais consultadas para este desenho.
//
// IMPORTANTE (revisão independente nº2 deste subpacote): `obterStub` abaixo
// usa SEMPRE `codificarChaveCompostaDedup`, a MESMA função usada por
// `worker.ts` em produção — nunca uma string de chave montada à mão aqui.
// É isso que garante que estes testes provam o comportamento REAL de
// produção (inclusive o bug de ambiguidade de delimitador corrigido nesta
// rodada), não um comportamento particular só deste arquivo de teste.
import { env, evictDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { RascunhoOSWebhookRecebido } from '../../webhookRecebido/tipos';
import { codificarChaveCompostaDedup } from '../chaveCompostaDedup';

function rascunhoValido(instanceId: string, messageId: string): RascunhoOSWebhookRecebido {
  return {
    origem: 'webhook_w_api_callback_nao_autenticado',
    messageId,
    instanceId,
    remetenteId: 'remetente-teste-do',
    remetenteNome: 'Remetente Teste DO',
    texto: 'Texto fictício só para exercitar o Durable Object de deduplicação.',
    momentoUnix: 1700000900,
    status: 'pendente_aprovacao',
  };
}

function obterStub(instanceId: string, messageId: string) {
  const id = env.DEDUP_DO.idFromName(codificarChaveCompostaDedup(instanceId, messageId));
  return env.DEDUP_DO.get(id);
}

describe('DedupDurableObject — aplicação efetiva: primeira vez cria, redelivery sequencial não duplica', () => {
  it('primeira chamada aplica; segunda chamada (mesma chave) com o mesmo rascunho devolve duplicado, nunca recria', async () => {
    const stub = obterStub('instancia-teste-do', 'msg-sequencial-001');
    const rascunho = rascunhoValido('instancia-teste-do', 'msg-sequencial-001');

    const primeira = await stub.registrarAplicacaoSeNaoDuplicado(rascunho);
    expect(primeira.tipo).toBe('aplicado');

    const segunda = await stub.registrarAplicacaoSeNaoDuplicado(rascunho);
    expect(segunda.tipo).toBe('duplicado');
    if (segunda.tipo === 'duplicado') {
      expect(segunda.rascunho).toEqual(rascunho);
    }
  });

  it('rascunho com forma inválida (texto não é string) é recusado — erro_validacao, nunca persistido', async () => {
    const stub = obterStub('instancia-teste-do', 'msg-invalido-001');
    const resultado = await stub.registrarAplicacaoSeNaoDuplicado({
      ...rascunhoValido('instancia-teste-do', 'msg-invalido-001'),
      texto: 12345,
    });
    expect(resultado.tipo).toBe('erro_validacao');

    const consulta = await stub.consultarAplicacao();
    expect(consulta.situacao).toBe('nao_aplicado');
  });
});

describe('DedupDurableObject — CONCORRÊNCIA REAL: duas chamadas disparadas ao mesmo tempo contra o MESMO stub', () => {
  it('Promise.all com duas chamadas concorrentes para o mesmo messageId: exatamente UMA aplica, a outra vê duplicado — nunca as duas aplicam', async () => {
    const stub = obterStub('instancia-teste-do', 'msg-concorrente-001');
    const rascunho = rascunhoValido('instancia-teste-do', 'msg-concorrente-001');

    const [r1, r2] = await Promise.all([
      stub.registrarAplicacaoSeNaoDuplicado(rascunho),
      stub.registrarAplicacaoSeNaoDuplicado(rascunho),
    ]);

    const tipos = [r1.tipo, r2.tipo].sort();
    // Afirmação central deste teste: NUNCA os dois são 'aplicado'. Exatamente
    // um 'aplicado' e um 'duplicado' — o input gate do Durable Object serializa
    // a leitura+escrita de cada chamada (ver comentário de cabeçalho em
    // durableObjectDedup.ts e fontes oficiais citadas no README.md).
    expect(tipos).toEqual(['aplicado', 'duplicado']);

    const consultaFinal = await stub.consultarAplicacao();
    expect(consultaFinal.situacao).toBe('aplicado');
  });

  it('dez chamadas concorrentes (Promise.all) para o mesmo messageId: exatamente uma aplica, nove veem duplicado', async () => {
    const stub = obterStub('instancia-teste-do', 'msg-concorrente-dez-001');
    const rascunho = rascunhoValido('instancia-teste-do', 'msg-concorrente-dez-001');

    const resultados = await Promise.all(Array.from({ length: 10 }, () => stub.registrarAplicacaoSeNaoDuplicado(rascunho)));
    const aplicados = resultados.filter((r): r is Extract<typeof r, { tipo: 'aplicado' }> => r.tipo === 'aplicado');
    const duplicados = resultados.filter((r): r is Extract<typeof r, { tipo: 'duplicado' }> => r.tipo === 'duplicado');
    expect(aplicados.length).toBe(1);
    expect(duplicados.length).toBe(9);
  });
});

describe('DedupDurableObject — observação não-elegível NUNCA envenena a aplicação efetiva', () => {
  it('registrar só uma observação não-elegível: consultarAplicacao continua nao_aplicado', async () => {
    const stub = obterStub('instancia-teste-do', 'msg-so-observado-001');
    const registro = await stub.registrarObservacaoNaoElegivel('gate G1 fechado — autenticidade NAO_VERIFICADA, fictício de teste');
    expect(registro.ok).toBe(true);

    expect(await stub.foiObservadoComoNaoElegivel()).toBe(true);
    const consulta = await stub.consultarAplicacao();
    expect(consulta.situacao).toBe('nao_aplicado');
  });

  it('depois de aplicar de verdade, registrar uma observação (mesma chave, hipótese artificial) não apaga a aplicação já efetivada', async () => {
    const stub = obterStub('instancia-teste-do', 'msg-aplicado-depois-observado-001');
    const rascunho = rascunhoValido('instancia-teste-do', 'msg-aplicado-depois-observado-001');
    await stub.registrarAplicacaoSeNaoDuplicado(rascunho);

    await stub.registrarObservacaoNaoElegivel('observação artificial só para provar isolamento das duas chaves de storage');

    const consulta = await stub.consultarAplicacao();
    expect(consulta.situacao).toBe('aplicado');
  });
});

describe('DedupDurableObject — identidade de roteamento sem ambiguidade (revisão independente nº2)', () => {
  it('mesmo messageId, instanceId DIFERENTE → Durable Objects diferentes: aplicar numa instância nunca aparece como aplicado na outra', async () => {
    const stubA = obterStub('instancia-A', 'msg-compartilhado-001');
    const stubB = obterStub('instancia-B', 'msg-compartilhado-001');

    const rascunhoA = rascunhoValido('instancia-A', 'msg-compartilhado-001');
    const aplicacaoA = await stubA.registrarAplicacaoSeNaoDuplicado(rascunhoA);
    expect(aplicacaoA.tipo).toBe('aplicado');

    const consultaB = await stubB.consultarAplicacao();
    expect(consultaB.situacao).toBe('nao_aplicado');

    // Coerência: o rascunho devolvido pela chave A continua sendo o da
    // própria instância A — nunca um vazamento vindo da instância B.
    const consultaA = await stubA.consultarAplicacao();
    expect(consultaA.situacao).toBe('aplicado');
    if (consultaA.situacao === 'aplicado') {
      expect(consultaA.rascunho.instanceId).toBe('instancia-A');
      expect(consultaA.rascunho.messageId).toBe('msg-compartilhado-001');
    }
  });

  it('mesma instanceId, messageId DIFERENTE → Durable Objects diferentes: aplicar numa mensagem nunca aparece como aplicado na outra', async () => {
    const stubX = obterStub('instancia-mesma', 'msg-X');
    const stubY = obterStub('instancia-mesma', 'msg-Y');

    await stubX.registrarAplicacaoSeNaoDuplicado(rascunhoValido('instancia-mesma', 'msg-X'));
    const consultaY = await stubY.consultarAplicacao();
    expect(consultaY.situacao).toBe('nao_aplicado');

    const consultaX = await stubX.consultarAplicacao();
    expect(consultaX.situacao).toBe('aplicado');
    if (consultaX.situacao === 'aplicado') {
      expect(consultaX.rascunho.messageId).toBe('msg-X');
    }
  });

  it("CASO DE COLISÃO DO DELIMITADOR: ('a::b','c') e ('a','b::c') nunca podem cair no mesmo Durable Object — a concatenação ingênua '${instanceId}::${messageId}' usada antes desta correção colidiria aqui; a codificação JSON usada agora não", async () => {
    const chaveUm = codificarChaveCompostaDedup('a::b', 'c');
    const chaveDois = codificarChaveCompostaDedup('a', 'b::c');
    // Prova direta, sem depender do runtime: as duas chaves CODIFICADAS são
    // diferentes (a concatenação ingênua '${instanceId}::${messageId}'
    // produziria 'a::b::c' para AMBOS os pares).
    expect(chaveUm).not.toBe(chaveDois);

    const stubUm = obterStub('a::b', 'c');
    const stubDois = obterStub('a', 'b::c');

    const rascunhoUm = rascunhoValido('a::b', 'c');
    const aplicacaoUm = await stubUm.registrarAplicacaoSeNaoDuplicado(rascunhoUm);
    expect(aplicacaoUm.tipo).toBe('aplicado');

    // Se a codificação fosse ambígua (bug corrigido nesta rodada), isto já
    // apareceria como "aplicado" (mesmo Durable Object físico da chamada
    // acima). Tem que ser "nao_aplicado", provando que são DOIS Durable
    // Objects de verdade, endereçados no runtime real.
    const consultaDoisAntes = await stubDois.consultarAplicacao();
    expect(consultaDoisAntes.situacao).toBe('nao_aplicado');

    const rascunhoDois = rascunhoValido('a', 'b::c');
    const aplicacaoDois = await stubDois.registrarAplicacaoSeNaoDuplicado(rascunhoDois);
    expect(aplicacaoDois.tipo).toBe('aplicado');

    // Coerência final: cada stub devolve o rascunho com os PRÓPRIOS
    // instanceId/messageId — nunca um cruzamento entre os dois pares.
    const consultaFinalUm = await stubUm.consultarAplicacao();
    const consultaFinalDois = await stubDois.consultarAplicacao();
    expect(consultaFinalUm).toEqual({ situacao: 'aplicado', rascunho: rascunhoUm });
    expect(consultaFinalDois).toEqual({ situacao: 'aplicado', rascunho: rascunhoDois });
  });
});

describe('DedupDurableObject — restart/recuperação (evictDurableObject: descarta a instância em memória, mantém o storage SQLite)', () => {
  it('depois de evictDurableObject, um NOVO stub para a MESMA chave recupera o OBJETO COMPLETO (comparação profunda), e redelivery com payload diferente nunca sobrescreve o original', async () => {
    const stubAntes = obterStub('instancia-teste-do', 'msg-restart-001');
    const rascunho = rascunhoValido('instancia-teste-do', 'msg-restart-001');
    const aplicacao = await stubAntes.registrarAplicacaoSeNaoDuplicado(rascunho);
    expect(aplicacao.tipo).toBe('aplicado');

    await evictDurableObject(stubAntes);

    const stubDepois = obterStub('instancia-teste-do', 'msg-restart-001');
    // Comparação PROFUNDA do objeto inteiro (não só um campo de texto) —
    // prova que o restart recupera o rascunho completo, campo a campo, não
    // um fragmento/marcador.
    const consulta = await stubDepois.consultarAplicacao();
    expect(consulta).toEqual({ situacao: 'aplicado', rascunho });

    // Redelivery pós-"restart" com o MESMO payload: dedup continua
    // funcionando, não recria.
    const redelivery = await stubDepois.registrarAplicacaoSeNaoDuplicado(rascunho);
    expect(redelivery.tipo).toBe('duplicado');

    // Redelivery com payload DIFERENTE na MESMA chave (ex.: reenvio com
    // outro texto por qualquer motivo): o PRIMEIRO rascunho persistido
    // nunca é sobrescrito — a resposta de duplicado devolve o original, e
    // uma consulta posterior confirma que nada mudou.
    const rascunhoComOutroTexto: RascunhoOSWebhookRecebido = {
      ...rascunho,
      texto: 'texto diferente — nunca deveria sobrescrever o rascunho original já aplicado',
    };
    const redeliveryComPayloadDiferente = await stubDepois.registrarAplicacaoSeNaoDuplicado(rascunhoComOutroTexto);
    expect(redeliveryComPayloadDiferente.tipo).toBe('duplicado');
    if (redeliveryComPayloadDiferente.tipo === 'duplicado') {
      expect(redeliveryComPayloadDiferente.rascunho).toEqual(rascunho);
    }

    const consultaFinal = await stubDepois.consultarAplicacao();
    expect(consultaFinal).toEqual({ situacao: 'aplicado', rascunho });
  });
});

describe('DedupDurableObject — falha REAL de gravação durante a aplicação efetiva, nunca mockada (revisão independente nº2)', () => {
  it('um rascunho cujo campo texto excede o limite real de armazenamento do runtime local (erro genuíno do workerd/Miniflare — não uma falha injetada/mockada, nenhum método de teste no artefato de produção) falha explicitamente com erro_gravacao, nunca fica como rascunho parcial/órfão, e uma nova tentativa com um rascunho válido (mesma chave) aplica normalmente depois', async () => {
    const instanceId = 'instancia-falha-gravacao';
    const messageId = 'msg-falha-gravacao-001';
    const stub = obterStub(instanceId, messageId);

    // 20 milhões de caracteres: um valor de PRODUÇÃO legítimo (o schema de
    // `texto` não limita tamanho — ver validarRascunhoParaPersistir em
    // durableObjectDedup.ts), só que grande o bastante para que o runtime
    // LOCAL de verdade (workerd/Miniflare, via @cloudflare/vitest-plugin)
    // recuse a gravação com um erro real de storage. Verificado
    // experimentalmente nesta rodada: entre 8.000.000 e 10.000.000 de
    // caracteres o runtime local passa a recusar a gravação; 20.000.000 dá
    // margem folgada. A documentação oficial do limite por valor (ver
    // README.md, seção de fontes) não confirma se esse limite é aplicado no
    // runtime LOCAL — por isso este número vem de observação direta deste
    // runtime nesta rodada, não da documentação.
    const rascunhoDemasiadoGrande: RascunhoOSWebhookRecebido = {
      ...rascunhoValido(instanceId, messageId),
      texto: 'x'.repeat(20_000_000),
    };

    const resultadoFalha = await stub.registrarAplicacaoSeNaoDuplicado(rascunhoDemasiadoGrande);
    expect(resultadoFalha.tipo).toBe('erro_gravacao');

    // Nenhum rascunho parcial/órfão: a MESMA chave, consultada de verdade
    // logo depois, continua "nao_aplicado" — a falha de escrita não deixou
    // nenhum vestígio visível.
    const consultaDepoisDaFalha = await stub.consultarAplicacao();
    expect(consultaDepoisDaFalha.situacao).toBe('nao_aplicado');

    // Retry com um rascunho válido, MESMA chave: aplica normalmente, como
    // se a tentativa anterior nunca tivesse acontecido.
    const rascunhoValidoRetry = rascunhoValido(instanceId, messageId);
    const resultadoRetry = await stub.registrarAplicacaoSeNaoDuplicado(rascunhoValidoRetry);
    expect(resultadoRetry.tipo).toBe('aplicado');

    const consultaFinal = await stub.consultarAplicacao();
    expect(consultaFinal).toEqual({ situacao: 'aplicado', rascunho: rascunhoValidoRetry });
  });
});

describe('DedupDurableObject — limparRegistrosMaisAntigosQue: PRIMITIVO de retenção testado, nunca chamado em produção (ver guarda em semBackendRealWorker.test.ts)', () => {
  it('sem nenhum registro armazenado (chave nunca usada): não falha, devolve os dois campos false', async () => {
    const stub = obterStub('instancia-limpeza', 'msg-limpeza-vazio-001');
    const resultado = await stub.limparRegistrosMaisAntigosQue(1_000_000_000);
    expect(resultado).toEqual({ aplicacaoRemovida: false, observacaoRemovida: false });
  });

  it('registro de aplicação efetiva RECENTE (horizonte ainda não passou): não é removido, consultarAplicacao continua aplicado', async () => {
    const stub = obterStub('instancia-limpeza', 'msg-limpeza-recente-001');
    const rascunho = rascunhoValido('instancia-limpeza', 'msg-limpeza-recente-001');
    const aplicacao = await stub.registrarAplicacaoSeNaoDuplicado(rascunho);
    expect(aplicacao.tipo).toBe('aplicado');

    // Horizonte enorme, `agora` é o instante real atual — a idade do
    // registro (poucos milissegundos) nunca excede esse horizonte.
    const resultadoLimpeza = await stub.limparRegistrosMaisAntigosQue(1_000_000_000_000, Date.now());
    expect(resultadoLimpeza).toEqual({ aplicacaoRemovida: false, observacaoRemovida: false });

    const consulta = await stub.consultarAplicacao();
    expect(consulta).toEqual({ situacao: 'aplicado', rascunho });
  });

  it('registro de aplicação efetiva ANTIGO (horizonte já passou): É removido — e, a partir daí, um REPLAY do mesmo messageId é tratado como mensagem NOVA (dedup perdida para esse registro específico; efeito documentado, não escondido)', async () => {
    const instanceId = 'instancia-limpeza';
    const messageId = 'msg-limpeza-antigo-001';
    const stub = obterStub(instanceId, messageId);
    const rascunho = rascunhoValido(instanceId, messageId);
    const aplicacao = await stub.registrarAplicacaoSeNaoDuplicado(rascunho);
    expect(aplicacao.tipo).toBe('aplicado');

    // `agora` artificialmente no futuro + horizonte pequeno: garante,
    // deterministicamente (sem depender de tempo real decorrido no teste),
    // que o registro já aplicado está "mais velho que o horizonte" neste
    // cálculo — sem precisar mockar o relógio global do runtime.
    const agoraNoFuturo = Date.now() + 1_000_000_000;
    const resultadoLimpeza = await stub.limparRegistrosMaisAntigosQue(1_000, agoraNoFuturo);
    expect(resultadoLimpeza).toEqual({ aplicacaoRemovida: true, observacaoRemovida: false });

    // O registro desapareceu — consultarAplicacao volta a "nao_aplicado",
    // exatamente como se o messageId nunca tivesse sido visto.
    const consultaDepoisDaLimpeza = await stub.consultarAplicacao();
    expect(consultaDepoisDaLimpeza.situacao).toBe('nao_aplicado');

    // Efeito central deste teste: um REPLAY do MESMO rascunho (mesma chave
    // messageId+instanceId) agora é tratado como 'aplicado' (mensagem
    // nova), nunca 'duplicado' — a proteção de deduplicação foi perdida
    // PARA ESTE REGISTRO ESPECÍFICO depois da limpeza. Isto é o tradeoff
    // real da retenção, testado explicitamente aqui em vez de presumido.
    const replayDepoisDaLimpeza = await stub.registrarAplicacaoSeNaoDuplicado(rascunho);
    expect(replayDepoisDaLimpeza.tipo).toBe('aplicado');
  });

  it('observação não-elegível RECENTE não é removida; observação ANTIGA é removida (foiObservadoComoNaoElegivel volta a false) — isolado da chave de aplicação efetiva', async () => {
    const instanceId = 'instancia-limpeza';
    const messageIdRecente = 'msg-limpeza-observacao-recente-001';
    const messageIdAntigo = 'msg-limpeza-observacao-antigo-001';

    const stubRecente = obterStub(instanceId, messageIdRecente);
    await stubRecente.registrarObservacaoNaoElegivel('observação fictícia recente, só para o teste de limpeza');
    const limpezaRecente = await stubRecente.limparRegistrosMaisAntigosQue(1_000_000_000_000, Date.now());
    expect(limpezaRecente.observacaoRemovida).toBe(false);
    expect(await stubRecente.foiObservadoComoNaoElegivel()).toBe(true);

    const stubAntigo = obterStub(instanceId, messageIdAntigo);
    await stubAntigo.registrarObservacaoNaoElegivel('observação fictícia antiga, só para o teste de limpeza');
    const agoraNoFuturo = Date.now() + 1_000_000_000;
    const limpezaAntiga = await stubAntigo.limparRegistrosMaisAntigosQue(1_000, agoraNoFuturo);
    expect(limpezaAntiga).toEqual({ aplicacaoRemovida: false, observacaoRemovida: true });
    expect(await stubAntigo.foiObservadoComoNaoElegivel()).toBe(false);

    // Isolamento: limpar a observação nunca afeta (nem cria) uma aplicação
    // efetiva na mesma chave — continua "nao_aplicado", nunca "aplicado".
    const consultaAntigo = await stubAntigo.consultarAplicacao();
    expect(consultaAntigo.situacao).toBe('nao_aplicado');
  });
});
