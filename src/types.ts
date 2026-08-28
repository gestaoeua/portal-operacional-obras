export type Status =
  | 'finalizado'
  | 'em_andamento'
  | 'touch_up'
  | 'pendente'
  | 'nao_cadastrada';

export const STATUS_LABEL: Record<Status, string> = {
  finalizado: 'Finalizado',
  em_andamento: 'Em andamento',
  touch_up: 'Touch-up',
  pendente: 'Pendente',
  nao_cadastrada: 'Não cadastrada',
};

// Classe CSS curta usada nos pontinhos/marcadores/pills para cada status.
export const STATUS_CLASS: Record<Status, string> = {
  finalizado: 'done',
  em_andamento: 'progress',
  touch_up: 'touchup',
  pendente: 'pending',
  nao_cadastrada: 'unregistered',
};

export const STATUS_ORDER: Status[] = [
  'finalizado',
  'em_andamento',
  'touch_up',
  'pendente',
  'nao_cadastrada',
];

/** Uma linha da aba "Salas" da planilha, já normalizada. */
export interface Room {
  mark: string;
  name: string;
  service: string;
  status: Status;
  note: string;
  /** Posição X em % (0-100). Undefined quando a sala não tem coordenada. */
  x?: number;
  /** Posição Y em % (0-100). Undefined quando a sala não tem coordenada. */
  y?: number;
  identified: boolean;
  updatedAt: string;
}

/** Formato bruto que chega da API (Apps Script), sempre com strings/valores soltos. */
export interface RawRoom {
  MARK?: string;
  Nome?: string;
  Servico?: string;
  Status?: string;
  Observacao?: string;
  PosicaoX?: string | number;
  PosicaoY?: string | number;
  Identificada?: string | boolean;
  UltimaAtualizacao?: string;
}

export interface ApiResponse {
  ok?: boolean;
  salas?: RawRoom[];
  atualizadoEm?: string;
  erro?: string;
}
