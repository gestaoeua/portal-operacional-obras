# Calendar checkpoint — 22 October 2026

Local review: http://127.0.0.1:5174/central/?view=calendar

The existing RSF central shell now opens Calendar directly. Manual scheduling has
review-before-save, project authorization, revision checks, idempotent request
retry, independent reread, and pending-write navigation protection. Start-only
assignments are valid; an unknown finish never implies a duration. Complete
intervals alone support conclusive overlap checks. Timezone: America/New_York.

## Verified

- Full Vitest run: 355/355 passed, 37 files. One additional repeat-source review
  test subsequently added: the five local-review tests passed together.
- TypeScript noEmit and Vite build passed. Existing build files were preserved.
- Node schedule backend/durability: 16/16; fixture boundary: 3/3.
- Browser fixture create, save, independent reread, and server restart verified.
  A separate Node process also reread the append-only ledger from disk.
- The approved ten-row private source was displayed locally: ten dates on
  2026-10-22, ten starts at 08:00, ten unknown finishes. It was not transmitted
  to the fixture server, Claude, Gemini, Google Sheets, or the source repository.
- 390px responsive viewport: no page-level horizontal overflow; tables scroll
  inside their containers.

## Storage and limitations

Real source: sibling directory ../private-inputs/schedule-source-review.json.
This private disk file survives browser/server restart. Displayed private rows
are held only in the current tab and must be reopened after a page reload.
Names and literal locations remain unresolved references, not login identities,
team memberships, canonical properties, dispatch orders, or hours worked.

Fixture persistence: ../test-temp/schedule-fictional-events.jsonl. Only clearly
fictional records are written there. Fixture credentials are explicitly synthetic.
Successful fixture persistence does not establish Google Sheets persistence.

No live Programacao_Eventos sheet was created. Proposed additive schema:
RequestId, ProjetoId, AssignmentId, Revision, Actor, CreatedAt, CommandJson,
AssignmentJson. See integration/schedule/INSTALLATION.txt for exact routing,
authorization, private-version update and rollback requirements. New live storage
requires its specific authorization, existing legitimate session and confirmed
project/person/location references. Existing production and private v3 preserved.

No public deployment and no WhatsApp webhook enabled. Kapso code is an offline
adapter under review, not an operational message-to-OS integration. No credits,
credentials, OAuth grants, client messages, deletions or purchases were made.

Browser file selection failed because the extension lacks local-file URL access.
No permission was changed. Client-only JSON paste supplied the same private review.

## Reopen the private source after a reload

Open the Calendar URL on this computer. If the explicitly fictional local login
appears, use the fixture test identity only, never a real password. The private
source is reviewed exclusively in the first panel, not the scheduling save form.
Open ../private-inputs/schedule-source-review.json locally and copy its JSON into
"Alternativa: colar rascunho local". Valid input now previews automatically and
replaces the previous rows; it performs no network or browser-storage write.
The final five local-review tests and Vite build passed after this UI adjustment.

Snapshot packages exclude ../private-inputs entirely. The 0352 source snapshot
was scanned against source-specific names/locations: zero matches. It precedes
the final automatic-preview adjustment; use the later final snapshot if provided.
