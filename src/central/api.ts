import { post } from "./transport";
import type { RawRoom, Room, Status, UserSession } from "./types";
import { STATUS_ORDER } from "./types";

export class ApiConfigError extends Error {}
export class ApiFetchError extends Error {}

function parseNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const trimmed = value.toString().trim().replace(",", ".");
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function parseBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (!value) return false;
  const v = value.toString().trim().toLowerCase();
  return v === "sim" || v === "true" || v === "1" || v === "yes" || v === "x";
}

function normalizeStatus(value: string | undefined): Status {
  const v = (value ?? "").toString().trim().toLowerCase();
  const found = STATUS_ORDER.find((s) => s === v);
  return found ?? "nao_cadastrada";
}

function normalizeRoom(raw: RawRoom): Room | null {
  const mark = (raw.MARK ?? "").toString().trim();
  if (!mark) return null;
  return {
    mark,
    name: (raw.Nome ?? "").toString().trim(),
    service: (raw.Servico ?? "").toString().trim(),
    status: normalizeStatus(raw.Status),
    note: (raw.Observacao ?? "").toString().trim(),
    x: parseNumber(raw.PosicaoX),
    y: parseNumber(raw.PosicaoY),
    identified: parseBoolean(raw.Identificada),
    updatedAt: (raw.UltimaAtualizacao ?? "").toString().trim(),
  };
}

export interface LoadResult {
  rooms: Room[];
  updatedAt: string;
}

export async function loadRooms(session: UserSession): Promise<LoadResult> {
  const data = await post({ action: "listRooms", token: session.token });
  if (!Array.isArray(data.salas))
    throw new ApiFetchError("Cadastro de locais inválido.");
  const rooms = (data.salas as RawRoom[])
    .map(normalizeRoom)
    .filter((room): room is Room => room !== null)
    .sort((a, b) => a.mark.localeCompare(b.mark, "pt-BR", { numeric: true }));
  return {
    rooms,
    updatedAt: typeof data.atualizadoEm === "string" ? data.atualizadoEm : "",
  };
}
