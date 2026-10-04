// Contrato de dados de OS e cronograma (visão interna do gestor (demo pública)).
//
// Somente leitura nesta fatia: nenhum tipo aqui representa uma gravação.
// Campos de cronograma/planejamento são todos opcionais e aditivos — nenhum
// deles existe hoje na planilha real; ausência de um campo nunca é tratada
// como erro, só como "ainda não informado" (ver EstadoFonte/fila pendente).

/** Estado derivado do texto de `Status`, por comparação exata — nunca por trecho. */
export type EstadoOS =
  | 'NAO_INICIADA'
  | 'EM_ANDAMENTO'
  | 'CONCLUIDA_INFORMADA'
  | 'STATUS_NAO_MAPEADO';

/** Resultado da aprovação de qualidade — sempre separado da conclusão informada. */
export type ResultadoAprovacao = 'aprovado' | 'reprovado' | 'pendente';

export interface AprovacaoQualidade {
  resultado: ResultadoAprovacao;
  revisorId?: string;
  data?: string;
  versaoAprovada?: number;
  /** Nunca "não aplicável" — ausência de evidência é um estado próprio. */
  semEvidencia: boolean;
}

/**
 * Unidade de uma duração.
 * - `horas-pessoa`: ESFORÇO (horas-pessoa/person-hours) — ambíguo quanto a
 *   calendário (6 horas-pessoa pode ser 1 pessoa por 6h ou 2 por 3h cada).
 *   Nunca vira duração de calendário sozinha.
 * - `horas`: duração real de relógio (não é esforço — não depende de
 *   tamanho de equipe), mas este sistema não guarda hora do dia nas datas
 *   (`DiaLocal` é só dia de calendário, sem hora — ver `diaLocal.ts`), então
 *   mesmo `horas` NUNCA projeta um dia-fim sozinha: projetar isso exigiria
 *   presumir um horário de início, o que não é feito aqui. Ver `duracao.ts`.
 * - `dias-corridos` / `dias-uteis`: duração de calendário — só essas duas
 *   produzem uma projeção de dia-fim (`dias-uteis` nunca presume feriados).
 */
export type UnidadeDuracao = 'horas' | 'horas-pessoa' | 'dias-corridos' | 'dias-uteis';

export interface DuracaoPlanejada {
  valor: number;
  unidade: UnidadeDuracao;
}

/** Data de calendário pura (sem hora, sem fuso) — ver `diaLocal.ts`. */
export interface DiaLocal {
  ano: number;
  mes: number; // 1-12
  dia: number;
}

export interface PlanejamentoOS {
  dataInicioPlanejada?: DiaLocal;
  dataFimPlanejada?: DiaLocal;
  duracaoPlanejada?: DuracaoPlanejada;
  /**
   * Preenchido quando a fonte trouxe um par (valor, unidade) de duração,
   * mas ele não passou em `duracao.ts#validarDuracao` (valor não
   * finito/positivo, unidade desconhecida, ou dias-úteis fracionário).
   * Nesse caso `duracaoPlanejada` acima fica ausente — o dado nunca é
   * corrigido/arredondado em silêncio, só descartado com o motivo visível.
   */
  duracaoInvalidaMotivo?: string;
  equipeResponsavel: string[]; // IDs estáveis de Usuario, nunca nomes soltos
  versaoPlanejamento: number;
  fonteResposta?: string; // ex.: "Piloto-Exemplo-Testes" — nunca produção nesta fase
  autorRespostaId?: string;
  momentoResposta?: string; // instante real, com fuso — ver `instante.ts`
}

export interface RealizadoOS {
  dataInicioReal?: DiaLocal;
  dataFimReal?: DiaLocal;
}

