# Contact Enquiry Delivery

Status: local implementation and automated verification complete; external accounts, DNS, secrets, live delivery verification, and deployment are not yet configured

## Concept Brief

- Current stage: implementation of the selected MVP.
- Target users: prospective government, enterprise, public-safety, and industrial customers submitting an enquiry; the Blue Shield Robotics team receiving it at `info@blueshieldrobotics.com`.
- Core problem: the current form only displays a placeholder message and does not deliver the visitor's enquiry.
- Core concepts:
  - An enquiry submission is one validated request from the website contact form.
  - Enquiry delivery is the server-side acceptance of that request and hand-off to the configured email provider.
  - Delivery acceptance is not a guarantee that a mailbox provider has completed final delivery.
  - The visitor email is a reply-to address, not a sender identity.
- MVP boundary: a GitHub Pages form posts to a Cloudflare Worker; the Worker validates the request, verifies Turnstile, applies rate limiting, and submits one notification email through Resend.
- Non-goals: operating an SMTP server, storing enquiries in a database or CRM, attachments, marketing subscriptions, automatic customer replies, or accepting classified/security-sensitive operational information.
- Key assumptions:
  - The canonical recipient is `info@blueshieldrobotics.com`.
  - GoDaddy DNS access is available for a dedicated Resend sending subdomain such as `notify.blueshieldrobotics.com`.
  - Microsoft 365 administrator access is not available and is not required by this design.
  - Initial enquiry volume fits within the Cloudflare Workers and Resend free tiers.
- Confirmed decision: use Cloudflare Worker + Turnstile + Resend rather than Microsoft Graph, Formspree, or a self-operated SMTP service.

## Unified Language

- Enquiry: the visitor-provided request type, identity, organisation, sector, and mission context.
- Submission ID: a browser-generated UUID retained across retries of the same enquiry.
- Request ID: the correlation identifier returned and logged by the Worker; it equals the validated submission ID.
- Delivery acceptance: Resend accepted the idempotent send request.
- Sensitive information: classified, export-controlled, security-sensitive, or operationally sensitive material that must not be submitted through the public form.

## Feature Spec

### Business rules

1. Only `POST /contact` may create an enquiry; all other paths and unsupported methods are rejected.
2. The Worker accepts requests only from configured production origins and never treats CORS as the sole anti-abuse control.
3. Request type and sector must match documented enumerations; all strings are trimmed and length-bounded at the server boundary.
4. Name and email are required. Organisation and mission context are optional in the MVP.
5. The destination, sender, subject prefix, Resend endpoint, and Turnstile endpoint are server configuration. Visitors cannot control mail headers or recipients.
6. A valid Turnstile token and an allowed hostname/action are required before email delivery.
7. The platform rate limiter is evaluated for each accepted-origin submission attempt. No in-memory rate counter is used.
8. The browser retains one submission ID across recovery attempts. The Worker forwards it as Resend's `Idempotency-Key`, preventing duplicate email sends for 24 hours.
9. Honeypot submissions return a generic accepted response without sending email and emit a non-PII abuse log event.
10. The browser displays success only after the Worker reports delivery acceptance. On errors or timeouts, visitor fields remain populated and the visitor can retry.
11. Neither browser nor Worker logs contain names, email addresses, organisations, mission text, Turnstile tokens, or provider secrets.
12. The public form clearly warns visitors not to submit classified or sensitive operational information and retains the direct email fallback.
13. The browser saves only the six ordinary enquiry fields in current-tab session storage, restores them after a refresh, and clears the draft after delivery acceptance. It never persists the honeypot, Turnstile token, submission ID, button state, or status message.

### User flow

#### Primary flow

1. The visitor opens the Contact page and selects an enquiry type.
2. If the current tab contains an unfinished draft, the browser restores its ordinary enquiry fields while starting a fresh Turnstile challenge.
3. Turnstile establishes a valid challenge token.
4. The visitor completes the form and selects `Send enquiry`.
5. The browser disables duplicate submission, sends JSON to the configured Worker, and announces progress.
6. The Worker validates origin, configuration, rate limit, JSON schema, honeypot, and Turnstile.
7. The Worker constructs a fixed notification and calls Resend with the submission ID as the idempotency key.
8. On provider acceptance, the Worker returns HTTP 202 and the browser announces success, clears the submitted values, and removes the current-tab draft.

#### Recovery flow

