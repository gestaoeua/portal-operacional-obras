import { APPS_SCRIPT_URL, FETCH_TIMEOUT_MS } from './config';
import type { ApiResponse, RawRoom, Room, Status } from './types';
import { STATUS_ORDER } from './types';

export class ApiConfigError extends Error {}
export class ApiFetchError extends Error {}

function parseNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const trimmed = value.toString().trim().replace(',', '.');
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function parseBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  const v = value.toString().trim().toLowerCase();
  return v === 'sim' || v === 'true' || v === '1' || v === 'yes' || v === 'x';
}

function normalizeStatus(value: string | undefined): Status {
  const v = (value ?? '').toString().trim().toLowerCase();
  const found = STATUS_ORDER.find((s) => s === v);
  return found ?? 'nao_cadastrada';
}

function normalizeRoom(raw: RawRoom): Room | null {
  const mark = (raw.MARK ?? '').toString().trim();
  if (!mark) return null;
  return {
    mark,
    name: (raw.Nome ?? '').toString().trim(),
    service: (raw.Servico ?? '').toString().trim(),
    status: normalizeStatus(raw.Status),
    note: (raw.Observacao ?? '').toString().trim(),
    x: parseNumber(raw.PosicaoX),
    y: parseNumber(raw.PosicaoY),
    identified: parseBoolean(raw.Identificada),
    updatedAt: (raw.UltimaAtualizacao ?? '').toString().trim(),
  };
}

export interface LoadResult {
  rooms: Room[];
  updatedAt: string;
}

export async function loadRooms(): Promise<LoadResult> {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('COLE_AQUI')) {
    throw new ApiConfigError(
      'A URL do Apps Script ainda não foi configurada em src/config.ts.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: globalThis.Response;
  try {
    response = await fetch(APPS_SCRIPT_URL, {
      method: 'GET',
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiFetchError(
        'O servidor demorou demais para responder. Verifique sua conexão e tente novamente.'
      );
    }
    throw new ApiFetchError(
      'Não foi possível conectar à planilha agora. Verifique sua internet e tente novamente.'
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ApiFetchError(
      `A planilha respondeu com um erro (código ${response.status}). Tente novamente em instantes.`
    );
  }

  let data: ApiResponse | RawRoom[];
  try {
    data = await response.json();
  } catch {
    throw new ApiFetchError(
      'A resposta da planilha veio em um formato inesperado. Tente novamente em instantes.'
    );
  }

  const list: RawRoom[] = Array.isArray(data) ? data : data.salas ?? [];
  if (!Array.isArray(data) && data.erro) {
    throw new ApiFetchError(data.erro);
  }

  const rooms = list
    .map(normalizeRoom)
    .filter((r): r is Room => r !== null)
    .sort((a, b) => a.mark.localeCompare(b.mark, 'pt-BR', { numeric: true }));

  const updatedAt = !Array.isArray(data) && data.atualizadoEm ? data.atualizadoEm : '';

  return { rooms, updatedAt };
}