/** Linha de OS já normalizada, pronta para a tela. */
export interface OrdemServico {
  os: string; // chave
  endereco: string;
  cidade: string;
  statusTexto: string; // texto bruto, preservado para auditoria
  estado: EstadoOS;
  escopo: string;
  protecoes: string;
  dependenciasObservacoes: string;
  evidenciasTexto: string; // ainda texto livre nesta fatia (ver plano, seção 2)
  ultimaAtualizacao: string;
  responsavelInformado?: string; // metadado — nunca prova de presença
  dataServicoInformada?: DiaLocal; // autodeclarada — nunca "confirmada"
  origemTeste?: string;
  /** true quando a linha veio da fonte/aba de teste — por origem, não por este campo estar preenchido. */
  isTeste: boolean;
  /** Projeto a que a OS pertence, quando o contrato carregar esse campo (aditivo). */
  projetoId?: string;
  planejamento?: PlanejamentoOS;
  realizado?: RealizadoOS;
  aprovacaoQualidade: AprovacaoQualidade;
  /** true somente quando há escopo definido e ao menos um serviço/etapa aplicável — nunca por conjunto vazio. */
  temEtapaAplicavel: boolean;
}

/**
 * Estados de uma fonte/indicador (Salas, OS, QuickBooks, WhatsApp...), por
 * seção 5.3 da Revisão 2. `disponivel` é o estado "de sucesso com dados" da
 * fonte bruta (ex.: a lista de OS veio); os outros seis — carregando, vazio,
 * zero_confirmado, indisponivel, parcial, desatualizado — cobrem os casos
 * sem dado pleno, incluindo o de um INDICADOR calculado a partir da lista
 * (ex.: "OS em execução: zero_confirmado" depois de filtrar).
 */
export type EstadoFonte =
  | 'carregando'
  | 'disponivel'
  | 'vazio'
  | 'zero_confirmado'
  | 'indisponivel'
  | 'parcial'
  | 'desatualizado';

export interface LeituraFonte<T> {
  estado: EstadoFonte;
  dados: T;
  motivo?: string; // obrigatório quando estado === 'indisponivel' ou 'parcial'
  ultimaLeituraValidaEm?: string;
  /**
   * Itens recebidos mas excluídos por falta de associação explícita (ex.:
   * OS sem projetoId, ver authorization.ts#filtrarOrdensPorAutorizacao).
   * Sempre exibido quando > 0 — nunca escondido nem contado como "zero".
   */
  semProjetoAtribuido?: number;
  /**
   * Avisos de leitura PARCIAL (ex.: a aba "OS" falhou mas "OS - Testes" leu
   * normalmente) — correção obrigatória: produção falhar nunca pode virar
   * silenciosamente "produção vazia" só porque outra fonte (teste) teve
   * sucesso. Sempre exibido quando presente, mesmo com `dados` não vazio.
   */
  avisos?: string[];
  /**
   * Completude específica da fonte de PRODUÇÃO (aba "OS") — correção
   * obrigatória (revisão independente do patch original, item 2): distinta
   * de `estado`/`avisos` porque um aviso pode vir só da fonte de TESTE (que
   * nunca aparece na régua/contagens reais) sem que produção em si esteja
   * incompleta. Quando `false`, NENHUM consumidor (contadores, régua, fila
   * pendente) pode tratar a ausência de linhas de produção como "zero
   * confirmado" — deve mostrar indisponível/travessão. `undefined`
   * (respostas antigas, sem este campo) é tratado como completo, nunca como
   * incompleto por omissão — ver `osApi.ts#respostaParaLeitura`.
   */
  fonteProducaoCompleta?: boolean;
}

export type CodigoBloqueioAutorizacao =
  | 'AUTORIZACAO_PROJETO_NAO_CONFIGURADA'
  | 'SESSAO_INVALIDA';

export interface AutorizacaoProjetos {
  ok: boolean;
  projetosAutorizados: string[]; // vazio quando bloqueado — nunca "todos" por padrão
  bloqueio?: CodigoBloqueioAutorizacao;
  motivoBloqueio?: string;
}
