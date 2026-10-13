# WhatsApp group membership

Local web app for collecting group registrations, optionally taking a Razorpay test payment, and issuing your existing WhatsApp group invitation link. A Playwright worker can open your own WhatsApp Web session for a single, best-effort add attempt. Unsaved numbers that WhatsApp will not show in the add-participant control stay on the invitation-link path. The app does not message people, import contacts, or try to get around WhatsApp limits.

Direct addition is off unless you set `DIRECT_ADD_ENABLED=true` after you have seen the number appear in WhatsApp’s normal add-participant control.

## What you need

- Node.js 20 or newer (Node.js 22 or 24 is fine) and npm
- A WhatsApp account that already administers the group
- Optional: Docker, only if you want MongoDB in a container
- Optional: Razorpay test keys, only if you turn payments on

## Install

From the project folder:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Install the Chromium build Playwright drives:

```bash
npm run playwright:install --prefix backend
```

On Windows PowerShell the same commands are:

```powershell
npm install --prefix backend
npm install --prefix frontend
npm run playwright:install --prefix backend
```

macOS and Linux use the same npm commands. On Linux, Playwright may ask for additional system libraries; the installer prints the packages if they are missing.

## Configure

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

1. Set `ADMIN_PASSWORD` to at least 8 characters and `TOKEN_SECRET` to at least 16 characters.
2. Set `GROUP_INVITE_LINK` to your real `https://chat.whatsapp.com/...` link.
3. Leave `PAYMENTS_ENABLED=false` until you want Razorpay.
4. Leave `DIRECT_ADD_ENABLED=false` unless you have confirmed WhatsApp Web can select the number.
5. Leave `DATABASE=file` to store registrations in `backend/data/state.json`.

`.env`, `backend/data/`, and the WhatsApp profile in `backend/data/wa-profile` are gitignored. Do not commit them.

## Run

Use two terminals, both starting in the project folder.

Backend:

```bash
npm run dev:backend
```

Frontend:

```bash
npm run dev:frontend
```

Open http://localhost:5173. The API listens on http://localhost:4000. The Vite dev server proxies `/api` to the backend.

## First WhatsApp Web login

You only need this when you want the optional direct-add check. Invitation links work without it.

Stop the backend first if it is running, then:

```bash
npm run whatsapp:login
```

A Chromium window opens to WhatsApp Web. Scan the QR code from your phone. When the chat list is visible, press Ctrl+C. Later runs reuse `backend/data/wa-profile`. The app never asks for your WhatsApp password or session cookies.

With the backend running, you can also sign in to the dashboard and choose **Open WhatsApp Web**.

## Try the invitation flow

1. Put a real invitation link in `.env` or on the dashboard settings form.
2. Submit the registration form with your name, a phone number that includes the country code, and consent.
3. Open the status page. When payments are off, it should reach **Invitation ready** and show the link.
4. Submit the same number again. The form should report that the number is already registered.
5. Sign in at http://localhost:5173/admin and search by name, phone, or registration id.

The public status page receives the invitation link only after validation and, when payments are on, after the server verifies the payment.

## Payments

Keep `PAYMENTS_ENABLED=false` for normal local use. To try Razorpay test mode:

1. In the Razorpay dashboard, copy the test key id, test key secret, and a webhook secret.
2. Set `PAYMENTS_ENABLED=true` and fill `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
3. Set `PAYMENT_AMOUNT` in minor units (`49900` means INR 499.00) and `PAYMENT_CURRENCY`.
4. Restart the backend.
5. Register, then pay with Razorpay’s test cards. The checkout success screen is not treated as proof. The server checks the signature, order id, amount, currency, and captured status.
6. For webhooks, expose the API and point Razorpay at `POST /api/payments/webhook`.

Do not put the key secret or webhook secret in the React app. Do not use live keys while you are still testing.

## MongoDB

With Docker:

```bash
docker compose up -d
```

In `.env`:

```text
DATABASE=mongo
MONGODB_URI=mongodb://127.0.0.1:27017/whatsapp_group
```

Restart the backend. If MongoDB is down, the API reports that the database is unavailable instead of silently switching storage.

## Tests

```bash
npm test
```

The tests cover phone validation, duplicate numbers, payment signature checks, locked admin routes, the one-at-a-time queue, login-state detection, browser failures, the invitation fallback, and status changes. They use an in-memory store and a fake payment client. They do not open WhatsApp or charge a card.

## Dashboard actions

- **Mark reviewed** records that you looked at the registration. It does not change membership.
- **Mark awaiting confirmation** means you are not treating the person as added yet.
- **Confirm membership** stays disabled until you check the box saying you saw them in the group. That is an attestation, not an automatic WhatsApp callback.
- **Retry task** is available only for failed jobs marked safe to retry, such as a closed browser or a QR login that is now complete. A number WhatsApp will not select is not retried in a loop.

## Revoking an invitation link

If the link is shared outside the people you meant to admit:

1. In WhatsApp, open the group, then the group invite settings, and revoke the link.
2. Create a new invitation link.
3. Paste it into the dashboard settings and save.

The previous link stops working when WhatsApp revokes it. Update the dashboard so new eligible registrations see the replacement.

## API

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/registrations` | Public. Creates a registration. |
| `GET` | `/api/registrations/:id` | Public status. Invitation link only after eligibility. |
| `POST` | `/api/payments/create-order` | Creates a Razorpay order when payments are enabled. |
| `POST` | `/api/payments/verify` | Verifies Checkout on the server. |
| `POST` | `/api/payments/webhook` | Verifies the Razorpay webhook signature. |
| `POST` | `/api/admin/login` | Returns a bearer token. |
| `GET` | `/api/admin/registrations` | Admin list and counts. |
| `POST` | `/api/admin/registrations/:id/retry` | Retries an eligible failed task. |
| `GET` | `/api/admin/automation/status` | Browser worker and queue status. |

Admin settings, review, admission, confirmation, logs, and the WhatsApp session check are also under `/api/admin` and require the bearer token.

## Publish the register page on aaPanel

The address `http://localhost:5173` only works on your computer. On the server, build the site once and let the API serve it. aaPanel’s website then proxies your domain to that one Node process. Visitors open `https://your-domain` and get the same register page.

On the Linux server, in the project folder:

```bash
npm install --prefix backend
npm install --prefix frontend
npm run playwright:install --prefix backend
npx --prefix backend playwright install-deps chromium
npm run build
```

Edit `.env` before the first public start:

```text
NODE_ENV=production
PORT=4000
FRONTEND_ORIGIN=https://your-domain
TRUST_PROXY=true
WHATSAPP_HEADLESS=true
ADMIN_PASSWORD=a-long-unique-password
TOKEN_SECRET=a-long-unique-random-string
```

Use your real domain, with `https://`. Replace the admin password and token secret. Do not leave the sample values. Keep `PAYMENTS_ENABLED=false` until Razorpay live keys are ready.

In aaPanel, add a Node project:

- Project directory: the folder that contains `backend` and `frontend`
- Start command: `npm start`
- Port: `4000`

Then open the website for that domain, turn on SSL, and set a reverse proxy to `http://127.0.0.1:4000`. Leave port 4000 closed on the public firewall. People should only reach the site through 80 and 443.

The Windows WhatsApp profile does not work on Linux. After the site is up, sign in at `https://your-domain/admin`, choose **Open WhatsApp Web**, and scan the QR code shown there. The server profile is stored in `backend/data/wa-profile`.

`WHATSAPP_HEADLESS=true` is for a server with no desktop. If Chromium fails to start, install a virtual display and start the app with a screen instead:

```bash
sudo apt-get install -y xvfb
WHATSAPP_HEADLESS=false xvfb-run -a npm start
```

Registrations from one network are limited to 100 every 15 minutes. Adds still run one at a time through the single WhatsApp login on this server.

## Troubleshooting

- **QR code every time.** Leave the Chromium profile in `backend/data/wa-profile`. Do not delete that folder, and do not run two automations against it at once.
- **Chromium missing.** Run `npm run playwright:install --prefix backend`.
- **WhatsApp UI changed.** The add attempt runs once. If the controls are not found, the registration falls back to the invitation link and the dashboard log records `interface_changed` when a screenshot was captured.
- **Number not in the picker.** That is expected for most unsaved numbers. The status becomes invitation ready, or pending admission in approval mode. The job is not retried automatically.
- **Port already in use.** Change `PORT` in `.env`, and the Vite proxy in `frontend/vite.config.js` if the API is not on port 4000.
- **Admin sign-in fails.** Check `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `TOKEN_SECRET`, then restart the backend.
- **Payment stays pending.** The webhook or verify call must match the amount, currency, and order id. A Checkout popup alone does not unlock the invitation.

## Project layout

```text
frontend/src    React registration page, status page, and admin dashboard
backend/src     Express API, file or MongoDB storage, payment checks
backend/src/automation   Queue, membership decisions, Playwright worker
backend/test    Automated tests
```