- Validation error: the Worker returns field-safe details; the browser shows a correction message without clearing the form.
- Expired or failed Turnstile challenge: no email is sent; the widget resets and the visitor completes a new challenge.
- Rate limit: the Worker returns HTTP 429; the browser tells the visitor to wait or use the direct email address.
- Provider/network failure: the Worker returns a stable 5xx error; the browser preserves the submission ID and entered values so retry remains idempotent.
- Missing public configuration: the online send button is unavailable and the direct company email remains visible.
- Accidental refresh: the browser restores the current tab's ordinary fields, starts a new Turnstile challenge, and does not restore any prior success/error state.
- Unavailable browser storage: draft persistence degrades without blocking the form or submission path.

### Domain model impact

No database or persisted customer record is introduced. The authoritative request exists only for the duration of the Worker request and in the configured email provider's normal processing/retention boundary. Resend is the delivery provider; the Blue Shield mailbox remains the operational destination.

## API Contract

### Caller

The browser contact form calls the Worker synchronously over HTTPS. It is the only supported client in the MVP.

### Endpoint

`POST /contact` is a command endpoint because it performs delivery rather than CRUD over a persisted enquiry resource.

### Request

Content type: `application/json`

| Field | Required | Contract |
|---|---:|---|
| `submissionId` | yes | UUID, used for correlation and idempotency |
| `requestType` | yes | `capability-briefing`, `demonstration`, `pilot-program`, or `general-enquiry` |
| `name` | yes | trimmed string, 1-100 characters |
| `organisation` | no | trimmed string, maximum 160 characters |
| `email` | yes | valid email syntax, maximum 254 characters |
| `sector` | yes | one documented sector slug |
| `mission` | no | trimmed string, maximum 4,000 characters |
| `website` | no | honeypot; legitimate visitors leave it empty |
| `turnstileToken` | yes | opaque Turnstile token, maximum 2,048 characters |

### Response

- `202`: `{ "ok": true, "requestId": "<uuid>" }`
- Every JSON error: `{ "ok": false, "error": { "code": "<stable-code>", "message": "<safe-message>", "details": [...] }, "requestId": "<uuid>" }`
- Relevant statuses: `400`, `403`, `404`, `405`, `415`, `422`, `429`, `502`, and `503`.

The frontend branches on HTTP status and `error.code`, never by parsing error prose.

### Idempotency

The browser reuses `submissionId` until one submission succeeds. The Worker sends `contact-enquiry/<submissionId>` as Resend's `Idempotency-Key`. A retry with the same payload therefore returns the original provider result without sending another email. A successful submission generates a new ID for the next enquiry.

### Evolution

This is a new unpublished API. The only static consumer is the Contact page in this repository, so frontend and Worker can switch together before the first deployment. No compatibility alias or version bridge is required.

## Design Plan

- Change goal: replace the non-functional contact placeholder with a secure, observable delivery path without moving the static site off GitHub Pages.
- Impacted domains: Contact-page interface, enquiry submission orchestration, Cloudflare Worker boundary, Turnstile verification, and Resend delivery. Navigation, product content, hero design, and Microsoft 365 DNS remain unaffected.
- Placement:
  - Contact-page rendering remains in root `site.js`;
  - browser submission coordination is isolated in root `contact-form.js` and exercised directly by production-coordinator tests;
  - the public endpoint and Turnstile site key live in `contact-config.js`;
  - Worker code/config/tests live in `worker/` as the enquiry-delivery domain;
  - deployment instructions live in `docs/ops/`.
- Dependency direction: Contact UI -> Worker contract -> Turnstile/Resend adapters. Provider response details never leak into the browser contract.
- Model boundary: browser request JSON is explicitly mapped and validated by the Worker; Resend's email DTO is constructed from validated values and fixed server configuration.
- Rejected alternatives:
  - Microsoft Graph requires unavailable tenant administrator consent.
  - Formspree is simpler but gives less control over the API, delivery template, and abuse boundary.
  - A self-operated SMTP server adds deliverability, reputation, queue, bounce, TLS, and abuse-management responsibilities outside the MVP.
- Verification: pure validation/unit tests, default Worker handler tests with mocked external HTTP boundaries, production frontend submit-coordinator tests with mocked Worker fetch, static structure assertions, syntax checks, and manual browser checks after public keys are configured.

## Invariant Ledger

| Invariant | Authoritative source | Lock/transaction boundary | API projection | Frontend state | Regression verification |
|---|---|---|---|---|---|
| Visitors cannot choose mail headers or recipients | Worker environment configuration and request mapper | Single Worker request; no database transaction | Request schema excludes recipient/from/subject | Form contains no recipient/header controls | Worker test asserts fixed Resend DTO and reply-to mapping |
| One logical retry produces at most one provider email | Browser submission ID + Resend idempotency store | Resend `Idempotency-Key` retained for 24 hours | `submissionId` required; same request ID returned | ID persists through failure and resets only on success | Frontend duplicate/retry test and Worker provider-header assertion |
| Success is shown only after provider acceptance | Resend HTTP success response | Synchronous provider hand-off | Only provider 2xx maps to Worker 202 | loading -> success/error state machine | Default-handler success and provider-failure tests plus frontend coordinator test |
| Invalid, abusive, or unverified input sends no email | Worker validation, honeypot, rate binding, and Turnstile response | Checks finish before Resend call | Stable 4xx/429 errors; honeypot generic 202 | Error is announced and values remain | Boundary, honeypot, verification, and rate-limit tests |
| Operational telemetry contains no enquiry PII | Worker structured logger | Per-request event stream | `requestId`, event, status, latency, provider status only | No client logging of field values | Log-capture tests and final code review |

