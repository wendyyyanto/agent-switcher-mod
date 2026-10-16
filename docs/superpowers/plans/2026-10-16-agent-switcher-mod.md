# agent-switcher-mod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that classifies each prompt with Haiku and runs the turn on an allowlisted model and effort, asking before going above High.

**Architecture:** Three files of logic. `policy.ts` holds pure rules (allowlist, parsing, caps, status text). `flow.ts` holds the dialog flow, with the classifier and the dialog passed in as functions so it can be tested without the engine. `register.ts` wires both to engine events: `prompt.submit` decides, `turn.step` applies the decision to main-loop requests, and `turn.complete` clears it.

**Tech Stack:** TypeScript hooks module for the Claude Code mod API (build 2.1.299), `claude-code/testing` kit run by `claude plugin test`, `claude plugin validate`.

**Spec:** `docs/superpowers/specs/2026-10-16-agent-switcher-mod-design.md`

## Global Constraints

- Allowed models are exactly `haiku`, `sonnet`, `opus`. Nothing else is ever chosen, including Fable and any full id or variant the classifier invents.
- Effort levels: `low`, `medium`, `high`, `xhigh`, `max`. The mod applies `xhigh`/`max` only after an explicit approval, or when the user picked it themselves under "I'll choose".
- Classifier: `$.model.complete({ model: 'haiku', effort: 'low', ... })` with the whole prompt.
- Subagents are never touched: `turn.step` with `e.agentId !== undefined` passes through unchanged.
- Pause state is per session, stored in `$.state` (`agent-switcher-mod`.`paused`), never in `$.store`.
- Status line text: `auto: <model> · <effort>`, `auto: paused`, `auto: not switched`, `auto: on`.
- Command name: `agent-switcher`, args `on` / `off` / empty.
- The mod lives at the project root `D:\Projects\agen-switcher-mod` and is loaded with `claude --plugin-dir D:\Projects\agen-switcher-mod`. Tests sit in `tests/`.

## Review Focus

1. Classifier wraps its JSON in prose or a code fence, or capitalises values: it must still parse (`policy.test.ts`: `parseChoice handles fences and case`).
2. Classifier names `fable`, a full id (`claude-opus-5-5`) or a variant (`opus[1m]`): treated as a failure, never run (`policy.test.ts`: `parseChoice rejects anything off the allowlist`).
3. User types free text under "Other" in any dialog: handled as that dialog's dismissal (`flow.test.ts`: `free text counts as dismissal`).
4. A prompt queued while a turn is running must not reclassify or switch mid-turn (`register.test.ts`: `prompt during a running turn is not classified`).
5. Session model is a full id (`claude-fable-5-1`, `claude-sonnet-5-5`): the credit guard must catch Fable and leave allowed families alone (`policy.test.ts`: `guardFallback`).

---

### Task 1: Mod skeleton and pure policy

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `types/index.d.ts`, `hooks/policy.ts`
- Test: `tests/policy.test.ts`

