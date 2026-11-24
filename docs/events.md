# Event log

Every session starts with a wristband scan (or "continue without scanning") and every action after it is logged as one event. The pain-point view and the printed journey summary are both built from these events.

No audio is ever stored. Typed or spoken free text is stored only for decision steps, so unclear wording can be reviewed.

## Session

| Field | Example | Notes |
| --- | --- | --- |
| `session_id` | `s_8f3a1c` | New for every call |
| `wristband_id` | `WB-0042` or `null` | `null` when the visitor continued without scanning |
| `started_at` / `ended_at` | ISO timestamps | |
| `end_reason` | `goodbye`, `hung_up`, `timeout` | `hung_up` mid-flow is a pain-point signal |

## Events

Each event has `session_id`, `wristband_id`, `at` (timestamp), `screen` (where the visitor was) and `type`, plus the fields below.

| Type | Extra fields | Why it matters |
| --- | --- | --- |
| `scan` | `mode`: `wristband` or `anonymous`, `returning`: true/false | Who uses the booth, and how often people come back |
| `menu_choice` | `option` | What people come to the booth for |
| `quiz_answer` | `question_id`, `answer_key` | Quiz balance between classes |
| `class_assigned` | `class_id`, `scores` | |
| `need_answer` | `need_id`, `value`, `input`: `key`/`speech`/`text` | |
| `branch_assigned` | `branch_id`, `scores`, `reason`: `routing`/`swap_quieter` | Shows exactly why someone got a quest |
| `step_done` | `branch_id`, `step_id`, `seconds_on_step` | Where people are slow |
| `repeat` | `prompt_id` | Lines people need to hear again: possibly unclear |
| `back_to_operator` | `from_screen` | Where people back out |
| `helper_topic` | `topic_id` | What people get stuck on |
| `swap_quieter` | `from_branch`, `to_branch` | Quests that are too much |
| `echo_played` | `echo_id`, `completed`: true/false | |
| `echo_locked` | `echo_id` | People wanting content they can't reach |
| `decision` | `prompt_id`, `allowed`, `heard`, `picked`, `confidence`, `engine`: `gemini`/`keywords`, `confirmed`: true/false | Unclear wording, and labelled data for training a small classifier later |
| `not_understood` | `prompt_id`, `heard` | |
| `safety_triggered` | `via`: `menu`/`trigger_word` | Never filtered out of reports |
| `summary_printed` | `engine`: `gemini`/`template` | |
| `silence` | `prompt_id`, `seconds` | Prompts people freeze on |

## Pain-point signals

The demo panel flags:

- Prompts with a high `repeat` or `silence` rate.
- Steps where people hang up or swap quests.
- The most common `helper_topic` values.
- Decision prompts with low confidence or many corrections.
- Sessions that end before a quest is assigned.
