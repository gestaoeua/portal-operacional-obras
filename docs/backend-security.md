# Backend security and release gates

These changes are local hardening, not approval to deploy the current password system to production. No deployment, remote push, account creation or production spreadsheet mutation was performed.

## API contract

- GET returns only service/version metadata and `authenticationRequired: true`. It does not read the spreadsheet, rooms, users or visits.
- POST uses a form field `payload` containing a JSON object, with a maximum of 8,192 characters. JSON request bodies are not the API contract.
- `login`: username and password; returns `session` with token, userId, name and role.
- `listRooms`: token; returns salas, atualizadoEm and totalSalas.
- `listVisits`: token; executors see their own visits, gestores/diretores see all visits.
- `enter`: executor token and roomMark.
- `exit`: executor token, visitId, workAction and finalStatus.
- `logout`: token; revokes the server-side cached session, including for a disabled account. It is safe to call again for the same valid-format token.
- All API failures use `{ok:false, erro}`. Apps Script ContentService does not provide conventional per-response HTTP status controls; callers must inspect `ok` and validate response fields, not rely only on HTTP status.

The three supported roles are exactly `executor`, `gestor`, and `diretor`. Sessions contain only userId and absolute expiry. Every protected data request resolves the account again and checks current activation and role. Password hashes, names and roles are never cached in a session. Old cached sessions from the former backend fail validation and require a fresh login.

## Data-integrity protections

The existing schema and legacy hashes are preserved. Headers must match the expected schema exactly, including order. Missing, duplicate, reordered, blank and additional columns fail closed. An administrator must reconcile intentional schema changes before using this version; do not simply deploy it over an unverified workbook.

Enter requires a unique existing room and no other open visit for that executor. Checkout requires exactly one matching visit owned by the current executor, an empty endedAt, valid enumerated action/status and exactly one existing target room. Both complete sheets are validated before writes. Closed checkouts cannot be replayed to modify historical completion or room status. Related checkout fields are written together. Script locks serialize API mutations. Formula-like values are escaped on append.

A transient write failure attempts to restore the prior visit and room values. This is best-effort recovery, **not a database transaction**. If the storage service fails during rollback, inspect and reconcile both rows before retrying. Locks also do not protect against simultaneous edits directly in Google Sheets. A transactional database or durable idempotency/journal design is required if atomicity and audited recovery are release requirements.

## Unresolved production blockers

1. Passwords still use the pre-existing single SHA-256 digest with a fixed `MP|` prefix. This is fast and has no per-user random salt. It is unsuitable for production password storage. No new homemade password scheme has been introduced. Move authentication to an established identity provider, or a backend with an established password KDF (Argon2id/scrypt/bcrypt with per-user salts and appropriate parameters), migration/reset flow and account recovery. Existing hash generation remains only for compatibility and isolated non-production testing. Do not provision production accounts using it.
2. CacheService is ephemeral. The existing per-username attempt counter is now serialized, but it can be evicted/reset and is not a reliable abuse-control or account-lockout mechanism. It also allows targeted lockouts and does not address distributed attacks across usernames. Production authentication needs durable, independently reviewed abuse protection, monitoring and recovery.
3. Session expiry is six hours and enforced independently of the cache TTL. Cache eviction can sign users out early. Logout and disabling the account invalidate future requests, but cannot cancel already-running requests. Changing a password alone does not revoke existing tokens; until replaced with a provider, disable the account to block data access and allow all prior sessions to expire before re-enabling it. Avoid shipping bearer tokens in persistent browser storage.
4. Sheets writes across the visit and room are not atomic, as described above. Backups, restricted editor access, reconciliation procedures and an audit strategy are required before real operational use.
5. This API has no project/tenant isolation. Every gestor/diretor can read all data in the configured workbook. A separate approved access model and schema migration are required before combining clients/projects.
6. Existing public deployments and static artifacts need an exposure review. This local change does not revoke an older Apps Script deployment or remove already-published rooms/floor plans or source history.

