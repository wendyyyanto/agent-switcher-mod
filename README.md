# agent-switcher-mod

A Claude Code mod that picks the model and effort for each prompt, so you don't have to. Before a turn runs, Haiku reads your prompt and recommends a model (Haiku, Sonnet or Opus) and an effort level. The turn then runs that way.

It never picks Fable or any other model that spends credits, and it never goes above **High** effort unless you say yes.

## Install

Needs Claude Code **2.1.299 or later**. Older builds refuse to load the hooks module. Check with `claude --version` and run `claude update` if needed.

At the prompt of a terminal session:

```
/plugin install agent-switcher-mod --marketplace wendyyyanto/agent-switcher-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it active in every new session).

From a shell:

```bash
claude plugin install agent-switcher-mod --marketplace wendyyyanto/agent-switcher-mod
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `wendyyyanto/agent-switcher-mod`, then **Add plugin**.

### Running from a local checkout

```bash
claude --plugin-dir /path/to/agent-switcher-mod
```

In the desktop app, where you can't pass flags, put the folder's absolute path in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json`.

## Usage

The mod is on by default in every session. The status line shows what it is doing:

| Status | Meaning |
| --- | --- |
| `auto: on` | Active, waiting for a prompt |
| `auto: opus · medium` | This turn runs on the model and effort the mod chose |
| `auto: not switched` | No choice was made; the turn runs on your own model and effort |
| `auto: sonnet · high` (on a Fable session) | The credit guard moved an unswitched turn onto Sonnet |
| `auto: paused` | The mod is off for this session |

### `/agent-switcher`

| Command | Effect |
| --- | --- |
| `/agent-switcher off` | Pause the mod in this session. No Haiku calls, no dialogs, no switching. Your own model and effort are used as-is, Fable included. |
| `/agent-switcher on` | Resume from the next prompt. |
| `/agent-switcher` | Report whether it is on or paused. |

Pausing only affects the current session. A new session always starts with the mod on. A reloaded or resumed session keeps its own setting.

## Workflow

```
prompt submitted
  │
  ├─ slash command, mid-turn prompt, subagent, or paused? ──► run unchanged
  │
  ▼
Haiku (low effort, 5s timeout) classifies the whole prompt
  │
  ├─ valid answer (haiku/sonnet/opus + an effort level)
  │     ├─ low / medium / high ──► use it
  │     └─ xhigh / max ──► ask "Use <effort>?"
  │            ├─ yes ──► use it
  │            └─ no / dismissed / nobody to ask ──► use high
  │
  └─ failed (error, timeout, unusable or off-allowlist answer)
        ├─ interactive: "Couldn't pick a model" dialog
        │     ├─ Retry ──► classify again (only when you click)
        │     ├─ I'll choose ──► pick model, then effort (Above High needs no second confirm)
        │     └─ dismissed ──► not switched
        └─ non-interactive (SDK, scheduled) ──► not switched
  │
  ▼
every main-loop model request of that turn runs on the choice;
the choice is cleared when the turn completes
```

**Credit guard.** While the mod is on, a turn that was not switched still never runs off the allowlist. If your session model is Fable (or anything else not on the list), the turn falls back to Sonnet at your effort, capped at High.

**Which prompts are classified.** Prompts typed in the terminal or through Remote Control get the interactive flow, with dialogs. Prompts from `claude -p`/the SDK and scheduled prompts that start a new turn are classified too, but dialogs are replaced by their fallbacks.

**Gateway sessions.** If your session model carries a provider prefix (`cc/claude-opus-5-5`), the classifier call and the switched model keep that prefix.

## Limitations

- **The model picker doesn't change.** There is no API to change the session's own model. The mod rewrites each request instead, so the picker keeps showing your choice. The status line is the only place to see what actually ran.
- **Main loop only.** Subagents (Explore, reviews and so on) keep their own model and effort.
- **Extra latency and cost.** Every classified prompt makes one Haiku call before the turn starts. A slow or hung call can delay the turn by up to 5 seconds before the failure path kicks in.
- **Fixed allowlist.** Only Haiku, Sonnet and Opus, pinned to `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5`. A new model is never used until someone adds it to `hooks/policy.ts`.
- **Session model variants count as off-allowlist.** A session model with a suffix such as `[1m]` is treated as not allowed, so an unswitched turn falls back to Sonnet.
- **Heuristic routing.** The classifier's judgement is a guess from the prompt text. It can pick a smaller model than a task really needs. Pause the mod for work where you want full control.
- **Pause isn't remembered** across new sessions.
- **No spend tracking or learning** from past choices.

## Development

```
hooks/policy.ts     pure rules: allowlist, effort cap, classifier prompt, parsing
hooks/flow.ts       per-prompt decision flow and dialogs
hooks/register.ts   hooks into the engine: prompt.submit, turn.step, the command
types/index.d.ts    $.state contract for the pause flag
tests/              claude-code/testing suites
```

```bash
claude plugin test .
```

```bash
claude plugin validate .
```
