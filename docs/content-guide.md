# Filling in the content

Everything the booth says, shows or prints is in [`public/content/content.json`](../public/content/content.json). You never need to touch the code to change the story.

## Rules

- Replace placeholder text only. Keep every `id`, `key` and field name.
- Keep each spoken line short: one or two sentences. Long lines are hard to follow on a phone.
- At most 3 options per prompt (the main menu is the one exception).
- Plain, literal language. Say what will happen and how long it takes.
- The file must stay valid JSON: watch commas and quote marks. Paste it into a JSON checker if the booth stops loading.

## What to fill in

| Section | What it is | Count |
| --- | --- | --- |
| `voices` | Character names and a short voice description | 6 |
| `consent` | The consent screen shown before the scan | 1 |
| `operator` | The Operator's lines | about 14 |
| `safety.message` | Fixed welfare message; agree with Boomtown | 1 |
| `classes` | Class names and one-line descriptions | 4 |
| `quiz.questions` | 5 questions, 3 answers each, with points per class | 5 |
| `needs` | Quiet/busy, solo/group, short/long questions | 3 |
| `branches` | 3 quest branches per class, 3 steps each | 12 branches, 36 steps |
| `helper` | Fixed answers for lost, quiet place, how quests work, facilities | 4 |
| `quest_flow` | Step prompt, resume and next-step lines | 4 |
| `echoes` | Listen-only stories and when they unlock | 4 |
| `summary` | Printed slip header, footer and fallback template | 1 |

## How a quest is chosen

1. The visitor's class comes from the quiz (highest points; ties go to `quiz.tie_break_order`).
2. Each of the class's 3 branches has tags: quiet/busy, solo/group, short/long.
3. Each tag that matches the visitor's answer adds its weight from `routing.weights` (solo/group 4, quiet/busy 2, short/long 1). The highest score wins.

With the current tags (branch 1: quiet, solo, short · branch 2: busy, solo, long · branch 3: quiet, with others, short), every class routes the same way:

| Quiet/busy | Solo/group | Short/long | Branch |
| --- | --- | --- | --- |
| quiet | solo | short | X.1 |
| quiet | solo | long | X.1 |
| quiet | group | short | X.3 |
| quiet | group | long | X.3 |
| busy | solo | short | X.2 |
| busy | solo | long | X.2 |
| busy | group | short | X.3 |
| busy | group | long | X.3 |

With three branches per class, short/long only matters if you retag branches. It's still logged, so the panel shows what people asked for.

To change who gets which quest, change a branch's `tags`, not the code.

## Placeholders in lines

Some lines contain `{like_this}`. The booth fills these in, so keep them as they are: `{class_name}`, `{class_description}`, `{branch_name}`, `{step_number}`, `{step_total}`, `{step_say}`, `{option}`, `{steps_done}`, `{echoes_heard}`, `{next_step}`.
