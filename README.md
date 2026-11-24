# BoomBooth

A web prototype of a phone booth for Boomtown Fair. Visitors scan their wristband, pick up the handset and reach the Operator, who gives them a class, a quest and help, at their own pace and without having to talk to strangers.

Built for the CDT in AI for Digital Media Inclusion hackathon, in response to Boomtown's provocation: open up access for neurodiverse and introverted audience members by breaking down current entry barriers.

## What it does

- **Scan to start.** A simulated wristband tap opens a session. Visitors can also continue without scanning.
- **Class quiz.** Five questions assign one of four classes.
- **Quest progression.** The Operator asks quiet/busy, solo/group and short/long, then a rule-based routing picks one of three scripted quest branches for the visitor's class.
- **Quest helper.** Fixed answers, a swap to a quieter quest, and a fixed safety message.
- **Echoes.** Listen-only stories that unlock as you progress.
- **Journey summary.** A thermal-receipt printout of what the visitor has done.
- **Pain-point view.** A passcode-protected panel that reads the event log and flags friction.

## How AI is used

- **Quests are never generated.** All quest content is written by people in `content/content.json`.
- **Intent classification.** When a visitor speaks or types instead of pressing a key, Gemini maps their words to one of the options allowed at that point and returns a confidence level. Low confidence means the booth asks them to confirm. A free keyword matcher is the fallback.
- **Journey summary.** Gemini writes a short summary from the visitor's logged events only. A fill-in template is the fallback.

The decision about which quest a visitor gets is made by a transparent rule-based routing (see `docs/content-guide.md`), not by AI.

## Project layout

```
content/content.json    All words the booth says, shows or prints
docs/content-guide.md   How to fill in the content
docs/events.md          What gets logged, and the pain-point signals
```

The app itself (booth page, server functions, database setup) is being added next.

## Hosting plan

- **Vercel** (free Hobby plan) serves the booth page and runs the Python functions that call Gemini. The Gemini key is set as a Vercel environment variable and never appears in the code.
- **Supabase** (free plan) stores sessions and events.
- Every push to `main` redeploys.
