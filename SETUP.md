# Date Spot Planner — Setup Guide

This guide covers the manual steps **you** must do (I can't click in cloud consoles).
Do them in order. After **Part D** we verify connectivity (`/api/health`) **before**
the rest of the app is built.

---

## Part A — Google Cloud project + Sheets API

1. Go to <https://console.cloud.google.com/> and sign in.
2. Top bar → project dropdown → **New Project**. Name it e.g. `date-spot-planner`. Create, then select it.
3. Open <https://console.cloud.google.com/apis/library/sheets.googleapis.com>, make sure your new
   project is selected, and click **Enable**.

## Part B — Service account + JSON key

1. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts> (project selected).
2. **Create Service Account**. Name e.g. `date-spot-sheets`. Click **Create and Continue**, then
   **Done** (no roles needed — access is granted by sharing the Sheet, not by project IAM).
3. Click the new service account → **Keys** tab → **Add Key** → **Create new key** → **JSON** →
   **Create**. A `.json` file downloads. **Keep it secret** — it is a credential.
4. Open the JSON. You need two fields:
   - `client_email`  → goes into `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key`   → goes into `GOOGLE_PRIVATE_KEY` (see the formatting note in Part D)

## Part C — Share your existing Sheet with the service account

1. Open your existing Google Sheet in the browser.
2. From its URL, copy the **Sheet ID** — the long string between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_IS_THE_ID`**`/edit`
   → goes into `GOOGLE_SHEET_ID`.
3. Click **Share**, paste the service account's `client_email`, set it to **Editor**, and
   **uncheck "Notify people"**. Send/Share.
4. Create a tab (bottom sheet tab) named exactly **`places`** (lowercase).
5. Click cell **A1** and paste this **exact** header row (tab-separated — pasting this single line
   fills A1:L1):

   ```
   id	place_name	lat	lng	maps_url	planned_date	status	visited_at	category	notes	created_at	updated_at
   ```

   > If pasting splits it oddly, type the 12 headers into A1–L1 manually, in this order:
   > `id, place_name, lat, lng, maps_url, planned_date, status, visited_at, category, notes, created_at, updated_at`

## Part D — Local environment variables

1. In the project folder, copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Fill in `.env`:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` = the `client_email`.
   - `GOOGLE_SHEET_ID` = the Sheet ID from Part C.
   - `SHARED_PASSPHRASE` = a long random passphrase (this gates the app for the two of you).
   - `FEED_TOKEN` = a long random string. Generate one with:
     `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
   - `APP_TIMEZONE` = leave as `Asia/Bangkok`.
   - `GOOGLE_PRIVATE_KEY` — **the #1 thing people get wrong.** The JSON's `private_key` contains
     real newlines. Put it on **one line** with literal `\n` escapes, wrapped in double quotes:

     ```
     GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n...==\n-----END PRIVATE KEY-----\n"
     ```

     The app does `.replace(/\\n/g, "\n")` to restore the newlines, so it must contain the literal
     two characters backslash-n, not actual line breaks. (If you copied the value straight from the
     JSON, it already has `\n` written out — just keep it on one line and wrap in quotes.)

### ✅ Verify connectivity (do this, then tell me the result)

Start the dev server and hit the health probe:

```bash
npm run dev
# in another terminal, or open in a browser:
curl http://localhost:3000/api/health
```

- **Success** looks like: `{"ok":true,"headerOk":true,"header":["id","place_name",...]}`.
  → Tell me, and I'll build the rest of the app (Stage 2).
- `"headerOk":false` → the sheet connected but row 1 doesn't match. Re-paste the header from Part C.
- `"ok":false` → read the `error`/`hint`. Usual causes: wrong/missing `GOOGLE_PRIVATE_KEY` format,
  sheet not shared with the service account, no `places` tab, or wrong `GOOGLE_SHEET_ID`.

### ⚠️ Corporate network (TLS inspection) — local dev only

On the KBANK network, a TLS-inspection proxy re-signs HTTPS with an internal CA that Node does
not trust by default, so the Sheets call fails with `unable to get local issuer certificate`.
Fix (already applied on this machine): point Node at the Windows trust store via a PEM bundle.

- A bundle was exported to `C:\Users\<you>\corporate-ca-bundle.pem` and the **user env var**
  `NODE_EXTRA_CA_CERTS` was set to it (persistent). New terminals pick it up automatically;
  if a terminal was already open, restart it.
- To regenerate the bundle later, re-run the export (dump `Cert:\LocalMachine\Root`,
  `Cert:\LocalMachine\CA`, and the CurrentUser equivalents to PEM).
- **This is needed only for local dev behind the proxy. Vercel does NOT need it** — there is no
  inspection proxy in production, so do not set `NODE_EXTRA_CA_CERTS` in Vercel.

---

## Part E — GitHub repo (dashboard, no CLI needed)

> Do this when we reach the deploy step (after the app is built and verified locally).

1. Go to <https://github.com/new>.
2. Repository name: `date-spot-planner`. Visibility: **Private**. **Do not** add a README/.gitignore
   (the project already has them). Click **Create repository**.
3. Back in the project folder, push the existing commits (I will have committed locally):

   ```bash
   git remote add origin https://github.com/<your-username>/date-spot-planner.git
   git branch -M main
   git push -u origin main
   ```

## Part F — Vercel deploy + env vars (dashboard, no CLI needed)

1. Go to <https://vercel.com/new> and sign in (with GitHub).
2. **Import** the `date-spot-planner` repo. Framework auto-detects as **Next.js**. Leave build
   settings default.
3. Before the first deploy, expand **Environment Variables** and add **every** variable from your
   `.env` (Production scope), with the **same values**:
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `SHARED_PASSPHRASE`,
   `FEED_TOKEN`, `APP_TIMEZONE`.
   - For `GOOGLE_PRIVATE_KEY`, paste the **same single-line `\n`-escaped** value you used locally.
     Vercel's UI can mangle multi-line pastes — keep it one line. If `/api/health` fails in
     production but works locally, this value is almost always why.
4. Click **Deploy**. When it finishes, open the production URL.
5. **Auto-deploy on push** is automatic once the repo is imported: every push to `main` redeploys.
6. Verify in production:
   - Home page loads (redirects to `/login`).
   - `https://<your-app>.vercel.app/api/health` → `{"ok":true,"headerOk":true,...}`.
   - `https://<your-app>.vercel.app/api/calendar.ics?token=<FEED_TOKEN>` → a `200` with
     `Content-Type: text/calendar`.

---

## ⚠️ Security notes

- **Anyone who has the iCal feed URL (which contains `FEED_TOKEN`) can read your calendar.**
  Treat the full feed URL as a secret. To revoke access, change `FEED_TOKEN` (locally and in
  Vercel) and re-subscribe with the new URL.
- Use a **high-entropy** `SHARED_PASSPHRASE` and `FEED_TOKEN`. There are no accounts and no
  lockout — a weak passphrase is the only thing between the internet and your write actions.
- Secrets live **only** in `.env` (gitignored) and Vercel env vars. Never commit `.env`.

---

## 📱 Subscribing on iPhone & Mac

Your feed URL is:
`https://<your-app>.vercel.app/api/calendar.ics?token=<FEED_TOKEN>`

**iPhone (iOS):**
1. **Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.**
2. Paste the feed URL into **Server**. Tap **Next**, then **Save**.
3. The "Date Spots" calendar appears in the Calendar app and refreshes automatically.

**Mac (Calendar app):**
1. **Calendar → File → New Calendar Subscription…**
2. Paste the feed URL, click **Subscribe**.
3. Set **Auto-refresh** (e.g. every hour) and click **OK**.

> Subscribed calendars are **read-only** on Apple devices and update on Apple's own polling
> schedule (often every few hours) — that's expected for `.ics` subscriptions.
