# WhatsApp input: verified options and remaining gates

Reviewed public W-API documentation on 2026-10-21. No account settings, tokens or real messages were inspected by this review.

- https://docs.w-api.app/webhook/update-webhook-received describes authenticated **configuration** using Bearer and a body with one `value` (HTTPS callback URL). It does not specify an incoming callback signature, timestamp, replay window or configurable authentication header. This is not evidence those features are impossible; it is insufficient to implement them by assumption.
- https://docs.w-api.app/webhook/fetch-webhook-logs documents a PRO-only authenticated GET with pagination, provider log IDs, event metadata and the original `request`. It states a 30-day provider retention window.

## Candidate alternative requiring validation
If the approved pilot instance supports PRO log retrieval and the user authorizes use of an existing server-side credential, a provider-authenticated pull of a bounded set of received-event logs could be the input source. Any unauthenticated callback would only be a wake-up hint, never trusted business data. Order content must come from the authenticated provider response and pass explicit pilot instance, sender, project, event type and idempotency checks.

This alternative is **not implemented or verified**. Before selecting it, establish that received-message events with required stable IDs/content are available when the callback fails or is unconfigured; confirm latency, pagination order, rate limits, error handling and plan availability. Do not promise a morning test on this assumption. Do not fetch broad third-party logs to validate it. Test only a dedicated, authorized pilot with synthetic content.

## Release gates
- Explicit authorization for the pilot instance, sender and project; no general-number webhook carrying unrelated third-party conversations.
- Documented and tested authentication path (signed callback or independently authenticated pull).
- Approved secret storage/use at action time, without putting credentials in the frontend, URL, repository, artifacts or logs.
- Durable idempotency keyed by provider/instance/message identity and explicit replay policy.
- Backend schema/configuration and deployment reviewed separately from this local preparation.
- Receiver remains disabled until these gates pass; no fake `verified=true` switch.
