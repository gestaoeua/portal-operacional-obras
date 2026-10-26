# Kapso → draft → OS → existing RSF panel (synthetic local test)

This is NOT an active Kapso integration. It sends no WhatsApp messages, uses no
real account or secret, and accepts no external webhook. Do not deploy this server.
No production Apps Script, spreadsheet, grants or existing records were changed.

## Run (Node 24 with node:sqlite)

From this checkout, in two PowerShell terminals:

```powershell
node tests/kapso-local-server.cjs
```

```powershell
$env:VITE_RSF_CENTRAL_API_URL='http://127.0.0.1:8796'
$env:VITE_RSF_FIXTURE_MODE='true'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort
```

Open http://127.0.0.1:5175/central/?view=messages . Synthetic login: fixture / fixture.
Never enter a real password or private/customer data. Existing calendar on 5174
and its data are independent and preserved.

1. Process the fixed synthetic message. The server signs its fixed original bytes
   and invokes the existing HMAC-verifying adapter. No real provider request occurs.
2. Reread the draft. Repeating the simulation preserves exactly one draft.
3. Select Conferir rascunho, review the fictional scope, confirm creation.
4. The UI confirms only after a separate read links the draft to the returned OS.
5. Open Ordens de serviço and select the OS to inspect Recebida and its history.

The source text is not parsed into addresses, people or appointments. Those fields
remain missing. Human confirmation produces an unassigned OS, never a dispatch.
This test source exposes existing OS list/detail contracts in read-only mode;
assignment and stage mutations are deliberately unavailable in this source.

## Durability and retries

Database: `../test-temp/kapso-synthetic.sqlite`, outside the source package.
SQLite WAL + synchronous FULL; immediate transactions for dedupe/approval;
unique draft and request identities; command conflicts reject; no reset/delete API.
The database and its WAL files survive restart. Do not copy a live database without
SQLite-aware backup/checkpoint handling. No cleanup or file deletion is performed.

Approval has one durable transaction containing the request identity and OS/history.
If a write or reread is uncertain, UI keeps the exact command/request ID for retry
and blocks navigation until reconciliation. A new request cannot create a second OS
from the same draft. This is local test reliability, not production authentication.

## Verification

```powershell
node --test tests/kapso-local-flow.test.cjs
node --test tests/kapso-signature.test.cjs tests/kapso-store.test.cjs tests/kapso-webhook.test.cjs
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --emptyOutDir false
```

HTTP flow test covers duplicate ingress, explicit review, independent reread,
retry/conflicting request, cross-project rejection, external origin rejection,
absence of webhook endpoint, and reopening in a separate Node process. SQLite
test covers two connections, conflict quarantine and missing-draft rollback.
Unavailable storage must never acknowledge receipt. Frontend tests cover human
review, unconfirmed receipt/retry and cross-project response rejection.

## Remaining work for a real event

- Authorized provider event source, webhook configuration and signature secret.
- Verified sender-to-project binding; no inference from display names.
- Production host with raw body limits, TLS, ingress authentication, durable queue,
  replay policy, monitoring and retry handling. Do not expose this fixture server.
- Approved production storage and authenticated project-scoped draft list/review
  endpoints, transactional bridge to the real OS event ledger, legitimate session.
- Real controlled event validation and rollout/rollback approval. Current browser
  and automated tests establish synthetic local behavior only.

Programacao_Eventos remains uncreated; this task does not require that sheet.