**Interfaces:**
- Produces (from `hooks/policy.ts`):
  - `type Model = 'haiku' | 'sonnet' | 'opus'`
  - `type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
  - `type Choice = { model: Model; effort: Effort }`
  - `const MODELS: readonly Model[]`, `const EFFORTS: readonly Effort[]`
  - `parseChoice(text: string): Choice | null`
  - `isAboveHigh(effort: Effort): boolean`
  - `capAtHigh(effort: Effort | number | undefined): Effort | undefined`
  - `isAllowedSessionModel(id: string): boolean`
  - `guardFallback(sessionModel: string, sessionEffort: Effort | number | undefined): { model: Model; effort: Effort | undefined } | null`
  - `classifierPrompt(prompt: string): string`
  - `statusFor(choice: Choice): string`
- Produces (contract `types/index.d.ts`): `PluginState['agent-switcher-mod'] = { paused: boolean }`

- [ ] **Step 1: Initialise the repo and write the manifest files**

```bash
git init
```

`.claude-plugin/plugin.json`:
```json
{ "name": "agent-switcher-mod", "version": "0.1.0", "description": "Picks the model and effort for each prompt, never above High without asking", "types": "./types/index.d.ts" }
```
`hooks/hooks.json`: `{ "modules": ["./register.ts"] }`
`types/index.d.ts`: `declare module 'claude-code' { interface PluginState { 'agent-switcher-mod': { paused: boolean } } }` plus `export {}`.

- [ ] **Step 2: Write the failing tests** in `tests/policy.test.ts` (import `test`, `expect` from `claude-code/testing`, functions from `../hooks/policy`)

```ts
test('parseChoice reads plain JSON', () => {
  expect(parseChoice('{"model":"sonnet","effort":"medium"}')).toEqual({ model: 'sonnet', effort: 'medium' })
})
test('parseChoice handles fences and case', () => {
  expect(parseChoice('Sure:\n```json\n{"model":"Opus","effort":"HIGH"}\n```')).toEqual({ model: 'opus', effort: 'high' })
})
test('parseChoice rejects anything off the allowlist', () => {
  for (const m of ['fable', 'claude-opus-5-5', 'opus[1m]', 'claude-fable-5-1', ''])
    expect(parseChoice(`{"model":"${m}","effort":"low"}`)).toBe(null)
  expect(parseChoice('{"model":"haiku","effort":"extreme"}')).toBe(null)
  expect(parseChoice('no json here')).toBe(null)
})
test('isAboveHigh', () => {
  expect(['low', 'medium', 'high'].map(e => isAboveHigh(e as Effort))).toEqual([false, false, false])
  expect(isAboveHigh('xhigh')).toBe(true); expect(isAboveHigh('max')).toBe(true)
})
test('capAtHigh', () => {
  expect(capAtHigh('max')).toBe('high'); expect(capAtHigh('xhigh')).toBe('high')
  expect(capAtHigh('medium')).toBe('medium'); expect(capAtHigh(32000)).toBe('high'); expect(capAtHigh(undefined)).toBe(undefined)
})
test('guardFallback', () => {
  expect(guardFallback('claude-fable-5-1', 'max')).toEqual({ model: 'sonnet', effort: 'high' })
  expect(guardFallback('fable', undefined)).toEqual({ model: 'sonnet', effort: undefined })
  expect(guardFallback('claude-sonnet-5-5', 'max')).toBe(null)
  expect(guardFallback('opus', 'low')).toBe(null)
  expect(guardFallback('haiku', 'low')).toBe(null)
})
test('statusFor', () => {
  expect(statusFor({ model: 'sonnet', effort: 'medium' })).toBe('auto: sonnet · medium')
})
```

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test D:\Projects\agen-switcher-mod`
Expected: FAIL, policy exports missing.

- [ ] **Step 4: Implement `hooks/policy.ts`**

- `parseChoice`: take the first `{...}` span in the text, `JSON.parse` it inside try/catch, lowercase and trim both fields, return them only if each is exactly a member of `MODELS` / `EFFORTS`. Otherwise `null`.
- `isAllowedSessionModel`: true when the id matches `/^(?:claude-)?(haiku|sonnet|opus)(?:-|$)/i`. A `[1m]` suffix is not matched, so it counts as not allowed.
- `guardFallback`: `null` when `isAllowedSessionModel(sessionModel)`, else `{ model: 'sonnet', effort: capAtHigh(sessionEffort) }`.
- `classifierPrompt`: tells Haiku to reply with only `{"model": "...", "effort": "..."}`, lists the three models and five efforts with one line each on when to use them (haiku for lookups and trivial edits, sonnet for ordinary coding, opus for hard design and debugging; effort scales with how much reasoning the task needs), then the user's prompt verbatim between `<prompt>` tags. The wording beyond that is yours.

- [ ] **Step 5: Run tests, then validate and type-check**

