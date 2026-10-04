// Classificação de Status por comparação EXATA — nunca por trecho.
//
// Correção aplicada (ver COMPLEMENTO-CRONOGRAMA-E-CORRECOES.md, seção 3.1):
// não existe mais nenhuma inferência de "em execução" por eliminação
// (Status != X e != Y). EM_ANDAMENTO só existe quando o texto bate, letra
// por letra, com um valor explícito mapeado para isso. Qualquer coisa fora
// da tabela vira STATUS_NAO_MAPEADO — nunca é somada a NAO_INICIADA nem a
// EM_ANDAMENTO por suposição.
//
// CORREÇÃO (revisão independente do patch original): a tabela original não
// mapeava NENHUM valor para EM_ANDAMENTO, deixando esse estado inatingível
// na prática. Isto implementa o CONTRATO explícito já anunciado no
// comentário anterior desta tabela ("ex. 'Em execução'") — nenhuma célula
// real foi alterada; é só o código passando a reconhecer esse valor quando
// a planilha vier a usá-lo. Qualquer outro texto continua
// STATUS_NAO_MAPEADO, sem exceção.
import type { EstadoOS } from './types';

/**
 * Tabela fechada de valores conhecidos de `Status`. Comparação é feita após
 * `trim()`, preservando maiúsculas/minúsculas e acentos (os valores reais
 * observados até agora distinguem só por isso, nunca por caixa).
 */
const TABELA_STATUS: Record<string, EstadoOS> = {
  Finalizada: 'CONCLUIDA_INFORMADA',
  'A executar': 'NAO_INICIADA',
  'Teste: concluída (informado)': 'CONCLUIDA_INFORMADA',
  // Contrato explícito para EM_ANDAMENTO (ver nota de correção acima) — só
  // reconhece esse texto exato; nenhum outro valor é somado aqui por
  // suposição/eliminação.
  'Em execução': 'EM_ANDAMENTO',
};

export function classificarStatus(statusRaw: string | undefined | null): EstadoOS {
  const texto = (statusRaw ?? '').toString().trim();
  if (texto === '') return 'STATUS_NAO_MAPEADO';
  const direto = TABELA_STATUS[texto];
  if (direto) return direto;
  return 'STATUS_NAO_MAPEADO';
}

/** Verdadeiro só quando o texto bate exatamente com um valor conhecido. */
export function statusReconhecido(statusRaw: string | undefined | null): boolean {
  const texto = (statusRaw ?? '').toString().trim();
  return texto !== '' && texto in TABELA_STATUS;
}

export const VALORES_STATUS_CONHECIDOS = Object.keys(TABELA_STATUS);

/**
 * Regra de "pelo menos uma etapa/serviço aplicável" (ver seção 3.2 da
 * correção): um conjunto vazio de etapas conhecidas NUNCA comprova
 * conclusão — "para todo x em um conjunto vazio" é verdadeiro por
 * vacuidade, e essa armadilha lógica é explicitamente evitada aqui.
 */
export function temEtapaAplicavel(escopo: string, quantidadeEtapasConhecidas: number): boolean {
  const escopoDefinido = escopo.trim() !== '';
  return escopoDefinido && quantidadeEtapasConhecidas > 0;
}

/**
 * Critério de "área/OS concluída (informada)" — exige etapa aplicável
 * (nunca um conjunto vazio) e nenhuma etapa com status não mapeado.
 */
export function areaPodeSerConsideradaConcluida(params: {
  temEtapaAplicavel: boolean;
  todasEtapasConhecidasConcluidas: boolean;
  existeStatusNaoMapeado: boolean;
}): boolean {
  if (!params.temEtapaAplicavel) return false;
  if (params.existeStatusNaoMapeado) return false;
  return params.todasEtapasConhecidasConcluidas;
}
