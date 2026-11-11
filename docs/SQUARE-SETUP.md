# Switching on card payments on the donate page

Status: scaffolded, **not tested against Square**. The code was written without credentials and has never talked to Square, in the sandbox or in production. Lines marked `VERIFY:` in the code are Square details to confirm in the sandbox before any real card is charged.

Until this is done, the donate page keeps working as it does now: the donor finishes on Square's hosted checkout page and types the amount again there.

## What changes for the donor

- Card details are typed on the JDF donate page, the amount is passed automatically, and the donor never leaves the site.
- Monthly giving works.
- The receipt email is sent when Square confirms the payment.

## Card security (PCI)

The card fields are an iframe served by Square. Card numbers go straight from the donor's browser to Square. The JDF site and its server never see or store them; they only handle a one-time token. This keeps JDF in the simplest PCI category (SAQ A). Do not add any card field of our own to the page.

## Fees

Square charges a processing fee on every online card payment, a percentage plus a fixed amount per transaction. Check the current rate on Square's pricing page for JDF's account, and ask Square whether JDF qualifies for a nonprofit rate. A $180 gift therefore deposits a little under $180. The receipt shows the full gift amount.

## 1. What David does in Square (about 15 minutes)

He signs in at developer.squareup.com with the JDF Square login.

1. **Create an application.** Name it "JDF Website".
2. **Open the application and switch to Production.** Copy:
   - Application ID
   - Access token
3. **Locations.** Copy the Location ID of the JDF location that should receive donations.
4. **Monthly giving plan.** In the Square Dashboard (not the developer site), under Subscriptions, create one plan called "Monthly gift" billed monthly. Copy its plan variation ID. Brandon can pull this ID through the API if it is not shown on screen.
5. **Webhook.** In the application, under Webhooks > Subscriptions, add a subscription:
   - URL: `https://<site>/api/square-webhook` (the real domain, exactly as typed, no trailing slash)
   - Events: `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, `invoice.payment_made`, `subscription.created`, `subscription.updated`
   - Copy the **Signature key** shown after saving.
6. **Sandbox.** On the same application, switch to Sandbox and copy the sandbox Application ID, access token and location ID as well, so testing never touches real money.
7. While in the Square Dashboard, replace the stretched logo on the hosted checkout page (Jared flagged it on the call).

## 2. What to hand over

| Value | Secret? | Goes where |
|---|---|---|
| Application ID | No | `js/config.js` |
| Location ID | No | `js/config.js` and Vercel |
| Access token | **Yes** | Vercel only |
| Webhook signature key | **Yes** | Vercel only |
| Monthly plan variation ID | No | Vercel |

Send the two secrets through a password manager or a one-time link, not WhatsApp or email. An access token can move money out of the Square account.

## 3. Vercel environment variables

Project > Settings > Environment Variables, then redeploy.

| Name | Value |
|---|---|
| `SQUARE_ACCESS_TOKEN` | the access token |
| `SQUARE_LOCATION_ID` | the location ID |
| `SQUARE_ENVIRONMENT` | `sandbox` while testing, then `production` |
| `SQUARE_API_VERSION` | the version shown on the application page, for example `2025-01-23` |
| `SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID` | the monthly plan variation ID |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | the signature key |
| `SQUARE_WEBHOOK_URL` | the exact webhook URL registered in step 1.5 |
| `RECEIPT_TAX_STATEMENT` | the accountant-approved sentence for receipts (optional; nothing about tax status is printed without it) |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` and `STAFF_NOTIFY_TO` are already on the list for the forms.

Then, in `js/config.js`, fill in the two public values:

```js
SQUARE_APPLICATION_ID: 'sq0idp-...',
SQUARE_LOCATION_ID: 'L...',
SQUARE_ENVIRONMENT: 'sandbox' // then 'production'
```

Sandbox and production values must not be mixed: a sandbox application ID only works with a sandbox token and `SQUARE_ENVIRONMENT=sandbox`.

## 4. Database