## Local validation

Run `node --test tests/backend.test.cjs`. Tests execute Code.gs in an isolated Node VM with mocked Apps Script services and synthetic users/rooms. They cover public-data denial, invalid payloads/tokens, current roles/activation, expiry/revocation, minimal sessions, throttling, role-scoped history, single open visit, checkout ownership, invalid/duplicate targets, replay denial, schema preflight, transient write recovery and empty-room responses.

These tests do not prove Apps Script deployment behavior, real browser CORS/redirect handling, CacheService durability, Google quota behavior or atomic writes. After the blockers are addressed, validate a private staging workbook and deployment before an explicitly approved production release.

## Read-only work-order adapter

`listWorkOrders` requires an active `gestor` or `diretor` session. Executors receive `FORBIDDEN` until work-order assignment scoping is designed and authorized. Anonymous, invalid and expired sessions receive `SESSION_EXPIRED`. These role checks happen before accessing the OS workbook.

Configure `OS_SPREADSHEET_ID` in Apps Script's script properties to point at the separately verified OS workbook. This code does not set the property or change spreadsheet access permissions. If it is absent/blank, the adapter returns `OS_NOT_CONFIGURED`; it never invents an empty data source. The deploying identity must already have authorized read access to that workbook.

The source tab must be `OS` with these exact headers in this order:

OS | Endereço | Cidade | Status | Escopo | Proteções / Não remover | Dependências / Observações | Evidências | Última atualização

The response is `{ok:true,workOrders:[{id,address,city,status,scope,protections,dependencies,evidenceNotes,updatedAt}]}`. Every returned field uses the source display value, preserving identifiers such as leading zeros. Empty rows are skipped; nonempty rows with no ID fail with `OS_INVALID_ID`; IDs equal after trimming fail with `OS_DUPLICATE_ID`. Malformed/missing headers or tab fail with `OS_SCHEMA_INVALID`. Arbitrary storage exceptions remain generic and do not reveal source identifiers.

Work orders remain distinct from room/visit records. This action never writes to either source and never reads room/visit tabs. Authentication still reads the existing Usuarios tab in the original operational workbook. A valid header-only OS tab can legitimately return an empty list, unlike missing configuration. Evidence is returned only as source text; this adapter does not upload, follow links, change sharing or retrieve attachment contents.

Both operational managers and directors currently see every OS row in the configured source. Do not connect a multi-client workbook until this audience is authorized. The adapter is locally tested with synthetic data; no actual customer rows or OS spreadsheet identifier were added to the repository. Eighteen backend tests now cover the base controls plus OS access roles, source configuration, ID/schema integrity and cross-source read isolation.

## Buffered write confirmation

