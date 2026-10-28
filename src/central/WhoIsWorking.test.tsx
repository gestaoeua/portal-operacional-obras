// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readTodayAttendance } from "./whoIsWorkingApi";

const sample = {
  data: "2026-10-28", consultadoEm: "2026-10-28T13:33:00Z", fonte: "QuickBooks Time",
  trabalhando: [
    { pessoa: "Pessoa Um", obra: "Obra A", entrada: "2026-10-28T07:51:00-04:00" },
    { pessoa: "Pessoa Dois", obra: "Obra A", entrada: "2026-10-28T08:20:00-04:00" },
    { pessoa: "Pessoa Três", obra: "Obra B", entrada: "2026-10-28T09:03:00-04:00" },
  ],
  encerrados: [{ pessoa: "Pessoa Quatro", obra: "Obra B", entrada: "2026-10-28T06:00:00-04:00", saida: "2026-10-28T09:00:00-04:00", duracaoSegundos: 10800 }],
  semPonto: [{ pessoa: "Pessoa Cinco" }],
  periodo: "hoje", inicio: "2026-10-28", fim: "2026-10-28",
  horasPorCliente: [{ cliente: "Cliente A", horas: 6.5 }, { cliente: "Cliente B", horas: 2 }],
  horasPorPessoa: [{ pessoa: "Pessoa Um", horas: 4.25 }, { pessoa: "Pessoa Dois", horas: 1 }],
};
vi.mock("./transport", () => ({ ApiError: class extends Error { code = ""; }, post: async () => ({ ok: true, hoje: sample }) }));

it("rejects malformed or widened responses", () => {
  expect(() => readTodayAttendance({ ...sample, trabalhando: [{ pessoa: "", obra: "x", entrada: "" }] })).toThrow();
  expect(() => readTodayAttendance({ ...sample, data: "ontem" })).toThrow();
  const r = readTodayAttendance({ ...sample, trabalhando: [{ ...sample.trabalhando[0], salario: 10 }] });
  expect(Object.keys(r.trabalhando[0]).sort()).toEqual(["entrada", "obra", "pessoa"]);
});

it("shows who is working, people per site and who has not clocked in", async () => {
  const { default: WhoIsWorking } = await import("./WhoIsWorking");
  render(<WhoIsWorking token="t" revision={0} onExpired={() => {}} />);
  await screen.findByRole("heading", { name: "Quem está trabalhando" });
  expect(screen.getAllByText("Pessoa Um").length).toBe(3);
  expect(screen.getByText("Pessoa Cinco")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Já saíram hoje" })).toBeTruthy();
  expect(screen.getAllByText("07:51").length).toBe(2);
  expect(screen.getByText("3h 00min")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Horas por cliente" })).toBeTruthy();
  expect(screen.getByRole("img", { name: /Cliente A 6h 30min, Cliente B 2h 00min/ })).toBeTruthy();
  expect(screen.getByText("76%")).toBeTruthy();
  expect(screen.getByText("4h 15min")).toBeTruthy();
});

it("rejects negative or malformed hour totals", () => {
  expect(() => readTodayAttendance({ ...sample, horasPorPessoa: [{ pessoa: "X", horas: -1 }] })).toThrow();
  expect(() => readTodayAttendance({ ...sample, periodo: "ano" })).toThrow();
});
