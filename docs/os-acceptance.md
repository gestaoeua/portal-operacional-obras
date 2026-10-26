# Acceptance gates for the work-order pilot

This is an implementation checklist, not evidence of completion. Use synthetic projects/users and a private staging workbook only after authorization. Never point fixture tests at operational sources.

## Required successful flow
1. An authorized manager selects an explicitly granted project.
2. Create an OS with the supplied scope; absent optional fields remain blank.
3. Receive a persisted ID and revision only after server confirmation.
4. Reload from authoritative storage, then reopen the same OS by ID.
5. Assign an active responsible person explicitly granted to that project.
6. Advance Recebida → Em conferência → Programada → Em execução → Aguardando validação → Concluída, with required fields enforced on the server.
7. Reload and verify all transitions and assignment in persisted history, with server time and authenticated actor.
8. If reopening a completed order is supported, require an explicit reason and preserve the earlier conclusion event.

## Required denial/recovery cases
- Project A session attempts list/detail/write/history on Project B; deny before revealing rows.
- A forged request changes actor, role, project, responsible user or status; server grants and transition policy prevail.
- Disabled/removed membership or responsible user cannot be used by an existing session.
- Concurrent updates from the same revision: exactly one succeeds; the other receives a conflict and reloads.
- Double submission with the same request ID: no duplicate order/history. Same ID with a different command must conflict.
- Failure before write, after write, and during flush: show unconfirmed outcome; reconcile by request ID before another mutation.
- Missing/duplicate/reordered schema columns and malformed persisted rows: fail closed, without repairs or migration during a request.
- Formula-like text and HTML remain data; no execution in Sheets or browser.
- Network error or expired session never displays a successful save.
- Source OS rows lacking explicit project links are not silently assigned to a default project.
- Script locks do not protect direct Sheet edits or other scripts: deployment plan must address this limitation.

## WhatsApp-specific gates
- Unauthenticated callback, fake verification header/query, unsupported media/group and unapproved sender: no OS persistence.
- Confirmed provider event with explicit pilot/project mapping: one draft with preserved source message ID; no inferred address, dates or responsible person.
- Redelivery/replay cannot create another draft or overwrite a manager's edits.
- Callback acceptance is not success until the durable draft/order commit is confirmed.
- Receiver stays disabled until provider-authentication contract, pilot scope and deployment are approved and tested.

## Release evidence
Report independently run tests separately from third-party reports. Local VM mocks and fixture browser tests do not prove live Apps Script CORS, quotas, durability or WhatsApp delivery. Production publication requires the exact reviewed artifact, explicit destination, scoped migration/configuration plan and operator validation.
