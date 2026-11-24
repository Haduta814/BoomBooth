# BoomBooth

A web prototype of a phone booth for Boomtown Fair. Visitors scan their wristband, pick up the handset and reach the Operator, who gives them a class, a quest and help, at their own pace and without having to talk to strangers.

Built for the CDT in AI for Digital Media Inclusion hackathon, in response to Boomtown's provocation: open up access for neurodiverse and introverted audience members by breaking down current entry barriers.

**Set it up:** see [SETUP.md](SETUP.md). **Fill in the story:** see [docs/content-guide.md](docs/content-guide.md).

## What it does

- **Consent, then scan to start.** A short consent screen, then a digital wristband tap opens a logged session. Visitors can also continue without scanning (logged anonymously).
- **Class quiz.** Five questions assign one of four classes.
- **Quest progression.** The Operator asks quiet/busy, solo/group and short/long. Rule-based routing picks one of three scripted quest branches for the visitor's class. Progress is saved against the wristband, so visitors can come back and carry on.
- **Quest helper.** Fixed answers, a swap to a quieter quest, and a fixed safety message.
- **Echoes.** Listen-only stories that unlock as visitors progress.
- **Journey summary.** An on-screen thermal receipt of what the visitor has done.
- **Keypad first.** Every choice works by keypad (on screen or keyboard). Speaking or typing is optional.
- **Voice.** Captions always on; voice can be off, the browser's voice, or Gemini voices.
- **Panel** (`/panel`, passcode). Pain-point signals per prompt and per quest step, helper topics, routing, every spoken or typed decision, sessions, CSV export and a clear-data button.

## How AI is used

- **Quests are never generated.** All quest content is written by people in `public/content/content.json`.
- **Which quest someone gets is decided by transparent rules**, not AI (see the content guide).
- **Intent classification.** When a visitor speaks or types instead of pressing a key, Gemini maps their words to one of the options allowed at that point and returns a confidence level. Below 0.75 the booth asks them to confirm. A free keyword matcher, with negation handling, is the fallback. Every decision is logged, so logged replies plus confirmed choices can later train a small on-device classifier.
- **Journey summary.** Gemini writes a short summary from the visitor's logged facts only, with instructions fixed on the server. A fill-in template is the fallback.
- **Safety never depends on AI.** Distress words and the help menu play a fixed welfare message.

## Project layout

```
public/index.html, styles.css, app.js   The booth
public/panel.html, panel.js             The team panel
public/content/content.json             All words the booth says, shows or prints
api/*.py                                Vercel Python functions (standard library only)
  decide.py    intent classification (Gemini)
  summary.py   journey summary (Gemini)
  tts.py       Gemini voices
  log.py       saves sessions and events
  state.py     saves and loads wristband progress
  panel.py     panel data and clear-data (passcode)
  config.py    which services are on
supabase/schema.sql                     Database tables
docs/content-guide.md                   How to fill in the content
docs/events.md                          What gets logged
SETUP.md                                Vercel, Supabase and Gemini setup
```

## Hosting

- **Vercel** (free Hobby plan) serves `public/` and runs `api/`. Secrets are Vercel environment variables and never reach the browser.
- **Supabase** (free plan) stores sessions, events and wristband progress. Row Level Security is on with no policies, so only the server can read or write.
- Every push to `main` redeploys.