Entry creation explicitly calls `SpreadsheetApp.flush()` after append and before releasing the script lock, as required by the [Apps Script lock documentation](https://developers.google.com/apps-script/reference/lock/lock#releaselock). Checkout already flushes its writes under the lock.

An append or flush error is ambiguous: the entry row may have been committed even when the caller receives a failure. Entry returns `WRITE_UNCONFIRMED` and instructs the caller to refresh records before trying again. **Do not automatically retry entry or checkout writes** after an error, timeout or lost response. First reload authoritative visits/room state; reconcile any partial results with an operator. The server's open-entry and closed-checkout checks reduce duplicate/replay risk but do not replace durable request idempotency.

Twenty backend tests pass, including explicit `lock → append → flush → release` ordering and an ambiguous flush failure that releases the lock without a second append.

## OS operacional (ledger) — write path, prepared this round

This adds a second, independent OS concept alongside the read-only `listWorkOrders` adapter above: a writable six-stage lifecycle (Recebida → Em conferência → Programada → Em execução → Aguardando validação → Concluída), stored as an append-only event ledger (`OS_Eventos`) plus an explicit per-project grant list (`OS_Acessos`), both new tabs. Neither tab exists on any real workbook yet; `setupOsOperacional()` is the code that would create them, never called automatically, and no real spreadsheet was touched to write this.

**Append-only, not a mutable "current state" row.** Every action (create/assign/advance/reopen) appends exactly one row. Current state for an OS is always derived from the highest-`Revisao` row for that `OsId` — there is no second table to keep in sync, so there is no dual-write divergence to reconcile. The cost is reading every row for that OS to derive its state, acceptable at this pilot's scale and documented rather than hidden.

**Project isolation has no role exception.** Every read and write of this ledger requires an explicit `OS_Acessos` grant for the acting user and the project in question — including `gestor` and `diretor`. This is a deliberate departure from `listWorkOrders` above (which stays role-gated only, by design, unchanged). Legacy `OS` tab rows are never surfaced through this ledger and are never assigned to a project by inference; a legacy row with no explicit project link simply never appears here.

**One critical section, idempotency before transition rules.** Every mutating action resolves to `executarComandoOS_`, which acquires `LockService` once and, inside that single lock: checks `RequestId` replay first (before reading any current state), then reads current state, validates the specific business rule (transition legality, required fields, responsible-user activation and grant), and only then appends. Checking replay before re-evaluating transition rules matters: without that order, replaying an already-applied command against a since-advanced state would be rejected as an illegal transition instead of returning the original result. A replay is matched against a persisted `ComandoCanonico` (the exact client-requested command, including the session-resolved actor) — never against a freshly server-generated value such as a new OS ID, and never against unnormalized/loosely-compared parameters. Any revision mismatch under the same lock is a `REVISION_CONFLICT`; `expectedRevision` is mandatory on every mutation of an existing OS (never silently skipped) and must be a safe non-negative integer, never coerced from a string.

**Required fields are enforced server-side, never inferred.** Advancing into `Em execução` requires a responsible person already assigned; advancing into `Concluída` requires a non-empty `motivo` (used as the completion note/evidence text). Both fail with `OS_REQUIRED_FIELD` rather than defaulting.

**Assignment.** Only `gestor`/`diretor` can assign; the target must be an existing, currently-active account with a valid role, and must itself hold an explicit grant for that project — checked fresh on every call, never cached from the acting session.

**Reopening.** Only `gestor`/`diretor`; only from `Concluída`; requires an explicit `motivo`. Because the ledger is append-only, the prior completion event is never altered or deleted — reopening only appends a new `reaberta` event.

**`whatsapp_prep` is a provenance label, not an authentication claim.** `createOsOperacional` accepts `origem: 'whatsapp_prep'` only as a tag for an OS a human created manually (through an authenticated session with a project grant) after reading a WhatsApp message — never an automated import path, and never treated as "verified". A traceable `origemDetalhe` (e.g. the source message ID) is mandatory whenever this label is used, specifically so the label can never be attached without a reference. No code path exists anywhere that lets the Cloudflare Worker pilot (`src/piloto-whatsapp-os/`, separately offline and fail-closed at gate G1) call this endpoint directly; see that project's own docs for its unrelated blockers.

### Unresolved for this ledger specifically

1. No real workbook location has been decided for `OS_Eventos`/`OS_Acessos` (this operational workbook vs. a separate one). `setupOsOperacional()` is prepared but not run against anything real.
2. Deriving current state by scanning every event for an OS does not scale indefinitely; a projection/index would need its own reconciliation story if ever introduced — deliberately not built this round to avoid the exact dual-write risk this design avoids today.
3. `LockService` still does not protect a direct edit made in the Sheets UI, or any other script touching these tabs — same limitation already noted above for the room/visit workbook.
4. No UI or process yet enforces who may be *granted* access to `OS_Acessos` in the first place; granting itself has no server-side action in this round, only manual sheet editing after setup.
5. This is validated only by local Node VM-mocked tests (`tests/os-ledger.test.cjs`); it does not prove real Apps Script/Sheets concurrency, quota or latency behavior.