Run: `claude plugin test D:\Projects\agen-switcher-mod` → PASS.
Run: `claude plugin validate D:\Projects\agen-switcher-mod` → no refusals. (It will complain that `register.ts` is missing until Task 3. Create it as `export const register: Register = () => {}` now so validation passes.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: mod skeleton and model/effort policy"
```

---

### Task 2: Decision flow with dialogs

**Files:**
- Create: `hooks/flow.ts`
- Test: `tests/flow.test.ts`

**Interfaces:**
- Consumes: `Choice`, `Effort`, `Model`, `isAboveHigh` from `hooks/policy.ts`.
- Produces:
  - `type Ask = (question: string, options: readonly string[], header: string) => Promise<string>`: resolves to the chosen label or typed text, rejects on dismissal.
  - `type Classify = () => Promise<Choice | null>`
  - `decide(deps: { classify: Classify; ask: Ask; interactive: boolean }): Promise<Choice | 'keep'>`

Exact dialog copy (questions, options, header):
- Confirm: `` `This prompt looks like it needs ${effort} effort. Use it?` `` options `` [`Use ${effort}`, 'Use high'] `` header `Effort`
- Failure: `Couldn't pick a model for this prompt. Retry or choose yourself?` options `['Retry', "I'll choose"]` header `Auto model`
- Model: `Which model for this prompt?` options `['Haiku', 'Sonnet', 'Opus']` header `Model`
- Effort: `Which effort?` options `['Low', 'Medium', 'High', 'Above High']` header `Effort`
- Above High: `Which level above High?` options `['xhigh', 'max']` header `Effort`

Behaviour:
- Classifier returns a choice at or below High: return it, no dialog.
- Above High: when `interactive` is false, return it capped to `high`. Otherwise confirm: `Use <effort>` returns it as is, and anything else (`Use high`, free text, rejection) returns it with `high`.
- Classifier returns `null`: when `interactive` is false, return `'keep'`. Otherwise show the failure dialog. `Retry` calls `classify` again and repeats this whole flow. `I'll choose` runs Model → Effort (→ Above High), mapping labels to lowercase values, and returns the result with no confirmation. A rejection or unknown text at any of those dialogs returns `'keep'`.

- [ ] **Step 1: Write the failing tests** with a scripted `ask` that records questions and pops answers (a string answers, an `Error` rejects), and a `classify` that pops from a list

```ts
test('choice at or below high needs no dialog', ...)          // classify → sonnet/high; asks.length 0; result sonnet/high
test('above high approved keeps it', ...)                     // opus/max; answer 'Use max' → opus/max
test('above high rejected or dismissed drops to high', ...)    // answers 'Use high' and Error → opus/high both
test('above high without anyone to ask drops to high', ...)    // interactive false → opus/high, asks.length 0
test('failure then retry uses the second answer', ...)         // classify null then haiku/low; answer 'Retry' → haiku/low; classify called twice
test('failure twice asks twice, never loops alone', ...)       // null, null; answers 'Retry', Error → 'keep'; asks.length 2
test("I'll choose with Above High needs no confirmation", ...)  // answers "I'll choose", 'Opus', 'Above High', 'max' → opus/max; asks.length 4
test("I'll choose basic", ...)                                  // "I'll choose", 'Sonnet', 'Low' → sonnet/low
test('free text counts as dismissal', ...)                     // failure answer 'whatever' → 'keep'; model answer 'gpt' → 'keep'
test('failure without anyone to ask keeps', ...)               // interactive false, classify null → 'keep', asks.length 0
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test D:\Projects\agen-switcher-mod` → FAIL, `decide` missing.

- [ ] **Step 3: Implement `decide` in `hooks/flow.ts`** with the copy and behaviour above. Retry is a loop, not recursion on the dialog.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: decision flow with confirm, retry and manual choice"
```

---

### Task 3: Wire it to the engine

**Files:**
- Modify: `hooks/register.ts`
- Test: `tests/register.test.ts`

**Interfaces:**
- Consumes: everything from `policy.ts` and `flow.ts`.
- Produces: the hooks below. Nothing is exported except `register`.

Module state: `paused = atom({ plugin: 'agent-switcher-mod', key: 'paused' } as const, false)`; module variables `inTurn = false` and `current: Choice | 'keep' | null = null`.

Hooks:
- `session.start`: `$.command.register({ name: 'agent-switcher', description: 'Pause or resume automatic model and effort switching for this session (on | off)' })`. Set the status to `auto: paused` if paused, else `auto: on`. Then `next(e)`.
- `command.run` `{ command: 'agent-switcher' }`, by `e.args.trim()`:
  - `off`: set paused true, status `auto: paused`, `{ text: 'agent-switcher paused for this session.' }`
  - `on`: set paused false, status `auto: on`, `{ text: 'agent-switcher resumed for this session.' }`
  - empty: `{ text: 'agent-switcher is on in this session.' }` or `… is paused in this session.`
  - anything else: `{ text: 'Usage: /agent-switcher [on|off]' }`
- `turn.start`: when `e.agentId === undefined`, set `inTurn = true`. Then `next(e)`.
- `turn.complete`: when `e.agentId === undefined`, set `inTurn = false` and `current = null`. Then `next(e)`.
- `prompt.submit`: pass through untouched when `e.command`, `inTurn`, paused, or `e.origin.kind` is not one of `composer`, `bridge`, `sdk`, `scheduled-trigger`. Otherwise `current = await decide({ classify, ask, interactive })`, where:
  - `interactive` = origin is `composer` or `bridge`
  - `classify` = `$.model.complete({ model: 'haiku', effort: 'low', prompt: classifierPrompt(e.text), timeoutMs: 15000 })`, giving `parseChoice(r.text)` when `r.isAnswered`, else `null`
  - `ask` = `(q, options, header) => $.ui.ask(q, { options, header })`

  Then set the status: `statusFor(current)`, or `auto: not switched` for `'keep'`. Then `next(e)`.
- `turn.step` (an `async function*`): when `e.agentId !== undefined` or `current === null`, `return yield* next(e)`. For a `Choice`, `return yield* next({ ...e, model: current.model, effort: current.effort })`. For `'keep'`, compute `guardFallback(e.model, e.effort)`. When it's non-null, set the status to `` `auto: sonnet · ${g.effort ?? 'default'}` `` and pass `{ ...e, model: g.model, ...(g.effort ? { effort: g.effort } : {}) }`, else pass `e`.

- [ ] **Step 1: Write the failing tests** in `tests/register.test.ts`. Use the test's `on` to answer `model.complete` with a canned result (see the `OpEventOf` doc in the API types for how a hook answers a `$` call) and to record the `e.model`/`e.effort` that reach `turn.step` at the bottom. Drive `$.session.start`, `$.command.run`, `$.prompt.submit`, `$.turn.start`, `$.turn.step`, `$.turn.complete` in order. Use `origin: { kind: 'sdk' }` so no dialog is involved, because dialogs are covered in Task 2.

```ts
test('classified choice reaches main-loop steps', ...)      // haiku answers {"model":"opus","effort":"medium"}; step sees opus/medium
test('subagent steps are untouched', ...)                   // same, step with agentId 'a1' sees the original model/effort
test('slash commands are not classified', ...)              // prompt with command set → model.complete never called
test('paused skips classification and switching', ...)      // command.run off; prompt; step sees original; model.complete not called
test('on resumes', ...)                                      // off then on; prompt classified again
test('prompt during a running turn is not classified', ...) // turn.start then prompt.submit → model.complete not called
test('classifier failure under sdk keeps, guard catches fable', ...) // haiku answers isAnswered false; step with model 'claude-fable-5-1', effort 'max' sees sonnet/high
test('classifier failure keeps an allowed session model', ...)      // same with 'claude-sonnet-5-5' → unchanged
test('decision cleared after turn.complete', ...)           // after complete, next step without a prompt sees original
test('bare command reports state', ...)                     // command.run '' → text 'agent-switcher is on in this session.'
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test D:\Projects\agen-switcher-mod` → FAIL.

- [ ] **Step 3: Implement `hooks/register.ts`** as specified above.

- [ ] **Step 4: Run all tests, validate, type-check**

Run: `claude plugin test D:\Projects\agen-switcher-mod` → all PASS.
Run: `claude plugin validate D:\Projects\agen-switcher-mod` → no refusals. It will list `prompt.submit` and `command.run` as gating hooks, and that's expected.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wire classifier, pause commands and status line to the engine"
```

---

### Task 4: Check it in a real session

**Files:** none, unless a check fails.

- [ ] **Step 1:** Start `claude --plugin-dir D:\Projects\agen-switcher-mod --debug`.
- [ ] **Step 2:** Send "what does ls do?". Expect the status line to show `auto: haiku · low` or similar, and the debug log to show the request sent with that model. **If the engine refuses the alias at `turn.step`**, add a `MODEL_IDS: Record<Model, string>` map in `policy.ts` (current ids: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`), pass the id there, and commit.
- [ ] **Step 3:** Confirm the classifier's own Haiku call doesn't show up as a `turn.step` the mod rewrites (debug log). If it does, skip steps whose `e.model` is the classifier's and commit.
- [ ] **Step 4:** Send a prompt that should need deep reasoning, until the Above High confirmation appears. Try both Approve and Reject, and check the status line each time.
- [ ] **Step 5:** `/agent-switcher off` → status `auto: paused`, and the next prompt makes no Haiku call. `/agent-switcher on` → resumes. Open a second session and confirm it isn't paused.
- [ ] **Step 6:** Commit any fixes: `git commit -am "fix: <what the real session showed>"`.
