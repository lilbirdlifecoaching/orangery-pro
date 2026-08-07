# Orangery Proposal System

Local proposal builder + client proposal page for `orangery.team` engagements.

## Files

- `proposal-builder.html` — internal tool for Luke to assemble proposals
- `proposal.html` — client-facing proposal, contract summary, signature, PDF, payment
- `worker/src/index.js` — includes `POST /proposals/checkout` for Stripe Checkout

## How to use

1. Open `proposal-builder.html` locally (or once deployed).
2. Enter client details, choose duration/services, adjust prices, add custom items, set discount.
3. Click **Open client proposal** to preview, or **Copy share link** to send the client a URL.
4. Client reviews process + investment + agreement, signs, then clicks **Accept & pay securely**.
5. Client can also use **Download / print PDF** at any time (browser Print → Save as PDF).

## Stripe setup

1. In Stripe, get your Secret Key (`sk_test_...` for testing, `sk_live_...` for live).
2. In Cloudflare Worker secrets for `orangery-relational-dynamics`, add:

```bash
STRIPE_SECRET_KEY
```

Or in the Cloudflare dashboard: Worker → Settings → Variables → Encrypt `STRIPE_SECRET_KEY`.

3. Redeploy/update the worker with the latest `worker/src/index.js` that includes `/proposals/checkout`.
4. Confirm `proposal.html` has the correct worker URL in:

```html
<meta name="orangery-worker-url" content="https://YOUR-WORKER.workers.dev">
```

## Notes

- Proposal links encode the proposal data in the URL hash (no database required).
- Signature + payment: client must sign before Stripe Checkout starts.
- Checkout amount is the exact proposal total (custom Stripe amount via Checkout Session `price_data`).
- Duration coaching discounts default in the builder and can be overridden.
- Workshop packages follow engagement length defaults and can be price-overridden.
- The agreement section is a practical services summary, not formal legal counsel. Swap in stronger legal wording if needed.
