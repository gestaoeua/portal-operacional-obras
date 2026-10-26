# Production authentication and release plan

Status: design only. No identity provider, OAuth grant, credential, account, deployment or sharing permission has been created or changed.

## Recommended path

Use Google sign-in for the initial internal team, with a server-side BFF (backend for frontend). Reuse this React application and existing Sheet IDs/row IDs. Retire direct browser-to-Apps-Script password authentication when the new service is validated. Do not migrate SHA-256 password hashes into another database or ask people to reuse those passwords.

The server must verify Google ID tokens with the official maintained verification library, checking the configured client audience, issuer, expiry and verified email. Decoding a JWT or trusting a browser-provided email/role is insufficient. Identity records should use Google's immutable `sub`; email can support an explicitly approved initial invitation, never automatic domain-wide enrollment. Store approved account/role/project grants server-side. Initial roles stay executor/gestor/diretor; customer roles remain disabled until object-level scope is designed and approved.

After verification, exchange the short-lived ID token for a server session in an HttpOnly, Secure, SameSite cookie. Use origin/CSRF protection for mutations, explicit idle/absolute expiry, durable revocation and durable rate limiting. Do not store refresh/access/session tokens in localStorage. Never place a service-account key or any secret in VITE_ variables or the repository.

Private Sheets access belongs solely to the server identity. Prefer workload identity/short-lived credentials supported by the selected host. If a credential is necessary, the user must complete secure entry and approve the persistent access; no key in chat. Grant only the existing necessary workbooks and no general Drive access. Customer photos/documents need their own per-object authorization and cannot be served as static public assets.

## Preserve existing work

- Keep `Salas`/`Registros` on the existing backend workbook and preserve MARK and visit IDs
- Read only the `OS` tab from the separate OS workbook, preserving OS IDs
- Keep project-cost sources separate; do not join by city or guessed address
- Add mappings only through an approved, reviewed reconciliation step with provenance
- Validate divergent copies before any migration; preserve originals and backups
- Keep OS status as original text until transition rules are explicitly approved

## Operational semantics to implement before writes

- Server-generated event ID and idempotency key per field command
- Unique open visit per worker, enforced transactionally
- Immutable completion event; corrections append a new audited correction with reason
- OS state transitions checked on the server against current revision and approved role
- `Ready to Rent` requires explicit checklist completion, required evidence, reviewer identity and approval timestamp; a finalized room or trash-removal service does not qualify
- Before/after photos carry OS ID, phase, uploader and timestamp; store private object references, not embedded public URLs
- Durable write journal/outbox and reconciliation for any Sheet projection, or use a transactional store as the command source of truth with Sheets remaining a reporting projection

## Decisions and approvals still required

1. Initial audience and exact approved users: managers only, field team, and/or customers
2. Existing Google Workspace/identity and hosting account to use, plus any cost ceiling
3. OAuth client/consent configuration, persistent server identity and minimum workbook access
4. Safe staging workbook, backup and rollout/rollback owner
5. Actual business owner for quality/ready-to-rent approval and project/customer visibility

Production is blocked until those decisions, credential grants and runtime verification are complete. Local tests do not authorize deployment or grant access.

## Acceptance tests for the next increment

Reject forged/expired/wrong-audience/unverified tokens, unknown identities, disabled users, unauthorized project/OS/photo access and missing CSRF. Prove logout/revocation, browser refresh, interrupted login, parallel clicks, replayed commands, conflict/version handling and error recovery. Test against private staging sources with no real employee/customer data in fixtures. Verify actual desktop/mobile rendering and Google redirect/CORS/session behavior before rollout.
