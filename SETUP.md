# Setting up BoomBooth on Vercel and Supabase

About 15 minutes. You need the Vercel project linked to this repo and a Supabase project (both done), plus a Gemini API key.

## 1. Create the database tables (Supabase)

1. In Supabase, open your project, then **SQL Editor** > **New query**.
2. Paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Check **Table Editor** now shows `sessions`, `events` and `wristbands`.

Then collect two values from **Project Settings** > **API Keys** (or the **Connect** dialog):

- **Project URL**, like `https://abcdefgh.supabase.co`
- **Secret key**, starting `sb_secret_`. Create one if there isn't one. Keep it private: it can read and delete all test data.

## 2. Get a Gemini API key

In [Google AI Studio](https://aistudio.google.com), choose **Get API key** and create a key.

## 3. Add the settings in Vercel

In Vercel, open the project, then **Settings** > **Environment Variables**. Add these for **Production** (and Preview if you use it):

| Name | Value | Required |
| --- | --- | --- |
| `GEMINI_API_KEY` | Your Gemini key | Yes, for AI features |
| `SUPABASE_URL` | Your Supabase Project URL | Yes, for logging |
| `SUPABASE_SECRET_KEY` | Your `sb_secret_...` key | Yes, for logging |
| `PANEL_PASSCODE` | A passcode you choose for `/panel` | Yes, for the panel |
| `GEMINI_MODEL` | `gemini-3.8-flash` (default) | No |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` (default), or `gemini-3.8-flash-lite-tts` for cheaper voices | No |
| `AI_ENABLED` | `false` switches every Gemini feature off instantly | No |
| `TTS_ENABLED` | `false` switches only the Gemini voices off | No |

If you still use a legacy Supabase `service_role` key, set `SUPABASE_SERVICE_ROLE_KEY` instead of `SUPABASE_SECRET_KEY`.

Project settings to check, under **Settings** > **Build and Deployment**: Framework Preset **Other**, Root Directory empty (the repo root). `vercel.json` already tells Vercel to serve the `public` folder.

**Redeploy after adding or changing variables:** **Deployments** > the latest one > **⋯** > **Redeploy**. Settings only apply to new deployments.

## 4. Check it works

1. Open `https://YOUR-APP.vercel.app/api/config`. You should see `{"ai": true, "tts": true, "storage": true}`. A `false` means that variable is missing or wrong.
2. Open the booth, pick up, agree, tap the wristband, and press a few keys. Hang up.
3. Open `https://YOUR-APP.vercel.app/panel`, enter the passcode, and check the session appears.
4. In Supabase, check **Table Editor** > `events` has rows.

## On the day (about 100 laptops in one room)

- **Use Chrome.** Speaking needs Chrome's speech recognition; allow the microphone when asked. Typing and the keypad work in any browser.
- **Sound:** 100 laptops talking at once will be loud. Use headphones, or set **Settings** > **Voice** to **Captions only**. Captions are always on.
- **Gemini voices** add a second or two before each new line and cost the most. The **Browser voice** is free and instant. Each tester can switch in **Settings**.
- **Wristbands:** each laptop gets its own made-up ID (for example `WB-4MWN`), shown on screen. Ask testers to write it on their feedback form, so you can match feedback to their session in the panel without names.
- **If Gemini fails or runs out of credit,** the booth falls back to keyword matching and the template summary on its own. To force this, set `AI_ENABLED=false` and redeploy.
- Keep the **panel** open on one screen with **Auto-refresh** on to watch pain points live.

## After Presentation Day

In the panel: **Export events (CSV)** and **Export sessions (CSV)**, then type `DELETE` and **Clear test data**.

## Running it on your own computer (optional)

```bash
npm i -g vercel
vercel link          # pick this project
vercel env pull .env.local
vercel dev           # opens http://localhost:3000
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `/api/config` shows `"storage": false` | `SUPABASE_URL` or `SUPABASE_SECRET_KEY` missing, or not redeployed |
| Panel says "Logging isn't connected" | Same as above |
| Panel says "No PANEL_PASSCODE is set" | Add `PANEL_PASSCODE` and redeploy |
| Events don't appear in Supabase | The SQL in step 1 wasn't run, or the key is the publishable one instead of the secret one |
| "Gemini" options are greyed out in Settings | `GEMINI_API_KEY` missing, or `AI_ENABLED=false` |
| Booth says the content file couldn't be loaded | `public/content/content.json` isn't valid JSON: check commas and quote marks |
| Speak button greyed out | Not Chrome, or the current prompt has no options to choose from |
