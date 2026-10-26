// All browser fixture data is synthetic and intercepted locally. Never connects to Sheets.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let enters = 0,
    exits = 0,
    role = "gestor";
  const rooms = [
    {
      MARK: "TEST-01",
      Nome: "Local de teste A",
      Servico: "Pintura",
      Status: "finalizado",
      Observacao: "",
      Identificada: "Sim",
      UltimaAtualizacao: "01/10/2026",
    },
    {
      MARK: "TEST-02",
      Nome: "Local de teste B",
      Servico: "Limpeza",
      Status: "touch_up",
      Observacao: "Revisão de teste",
      Identificada: "Sim",
      UltimaAtualizacao: "",
    },
  ];
  let visits = [];
  await page.route("**/test-api", async (route) => {
    const p = JSON.parse(
      new URLSearchParams(route.request().postData()).get("payload"),
    );
    let result = { ok: true };
    if (p.action === "login")
      result.session = {
        token: "test-only",
        userId: "test-user",
        name: "Usuário de teste",
        role,
      };
    if (p.action === "listRooms") result.salas = rooms;
    if (p.action === "listVisits") result.visits = visits;
    if (p.action === "listWorkOrders")
      result.workOrders = [
        {
          id: "TEST-OS-01",
          address: "Endereço de teste",
          city: "Cidade de teste",
          status: "A executar",
          scope: "Escopo de teste",
          protections: "Preservar item de teste",
          dependencies: "",
          evidenceNotes: "Sem anexos",
          updatedAt: "01/10/2026",
        },
      ];
    if (p.action === "enter") {
      enters++;
      visits = [
        {
          id: "test-visit",
          userId: "test-user",
          userName: "Usuário de teste",
          roomMark: "TEST-02",
          roomName: "Local de teste B",
          startedAt: new Date().toISOString(),
        },
      ];
      result.visit = visits[0];
    }
    if (p.action === "exit") {
      exits++;
      visits[0] = {
        ...visits[0],
        endedAt: new Date().toISOString(),
        action: p.workAction,
        finalStatus: p.finalStatus,
      };
      result.visit = visits[0];
    }
    await new Promise((r) => setTimeout(r, 80));
    await route.fulfill({ json: result });
  });
  const login = async () => {
    await page.getByLabel("Usuário", { exact: true }).fill("test-user");
    await page.getByLabel("Senha", { exact: true }).fill("fixture-only");
    await page.getByRole("button", { name: "Entrar com segurança" }).click();
    await page
      .getByRole("button", { name: "Atualizar", exact: false })
      .waitFor();
    await page.getByText("Locais e campo: consulta às", { exact: false }).waitFor();
  };
  fs.mkdirSync("/workspace/scratch/9e1496664be3/rsf-qa", { recursive: true });
  await page.goto("http://127.0.0.1:4173");
  await page.screenshot({
    path: "/workspace/scratch/9e1496664be3/rsf-qa/login.png",
  });
  await login();
  await page.screenshot({
    path: "/workspace/scratch/9e1496664be3/rsf-qa/dashboard-test-data.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Locais e unidades" }).click();
  await page.getByLabel("Buscar locais").fill("no-match");
  await page.getByText("Nenhum local encontrado").waitFor();
  await page.getByLabel("Buscar locais").fill("TEST-02");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page
    .getByRole("button", { name: "Ordens de serviço", exact: false })
    .click();
  await page.getByRole("button", { name: "Ver TEST-OS-01" }).click();
  await page.getByText("Preservar item de teste").waitFor();
  await page.screenshot({
    path: "/workspace/scratch/9e1496664be3/rsf-qa/order-test-data.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Todas as ordens de serviço", exact: false })
    .click();
  await page.getByRole("button", { name: "Ver TEST-OS-01" }).waitFor();
  await page.getByRole("button", { name: "Antes e depois" }).click();
  await page.getByText("Entrega com evidências").waitFor();
  await page.getByRole("button", { name: "Indicadores" }).click();
  await page.getByText("Distribuição dos locais").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/workspace/scratch/9e1496664be3/rsf-qa/mobile-test-data.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "mobile viewport overflow",
  );
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.getByLabel("Senha", { exact: true }).waitFor();
  role = "executor";
  await login();
  await page.getByLabel("Selecione o local").selectOption("TEST-02");
  await page.getByRole("button", { name: "Iniciar atendimento" }).dblclick();
  await page.getByRole("heading", { name: "1. Serviço executado" }).waitFor();
  assert.equal(enters, 1);
  await page.getByRole("button", { name: "Preparação", exact: true }).click();
  await page.getByRole("button", { name: "Finalizado", exact: true }).click();
  await page.getByRole("button", { name: "Finalizar e salvar" }).dblclick();
  await page.getByText("Onde você vai trabalhar?").waitFor();
  assert.equal(exits, 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Ordens de serviço", exact: false })
      .count(),
    0,
  );
  await page.reload();
  await page.getByLabel("Senha", { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      session: sessionStorage.length,
      local: localStorage.length,
    })),
    { session: 0, local: 0 },
  );
  assert.deepEqual(errors, []);
  console.log(
    "UI PASS: login, navigation, filters, OS detail/back, mobile no-overflow, executor double-click guards, logout/reload, no token persistence, no browser errors",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
