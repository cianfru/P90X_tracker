# Google sign-in + Sheets backup — one-time setup

The app backs up to a spreadsheet in **your own Google Drive** and restores it on
any device. Daily use stays 100% offline; Google is only touched for backup and
first-device restore.

You do this **once, for the whole app**. After that, you and your wife each just
tap **Sign in with Google → Allow**. The steps below produce a public **Client
ID** (an app identifier, not a secret) that you paste into the app.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in.
2. Top bar → project dropdown → **New Project** → name it `P90X Logbook` → **Create**.

## 2. Enable the APIs

1. **APIs & Services → Library**.
2. Enable **Google Sheets API**.
3. Enable **Google Drive API**.

## 3. Configure the consent screen (keeps you out of Google's review)

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** → **Create**.
3. App name `P90X Logbook`, your email as support + developer contact → **Save and continue**.
4. **Scopes** → Save and continue (nothing to add here — the app requests them at runtime).
5. **Test users → Add users**: add **your** Gmail and **your wife's** Gmail.
   (Staying in "Testing" mode with test users means Google skips the formal app
   review. Signed-in test users see a one-time "Google hasn't verified this app"
   notice — tap **Continue**.)
6. Save.

## 4. Create the OAuth Client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins → Add URI**: your app's URL, e.g.
   `https://your-app.vercel.app` (and `http://localhost:5173` if you want to test locally).
   - No path, no trailing slash — just the origin.
4. **Create**. Copy the **Client ID** (looks like `1234-abcd.apps.googleusercontent.com`).

## 5. Paste it into the app

1. Open the app → tap the **account** button (top-right).
2. Paste the Client ID → **Save Client ID**.
3. **Sign in with Google → Allow.** On your phone, choose **Upload my data** to
   push your existing history to your new Sheet. On your wife's phone, she signs
   in with her account and chooses **Start clean**.

Done. From now on it's just Sign in → Allow on any device, and your data rides
along in your own spreadsheet.

## Notes

- The Client ID is **not secret** — it identifies the app, nothing more.
- Scope used: `drive.file` — the app can only see the single spreadsheet it
  creates, nothing else in your Drive.
- Tokens are short-lived and refreshed silently while the app is open; there's
  no background server, so sync happens when you open the app online.
- You can also inject the Client ID at build time via the `VITE_GOOGLE_CLIENT_ID`
  environment variable instead of pasting it in the UI.
