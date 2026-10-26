// =============================================================================
// ISTO NÃO É UM RECEPTOR PUBLICADO. Não escuta nenhuma porta, não abre
// nenhum socket, não é implantado em lugar nenhum, não tem nenhuma
// dependência nova instalada. É a MESMA lógica de pipeline já testada em
// `aplicadorDeRascunhosWebhook.test.ts` (processarWebhookRecebido ->
// decidirIngestaoAutomatica -> aplicarDecisaoIngestao), só embrulhada numa
// FORMA "requisição entra, resposta sai" — para que, no dia em que um
// runtime real for escolhido (Apps Script doPost, uma função serverless,
// etc. — decisão de hospedagem que fica para o Márcio, ver relatório desta
// rodada), ligar isto a um listener de verdade seja questão de chamar esta
// função com um objeto equivalente ao request real, sem reescrever a lógica.
//
// `RequisicaoCallbackSintetica` e `RespostaCallbackSintetica` são tipos
// PRÓPRIOS deste piloto, nunca Express/Fetch API/node:http — só um formato
// mínimo (método, cabeçalhos, corpo cru) para exercitar esta função inteira
// em testes, sem nenhum listener de rede externo.
//
// Sobre cabeçalhos: hoje eles são só OBSERVADOS (repassados ao resultado
// para quem chamar poder auditar), NUNCA usados para decidir nada — porque
// não existe, na documentação disponível, nenhum mecanismo verificável de
// autenticidade para a ENTREGA deste callback (gate G1 — ver tipos.ts e o
// relatório desta rodada). Isto NÃO inventa HMAC nem qualquer verificação:
// é só o ponto de extensão deixado pronto para o dia em que isso existir.
import { aplicarDecisaoIngestao } from './aplicadorDeRascunhosWebhook';
import type { ArmazenamentoDurabilidadeOfflineWebhook } from './armazenamentoDurabilidadeOffline';
import { decidirIngestaoAutomatica } from './decidirIngestaoAutomatica';
import { processarWebhookRecebido } from './processarWebhookRecebido';
import type { ResultadoAplicacaoRascunhoWebhook } from './tipos';

export interface RequisicaoCallbackSintetica {
  metodo: string;
  /** Observados, nunca verificados nesta etapa — ver nota acima (gate G1). */
  cabecalhos: Record<string, string | undefined>;
  corpoCru: string;
}

export interface RespostaCallbackSintetica {
  status: number;
  corpo: { resultado: string; detalhe?: string };
  /** Cabeçalhos que foram OBSERVADOS na requisição — nunca usados para decidir nada, só para auditoria de quem chamar. */
  cabecalhosObservados: Record<string, string | undefined>;
}

/**
 * Traduz um `ResultadoAplicacaoRascunhoWebhook` já calculado para a forma de
 * resposta HTTP. Extraída separadamente de `manipularCallbackWebhookRecebido`
 * de propósito: permite exercitar o mapeamento de resposta também para o
 * caminho SIMULADO (elegivel:true hipotético), sem precisar injetar uma
 * decisão falsa dentro do manipulador real — ver
 * `__tests__/manipularCallbackHttpSintetico.test.ts`, seção de simulação.
 */
export function mapearAplicacaoParaResposta(
  aplicacao: ResultadoAplicacaoRascunhoWebhook,
  cabecalhosObservados: Record<string, string | undefined>
): RespostaCallbackSintetica {
  switch (aplicacao.tipo) {
    case 'armazenamento_corrompido':
      // Erro interno de verdade — não é culpa do payload recebido. Status
      // 5xx para sinalizar que algo do lado do receptor precisa de
      // diagnóstico manual (o arquivo corrompido fica intacto em disco).
      return { status: 500, corpo: { resultado: 'armazenamento_corrompido', detalhe: aplicacao.motivo }, cabecalhosObservados };
    case 'nao_elegivel':
      // Recebido com sucesso; gate de ingestão automática permanece
      // fechado (G1) — não é um erro de entrega, por isso 200.
      return { status: 200, corpo: { resultado: 'recebido_nao_elegivel', detalhe: aplicacao.motivo }, cabecalhosObservados };
    case 'duplicado':
      return { status: 200, corpo: { resultado: 'recebido_duplicado', detalhe: aplicacao.motivo }, cabecalhosObservados };
    case 'rascunho_criado':
      // HOJE inalcançável pelo caminho real (ver aplicadorDeRascunhosWebhook.ts) — só pelo caminho simulado em teste.
      return { status: 200, corpo: { resultado: 'recebido_rascunho_pendente_aprovacao' }, cabecalhosObservados };
  }
}

/**
 * Manipulador no FORMATO de um handler HTTP — requisição sintética entra,
 * resposta sintética sai. NUNCA chamado por nenhum listener de rede neste
 * repositório; só por testes. Roda o pipeline REAL e completo
 * (`processarWebhookRecebido` -> `decidirIngestaoAutomatica` ->
 * `aplicarDecisaoIngestao`) — nunca simula nada sozinho.
 */
export function manipularCallbackWebhookRecebido(
  requisicao: RequisicaoCallbackSintetica,
  armazenamento: ArmazenamentoDurabilidadeOfflineWebhook
): RespostaCallbackSintetica {
  const cabecalhosObservados = requisicao.cabecalhos;

  if (requisicao.metodo !== 'POST') {
    return { status: 405, corpo: { resultado: 'metodo_nao_suportado', detalhe: `esperado POST, recebido ${requisicao.metodo}` }, cabecalhosObservados };
  }

  let corpoJson: unknown;
  try {
    corpoJson = JSON.parse(requisicao.corpoCru);
  } catch (erro) {
    return {
      status: 400,
      corpo: { resultado: 'invalido', detalhe: `corpo não é JSON válido: ${erro instanceof Error ? erro.message : String(erro)}` },
      cabecalhosObservados,
    };
  }

  const normalizado = processarWebhookRecebido(corpoJson);
  if (normalizado.tipo === 'invalido') {
    return { status: 400, corpo: { resultado: 'invalido', detalhe: normalizado.motivo }, cabecalhosObservados };
  }
  if (normalizado.tipo === 'quarentena_grupo_nao_suportado' || normalizado.tipo === 'quarentena_tipo_de_conteudo_nao_suportado') {
    // Recebido com sucesso; fora de escopo nesta etapa por decisão de produto, não é erro de entrega.
    return { status: 200, corpo: { resultado: normalizado.tipo, detalhe: normalizado.motivo }, cabecalhosObservados };
  }

  const decisao = decidirIngestaoAutomatica(normalizado.evento);
  const aplicacao = aplicarDecisaoIngestao(decisao, armazenamento);
  return mapearAplicacaoParaResposta(aplicacao, cabecalhosObservados);
}
