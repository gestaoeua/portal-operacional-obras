import { post } from "./transport";

export type WorkingNow = { pessoa: string; obra: string; entrada: string };
export type FinishedToday = WorkingNow & { saida: string; duracaoSegundos: number };
export type Period = "hoje" | "semana" | "mes";
export const PERIODS: Array<[Period, string]> = [["hoje", "Hoje"], ["semana", "Esta semana"], ["mes", "Este mês"]];
export type HoursByClient = { cliente: string; horas: number };
export type HoursByPerson = { pessoa: string; horas: number };
export type TodayAttendance = {
  periodo: Period;
  inicio: string;
  fim: string;
  horasPorCliente: HoursByClient[];
  horasPorPessoa: HoursByPerson[];
  data: string;
  consultadoEm: string;
  fonte: string;
  trabalhando: WorkingNow[];
  encerrados: FinishedToday[];
  semPonto: { pessoa: string }[];
};
type Request = (payload: Record<string, unknown>) => Promise<Record<string, any>>;

const text = (v: unknown, max = 200) =>
  typeof v === "string" && v.length <= max && !/[\u0000-\u001f]/.test(v);
const time = (v: unknown) => v === "" || (text(v, 40) && Number.isFinite(Date.parse(v as string)));

/** Copy only declared fields; anything unexpected fails closed instead of being shown. */
export function readTodayAttendance(raw: unknown): TodayAttendance {
  const d = raw as any;
  const bad = () => { throw new Error("Resposta de ponto inválida."); };
  if (!d || typeof d !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(d.data) || !time(d.consultadoEm) || !text(d.fonte, 60)) bad();
  if (![d.trabalhando, d.encerrados, d.semPonto, d.horasPorCliente, d.horasPorPessoa].every(Array.isArray)) bad();
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!PERIODS.some(([p]) => p === d.periodo) || !day.test(d.inicio) || !day.test(d.fim) || d.inicio > d.fim) bad();
  const hours = (x: any, key: "cliente" | "pessoa") => {
    if (!x || !text(x[key]) || !x[key].trim() || typeof x.horas !== "number" || !Number.isFinite(x.horas) || x.horas < 0 || x.horas > 100000) bad();
    return x.horas as number;
  };
  const base = (x: any): WorkingNow => {
    if (!x || !text(x.pessoa) || !x.pessoa.trim() || !text(x.obra) || !time(x.entrada)) bad();
    return { pessoa: x.pessoa, obra: x.obra, entrada: x.entrada };
  };
  return {
    periodo: d.periodo,
    inicio: d.inicio,
    fim: d.fim,
    horasPorCliente: d.horasPorCliente.map((x: any) => ({ cliente: x.cliente as string, horas: hours(x, "cliente") })),
    horasPorPessoa: d.horasPorPessoa.map((x: any) => ({ pessoa: x.pessoa as string, horas: hours(x, "pessoa") })),
    data: d.data,
    consultadoEm: d.consultadoEm,
    fonte: d.fonte,
    trabalhando: d.trabalhando.map(base),
    encerrados: d.encerrados.map((x: any): FinishedToday => {
      const b = base(x);
      if (!time(x.saida) || !Number.isFinite(x.duracaoSegundos) || x.duracaoSegundos < 0) bad();
      return { ...b, saida: x.saida, duracaoSegundos: x.duracaoSegundos };
    }),
    semPonto: d.semPonto.map((x: any) => {
      if (!x || !text(x.pessoa) || !x.pessoa.trim()) bad();
      return { pessoa: x.pessoa };
    }),
  };
}

export async function loadTodayAttendance(token: string, periodo: Period = "hoje", request: Request = post) {
  const result = await request({ action: "quemTrabalhaHoje", token, periodo });
  const data = readTodayAttendance(result.hoje);
  if (data.periodo !== periodo) throw new Error("Resposta de ponto inválida.");
  return data;
}
