# Contact enquiry delivery operations

## Scope

This runbook activates the Contact-page delivery path implemented as:

`GitHub Pages -> Cloudflare Turnstile -> Cloudflare Worker -> Resend -> info@blueshieldrobotics.com`

It does not require Microsoft 365 administrator access. Do not change the existing root-domain MX records, Microsoft email TXT records, GoDaddy nameservers, or GitHub Pages website records.

No account, DNS, secret, or deployment step below has been performed by the local implementation.

## Prerequisites

- A Cloudflare account able to create a Turnstile widget and deploy a Worker.
- A Resend account able to verify a sending domain and create an API key.
- GoDaddy DNS access for `blueshieldrobotics.com`.
- Node.js and npm for the `worker/` project.

The public Turnstile site key and Worker URL belong in `contact-config.js`. The Turnstile secret and Resend API key belong only in Cloudflare Worker secrets.

## 1. Verify a dedicated Resend sending subdomain

1. In Resend, add `notify.blueshieldrobotics.com` as a sending domain.
2. Copy the exact SPF, DKIM, and return-path records shown by Resend into GoDaddy DNS.
3. Add records only under the `notify` subdomain. Do not replace the root `@` MX record or any Microsoft 365 record.
4. Wait until Resend marks the domain as verified.
5. Create a Resend API key scoped to sending access.

The Worker is already configured to use:

- From: `Blue Shield Robotics Website <website@notify.blueshieldrobotics.com>`
- To: `info@blueshieldrobotics.com`
- Reply-To: the validated visitor email address

## 2. Create the Turnstile widget

1. In Cloudflare Turnstile, create a managed widget for:
   - `blueshieldrobotics.com`
   - `www.blueshieldrobotics.com`
2. Record the public site key and secret key separately.
3. Keep the expected action as `contact_enquiry`; the browser and Worker validate the same value.

## 3. Configure and deploy the Worker

From `worker/`:

```powershell
npm install
npx wrangler login
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npm test
npm run deploy
```

Each `secret put` command prompts for the value. Do not paste real keys into `.dev.vars.example`, `wrangler.jsonc`, documentation, browser JavaScript, terminal commands, or Git history.

After deployment, record the HTTPS Worker URL. The Contact endpoint is that URL plus `/contact`, for example:

```text
https://blueshield-contact.<account-subdomain>.workers.dev/contact
```

The production Worker configuration already allows exact origins for the apex and `www` domains, fixes the recipient and sender, verifies the Turnstile hostname/action, limits requests, and enables Worker observability.

## 4. Activate the public form

Edit only the public values in root `contact-config.js`:

```js
globalThis.BLUE_SHIELD_CONTACT_CONFIG=Object.freeze({
 apiEndpoint:'https://blueshield-contact.<account-subdomain>.workers.dev/contact',
 turnstileSiteKey:'<public-site-key>',
 turnstileAction:'contact_enquiry',
 turnstileScriptUrl:'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
});
```

The site deliberately leaves the send button unavailable while either public value is blank. The direct email link remains usable.

The browser coordinator renders Turnstile explicitly with `language: 'en'` so the security widget remains English on the English-language site regardless of the visitor's browser locale.

Commit, push, and GitHub Pages publication are separate approval steps. Do not deploy the static change until the Worker and Turnstile configuration are ready.

## Local verification

Automated verification never calls Turnstile, Resend, or a real mailbox:

```powershell
node --test tests/*.test.mjs worker/test/*.test.mjs
```

For manual local integration:

1. Copy `worker/.dev.vars.example` to the ignored `worker/.dev.vars` and insert development-only values.
2. Run `npm run dev` inside `worker/`.
3. Serve the repository root at `http://127.0.0.1:4174`.
4. Temporarily point `contact-config.js` to `http://127.0.0.1:8787/contact` and use Cloudflare's official testing site key and secret key.
5. Set `TURNSTILE_ALLOW_TEST_RESULT="true"` only in the local Worker environment. This accepts Cloudflare's explicitly marked testing result without weakening the production hostname/action checks; never add this value to production Worker configuration or secrets.
6. Restore the tracked public config before committing.

## Production verification

1. Open the Contact page and confirm the Turnstile challenge becomes ready.
2. Submit one approved, non-sensitive test enquiry.
3. Confirm the browser reports `Enquiry received` only after HTTP 202.
4. Confirm one email appears in `info@blueshieldrobotics.com` and Reply-To uses the test visitor address.
5. Confirm the Resend activity log reports one accepted message.
6. Confirm Cloudflare Worker logs contain the request ID and status but no name, email, organisation, mission text, token, or secret.
7. Repeat a failure-path check without sending sensitive information; form fields must remain populated.

Useful commands:

```powershell
npx wrangler tail
curl.exe -i -X OPTIONS "https://<worker-url>/contact" -H "Origin: https://blueshieldrobotics.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: Content-Type"
```

## Monitoring

- Monitor Cloudflare Worker 4xx, 429, 5xx, and latency trends.
- Monitor Resend daily/monthly usage, provider warnings, and domain verification status.
- A `contact_delivery_failed` event or sustained 5xx rate requires investigation; ordinary validation and rate-limit events do not.
- Never copy enquiry bodies or visitor identifiers into logs or support tickets unless handled through an approved secure channel.

## Rollback

To stop online delivery without removing the Contact page, blank `apiEndpoint` and `turnstileSiteKey` in `contact-config.js`, publish that static change, and leave the verified direct email visible. Disabling or deleting Worker secrets alone produces a visible service-unavailable error but is not the preferred visitor experience.
