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
4. Also enable the **Gmail API** (used to email date invites "as" the signed-in user):
   open <https://console.cloud.google.com/apis/library/gmail.googleapis.com> and click **Enable**.

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
   fills A1:P1):

   ```
   id	place_name	lat	lng	maps_url	planned_date	status	visited_at	category	notes	created_at	updated_at	created_by	updated_by	invitees	deleted_at
   ```

   > If pasting splits it oddly, type the 16 headers into A1–P1 manually, in this order:
   > `id, place_name, lat, lng, maps_url, planned_date, status, visited_at, category, notes, created_at, updated_at, created_by, updated_by, invitees, deleted_at`
   >
   > **Upgrading an existing sheet?** Add **`invitees`** in cell **O1** and **`deleted_at`** in
   > cell **P1** — existing rows need nothing else (a blank `invitees` cell means "nobody invited";
   > a blank `deleted_at` means the spot is live). `deleted_at` is set to a timestamp when you delete
   > a spot in the app (a **soft delete** — the row stays but is hidden everywhere).

6. You do **not** need to create the **`plans`** or **`milestones`** tabs by hand — the app
   **auto-creates** them on first use of the **Plans & Timeline** section, with these headers:
   - `plans`: `id | title | description | status | created_at | updated_at | created_by | updated_by | invitees | deleted_at`
   - `milestones`: `id | plan_id | title | notes | due_date | status | done_at | order_index | checkpoints | created_at | updated_at | created_by | updated_by | deleted_at`

   A milestone's `checkpoints` cell holds a JSON array of `{ id, title, due_date, done, done_at }`.
   Both tabs use the same soft-delete (`deleted_at`) convention as `places`.

7. You do **not** need to create the **`users`** tab by hand — the app **auto-creates** it
   (columns `email | name | active | created_at | gmail_refresh_token`) on the first sign-in. The
   `gmail_refresh_token` cell holds that user's Gmail send token (so the app can email date invites
   "as" them — see Part C2 and the Security notes); it is the one credential the sheet stores. Anyone
   who completes Google
   sign-in is registered with `active=TRUE` and let in. To block someone, set their `active` cell to
   `FALSE` afterwards (they can't log in again; existing sessions last up to 90 days). The real gate
   on *who can reach sign-in at all* is the **Test users** list in the OAuth app (Part C2) while it
   stays in "Testing". The tab holds **no passwords** — just a registry of who signed in.

## Part C2 — Google sign-in (OAuth 2.0 client)

This lets people log in with their Google account instead of a shared passphrase.

1. Open <https://console.cloud.google.com/auth/overview> (same project as Part A). If prompted,
   configure the **OAuth consent screen**: User type **External**, fill app name + your email,
   and under **Audience** add your testers' emails (or keep it in "Testing" — that's fine for a
   private app). You do **not** need Google verification for a handful of users.
   - Under **Data access → Add or remove scopes**, add the **`.../auth/gmail.send`** scope
     (Gmail API, "Send email on your behalf"). This is what lets the app email invites as the user.
     It is a **sensitive/restricted scope**: while the app stays in **Testing**, your listed test
     users can grant it but will see an **"unverified app"** warning screen — click **Continue**.
     (Full Google verification is only needed if you ever Publish the app, which you should not.)
   - **Existing users must sign in again once** after this change to grant Gmail access — the app
     re-prompts for consent and stores their send token. Until they do, their spots still save but
     invites report "couldn't be sent — log out and sign in again."
2. Go to <https://console.cloud.google.com/apis/credentials> → **Create Credentials** →
   **OAuth client ID** → Application type **Web application**.
3. Under **Authorized redirect URIs**, add **both**:
   - `http://localhost:3000/api/auth/google/callback` (local dev)
   - `https://<your-app>.vercel.app/api/auth/google/callback` (production — add after you know the URL)
   The path must match **exactly** (no trailing slash).
4. Click **Create**. Copy the **Client ID** → `GOOGLE_OAUTH_CLIENT_ID` and the
   **Client secret** → `GOOGLE_OAUTH_CLIENT_SECRET`.

## Part D — Local environment variables

1. In the project folder, copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Fill in `.env`:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` = the `client_email`.
   - `GOOGLE_SHEET_ID` = the Sheet ID from Part C.
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` = from the OAuth client in Part C2.
   - `SESSION_SECRET` = a long random secret that signs the login cookie. Generate one with:
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `APP_BASE_URL` = `http://localhost:3000` for local dev (set the Vercel URL in production).
   - `APP_TIMEZONE` = leave as `Asia/Bangkok`.
   - (No feed token to set — each user's iCal URL carries their own base64-encoded email.)
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
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET`, `SESSION_SECRET`, `APP_BASE_URL`, `APP_TIMEZONE`.
   - Set `APP_BASE_URL` to your real production URL, e.g. `https://<your-app>.vercel.app`.
   - Add that same `https://<your-app>.vercel.app/api/auth/google/callback` URL to the OAuth client's
     **Authorized redirect URIs** (Part C2, step 3) — otherwise Google sign-in fails in production.
   - For `GOOGLE_PRIVATE_KEY`, paste the **same single-line `\n`-escaped** value you used locally.
     Vercel's UI can mangle multi-line pastes — keep it one line. If `/api/health` fails in
     production but works locally, this value is almost always why.
4. Click **Deploy**. When it finishes, open the production URL.
5. **Auto-deploy on push** is automatic once the repo is imported: every push to `main` redeploys.
6. Verify in production:
   - Home page loads (redirects to `/login`).
   - `https://<your-app>.vercel.app/api/health` → `{"ok":true,"headerOk":true,...}`.
   - `https://<your-app>.vercel.app/api/calendar.ics?token=<base64url(your-email)>` → a `200` with
     `Content-Type: text/calendar`. (Copy the exact URL from the in-app "Copy calendar URL" button.)

---

## ⚠️ Security notes

- **The iCal feed token is the user's base64-encoded email — encoding, not encryption.** It is
  reversible and emails are guessable, so the feed is *not* protected by a secret token. The only
  gate is that the decoded email must be an **active** user in the `users` tab; set their `active`
  cell to `FALSE` to revoke their feed (and login). Anyone who knows an active user's email can
  reconstruct that user's feed URL, so keep the user list small and trusted.
- Login is by **Google sign-in**. Everyone who signs in is **auto-registered** in the `users` tab
  with `active=TRUE` and let in, so the real access gate is the **Test users** list in the OAuth app
  — keep it in "Testing" mode and **do not click Publish** (publishing would let any Google account
  self-register). To block someone, set their `active` cell to `FALSE` in the `users` tab.
- Note: `active=FALSE` blocks **new** logins. Someone already signed in keeps their session until it
  expires (up to 90 days) — rotate `SESSION_SECRET` to force everyone to re-authenticate at once.
- Use a **high-entropy** `SESSION_SECRET`. It signs the login cookie; if it leaks, someone could
  forge a session.
- The **`gmail_refresh_token`** in the `users` tab is a real credential: it lets the app send email
  **as that user** (send-only — it cannot read their mailbox). Keep the Sheet shared only with the
  service account and your trusted users. To revoke it, the user can remove the app at
  <https://myaccount.google.com/permissions>, or you can clear their `gmail_refresh_token` cell
  (after that, their invites stop sending until they sign in again).
- Secrets live **only** in `.env` (gitignored) and Vercel env vars. Never commit `.env`.

---

## 📱 Subscribing on iPhone & Mac

Your feed URL is personal — copy it from the app's **"Copy calendar URL"** button. It looks like:
`https://<your-app>.vercel.app/api/calendar.ics?token=<base64url(your-email)>`

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