## Test Plan

| Scenario source | Risk | Level | Coverage |
|---|---|---|---|
| Valid enquiry | happy path | Worker integration/unit | Execute the production default handler with real validation/orchestration and mocked Turnstile/Resend HTTP boundaries; assert 202 and fixed provider DTO |
| Missing, malformed, oversized, or unsupported fields | empty/boundary | Worker unit | Parameterised request validation assertions; assert no provider call |
| Unauthorized origin and wrong route/method/content type | permission/contract | Worker integration/unit | Assert stable 403/404/405/415 responses and CORS behavior |
| Honeypot and Turnstile rejection | abuse/error | Worker integration/unit | Assert generic honeypot acceptance or verification error and zero Resend calls |
| Platform rate limit | concurrency/abuse | Worker integration/unit | Execute the real handler with a rejecting binding and assert HTTP 429 |
| Duplicate/retried request | idempotency | Worker + frontend | Assert Resend idempotency header and persistent browser submission ID across failure; rapid duplicate submit triggers one fetch |
| Resend 4xx/5xx or network failure | external dependency | Worker integration/unit | Assert safe 502 response, non-PII log, and no false success |
| Frontend success/error/timeout | UX/error | frontend production-coordinator test | Run the actual submit listener with mocked Worker fetch; assert busy/disabled/status/reset behavior and value preservation |
| Same-tab refresh | UX/recovery/privacy | frontend production-coordinator + browser | Assert six whitelisted fields restore, security state never persists, accepted delivery clears the draft, and storage failures do not block submission |
| Turnstile/DNS/real delivery | external integration | manual after account setup | Use Cloudflare/Resend dashboards and one approved live test enquiry; no live email is sent by automated tests |

## Observability Plan

- Critical path: browser submission -> Worker validation -> Turnstile verification -> Resend acceptance.
- Log events: `contact_request_received`, `contact_request_rejected`, `contact_request_rate_limited`, `contact_request_trapped`, `turnstile_verification_failed`, `contact_delivery_accepted`, and `contact_delivery_failed`.
- Log fields: event, request ID, origin, HTTP status, stage, duration, and provider status/code where available. No form content or tokens.
- Metrics: Cloudflare request count, 4xx/429/5xx rates, Worker latency, and Resend delivery activity. The MVP uses platform dashboards and structured Worker logs rather than adding a custom metrics store.
- Trace: the submission/request ID is returned to the browser, logged at each Worker stage, and incorporated into the Resend idempotency key.
- Alerting: after deployment, the operator should configure Cloudflare notification/observability checks for sustained Worker 5xx responses and monitor Resend quota/delivery warnings. Single rejected or rate-limited requests do not page an operator.
- Privacy: never log or expose secrets, Turnstile tokens, email addresses, names, organisations, or mission text.
- Verification: automated log-capture tests plus a post-deployment dashboard check using one approved non-sensitive test submission.

## Acceptance Scenarios

1. Given a valid challenge and valid enquiry, when the visitor submits once, then the Worker returns 202, exactly one Resend request is accepted, and the page announces success.
2. Given a transient browser or Worker response failure after provider acceptance, when the visitor retries the same enquiry, then the same submission ID/idempotency key is reused and no duplicate email is sent.
3. Given invalid input, a failed challenge, an unauthorized origin, or a rate limit, when the request reaches the Worker, then no email provider request occurs and the page displays a recoverable error.
4. Given Resend rejects or cannot process the request, when the Worker receives the failure, then the page does not show success, preserves entered values, and offers retry/direct email.
5. Given missing endpoint or Turnstile public configuration, when the Contact page loads, then the online submission action is unavailable and the verified direct email remains usable.
6. Given automated tests, when the test suite runs, then no real Turnstile or Resend request and no real email delivery occur.
7. Given an unfinished enquiry in the current tab, when the visitor refreshes the Contact page, then the six ordinary fields are restored, Turnstile starts fresh, and no hidden or security state is restored.
8. Given a delivery-accepted response, when the browser shows success, then the current-tab draft is removed and a later refresh does not repopulate the submitted enquiry.
