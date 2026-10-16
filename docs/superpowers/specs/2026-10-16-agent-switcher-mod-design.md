# agent-switcher-mod — design

Date: 2026-10-16
Status: draft, awaiting approval

## What it is and why

A Claude Code mod that reads each prompt before the turn runs, decides which
model and how much effort the task deserves, and runs the turn that way. The
point is to stop hand-picking a model and effort for every task while making
sure an automatic choice never lands on a model that spends credits, and
never goes above High effort without the user saying yes.

## Goals

- Every prompt the user submits is classified as a whole before its turn
  runs, and the turn runs on the chosen model and effort.
- The mod only ever chooses **Haiku, Sonnet or Opus**.
- Effort up to and including `high` is applied without asking. `xhigh` or
  `max` needs the user's explicit approval.
- The user can always see what the mod chose, and can pause it per session.

## Non-goals

- Subagents. Helper agents (Explore, reviews, and so on) keep whatever model
  and effort they would have had. The mod only touches the main loop.
- Remembering pause state across sessions.
- Learning from past choices, tracking spend, or changing the model picker UI.

## Anti-goals (failure even if it "works")

- The mod ever choosing Fable or any other model that uses credits, through
  any path, including bad classifier output.
- Running above `high` without a clear yes from the user.
- Switching silently: the user can't tell what model or effort a turn ran on.
- Dialogs that loop by themselves, or a turn stuck waiting with no way out.

## Behaviour (decided by the user)

### Classifying a prompt

- On each prompt submit, the mod sends the **whole prompt** to **Haiku at
  `low` effort** and gets back a model and an effort.
- The classifier's answer is checked against the allowlist. A model not on
  it counts as a failure (see below), never as something to run.
- The chosen model and effort apply to every model request of that turn's
  main loop. Requests from subagents are left alone.

### Allowlist

- Models: `haiku`, `sonnet`, `opus`. Fixed in the mod. A new model is never
  used until someone adds it to the list on purpose.
- Fable and anything else that uses credits are never on the list.

### Effort above High

- `low`, `medium` or `high`: applied with no prompt.
- `xhigh` or `max`: a confirmation dialog asks the user.
  - Approve: use the recommended effort.
  - Reject: use `high`.
  - Dismissed, or no one to ask (`claude -p`): use `high`.

### When Haiku fails

Failure means an error, a timeout, or an answer that can't be used
(unparseable, or a model not on the allowlist). The turn waits and a dialog
says "Couldn't pick a model for this prompt", with two choices:

- **Retry**: ask Haiku again. If it fails again, the same dialog appears
  again. Nothing retries without the user clicking.
- **I'll choose**: the user picks the model (Haiku / Sonnet / Opus), then the
  effort. Because the user picked it, `xhigh` or `max` here needs no second
  confirmation. Fable is never offered.
- Dismissed, or no one to ask: run the turn without switching (but see the
  credit guard below).

### Pause and resume

- `/agent-switcher off` pauses the mod **in this session only**. Turns run on
  the user's own model and effort. There's no Haiku call and no dialogs.
- `/agent-switcher on` resumes it from the next prompt.
- `/agent-switcher` with no argument reports whether it's on or off.
- Other sessions, open now or started later, are unaffected. A new session
  always starts with the mod on. A session that is reloaded or resumed
  keeps its own pause state.
- Paused means hands-off: if the user picks Fable themselves while paused,
  the mod doesn't step in.
- Pausing during a running turn takes effect from the next prompt.

### Status line

- On: `auto: <model> · <effort>` for the current turn, e.g.
  `auto: sonnet · medium`.
- Paused: `auto: paused`.

## Calls made by Claude (not discussed with the user — check these)

1. **Credit guard on fallbacks.** While the mod is on, "run without
   switching" could still mean running on Fable if the user's session model
   is Fable. In that case the mod falls back to `sonnet` at the session's
   effort, capped at `high`. This keeps the anti-goal: while on, the mod
   never lets a turn run on a model outside the allowlist.
2. **Effort dialog fits in 4 options.** The engine's question dialog takes
   2–4 options, so the "I'll choose" effort question shows
   `Low / Medium / High / Above High`, and "Above High" opens a second
   question with `xhigh / max`.
3. **Which prompts get classified.** Prompts the user types (at the terminal
   or via Remote Control) and `claude -p`/SDK prompts are classified. Slash
   commands are not (the engine marks them). Background-task notifications
   and scheduled/loop prompts that arrive mid-turn keep the current turn's
   choice. A scheduled prompt that starts a new turn is classified, with
   dialogs replaced by their fallbacks since no one may be watching.
4. **Pause state lives in the session's `$.state`**, not `$.store`, which is
   what makes it per-session.

## Constraints and known facts from the mod API (build 2.1.299)

- There's no call to change the session's own model or effort. The mod
  rewrites `model`/`effort` on each `turn.step` (`next({ ...e, model, effort })`),
  only where `e.agentId === undefined` (main loop). The model picker keeps
  showing the user's choice, which is why the status line matters.
- Reading the prompt: `prompt.submit` gives the full text (`e.text`) and
  marks slash commands (`e.command`) and the origin (`e.origin.kind`).
- Classifier call: `$.model.complete({ model: "haiku", prompt, effort: "low" })`.
- Dialogs: `$.ui.ask(question, options)` uses the engine's own question
  dialog. It rejects when dismissed or under `-p`, and that rejection is the
  "dismissed / no one to ask" path everywhere above.
- Commands: `$.command.register` in `session.start`, answered by a
  `command.run` hook.
- Status line: `$.ui.status(text)`.
- A model that takes no effort setting is sent none. The engine drops it.

## Left to the builder

- The classifier's prompt wording and output format, as long as the output
  is strictly validated against the allowlist and the five effort levels.
- The classifier timeout. Pick something short enough that a hung call
  reaches the failure dialog quickly.
- How the decision is carried from `prompt.submit` to that turn's
  `turn.step`s, and cleared at `turn.complete`.
- Whether to pass aliases (`sonnet`) or full model ids on `turn.step`.
  Verify which one the engine accepts there.
- Confirm the classifier's own `$.model.complete` call doesn't pass through
  the mod's `turn.step` hook. If it does, it must be left alone.
- Where the mod's source lives (this project folder, loaded with
  `--plugin-dir`, versus the session's dev-mods folder) and how it is
  installed day to day.
- Tests: at minimum, the allowlist rejects anything else (Fable included),
  `xhigh`/`max` without approval resolves to `high`, the credit guard, and
  pause skipping classification.