Run `db/square.sql` once on the JDF Supabase project, after `db/schema.sql`. It adds the monthly gifts table and the extra columns on donations.

## 5. Change on the donate page

Not applied yet. Two lines in `donate.html`, and about six in `js/donate.js`.

`donate.html`, in step 3 just above the "Continue to secure checkout" button, and next to the other scripts:

```html
<div id="give-card"></div>
<script src="js/config.js"></script>
<script src="js/square-pay.js"></script>   <!-- both before js/donate.js -->
```

`js/donate.js`:

```js
var card = null;   // next to `var state = ...`

// in go(n), after `if (n === 3) summary();`
if (n === 3 && !card && window.JDFSquare && JDFSquare.isEnabled())
  JDFSquare.mount(document.getElementById('give-card')).then(function (c) { card = c; }, function () { card = null; });

// in the submit handler, in place of `var timer = setTimeout(leave, 2500);`
var timer = card ? null : setTimeout(leave, 2500);

// and in place of the final `.then(function () { clearTimeout(timer); leave(); });`
.then(function () {
  if (!card) { clearTimeout(timer); return leave(); }
  return card.tokenize()
    .then(function (token) { return JDFSquare.pay({ token: token, amount: state.amount, frequency: state.freq, donor: data() }); })
    .then(function () { location.href = 'thank-you.html'; },
          function (err) { if (err.code === 'not_configured') return leave(); showPayError(err.donorMessage); });
});
```

Two small things this needs that do not exist yet: a `thank-you.html` page, and a `showPayError(message)` that prints the message above the button and re-enables it. If the card form fails to load, `card` stays `null` and the page falls back to the hosted checkout, so a gift is never blocked.

Do **not** send the donor to the hosted checkout after an error with code `unknown_outcome` or `network`. The charge may have gone through; the message tells them to press the button again, which is safe because the same idempotency key is reused.

## 6. Test in the sandbox first

1. Set everything to sandbox values and deploy to the preview project.
2. On the donate page, give $18 once with Square's sandbox test card: Visa `4111 1111 1111 1111`, CVV `111`, any future expiry, any ZIP. Confirm the test card numbers on Square's "Sandbox payments" page; it also lists numbers and CVV/ZIP values that force a decline.
3. Check, in this order:
   - the payment appears in the Sandbox Seller Dashboard
   - a row appears in `donations` with the right amount and the donor's choices (anonymous, dedication)
   - the webhook log in the developer dashboard shows 200 responses
   - exactly one receipt email arrives, even if you resend the same webhook event from the dashboard
4. Force a decline and confirm the page shows a clear message and does not record a donation.
5. Press the give button twice quickly and confirm there is one charge.
6. Give $18 monthly. Confirm a subscription exists in Square for $18, not for the plan's default price. This is the least certain part of the code (see the `VERIFY (important)` note in `api/square-pay.js`).
7. Refund the test payment from the sandbox dashboard and confirm the donation row is marked refunded.
8. Only then switch all values to production and repeat step 2 once with a real card for $1, then refund it.

## Known gaps

- **Per-donor monthly amounts.** The code sets the amount with `price_override_money`. Per Square's developer forum (checked 11 Nov 2026), that override only takes effect on a plan variation with static pricing; on a relative-priced variation it is ignored. So the monthly-giving plan must be created with a static-price variation, and the first invoice amount has to be confirmed in the sandbox before monthly giving is offered.
- **Raw request body on Vercel.** The webhook signature needs the untouched bytes of the request. The code tries three ways to get them and refuses the event if it cannot. Confirm on the deployed project with a test event.
- **Cancel or change a monthly gift.** Nothing on the site does this yet. Until it exists, David cancels a subscription from the Square Dashboard on request.
- **Founders Club seat numbers.** The webhook has a marked TODO where the seat number is assigned on a completed founder-level gift.
- **The donation-intent id.** `/api/intake` does not return the id of the row it stores, so the paid gift is matched to the donor's typed details by email and amount within a two-hour window. Returning the id from intake would make that exact.
