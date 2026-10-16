export type Model = 'haiku' | 'sonnet' | 'opus'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Choice = { model: Model; effort: Effort }

// The only models the mod may ever choose: never Fable or anything on credits.
export const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function parseChoice(text: string): Choice | null {
  const json = text.match(/\{[\s\S]*?\}/)?.[0]
  if (!json) return null
  try {
    const raw = JSON.parse(json) as { model?: unknown; effort?: unknown }
    const model = String(raw.model ?? '').trim().toLowerCase() as Model
    const effort = String(raw.effort ?? '').trim().toLowerCase() as Effort
    return MODELS.includes(model) && EFFORTS.includes(effort) ? { model, effort } : null
  } catch {
    return null
  }
}

export const isAboveHigh = (effort: Effort): boolean => effort === 'xhigh' || effort === 'max'

export function capAtHigh(effort: Effort | number | undefined): Effort | undefined {
  if (effort === undefined) return undefined
  if (typeof effort === 'number' || isAboveHigh(effort)) return 'high'
  return effort
}

// An optional provider prefix (`cc/`) is fine; a `[1m]` or other suffix counts as not allowed.
export const isAllowedSessionModel = (id: string): boolean =>
  /^(?:[\w.-]+\/)?(?:claude-)?(haiku|sonnet|opus)(?:-[\w.-]*)?$/i.test(id)

export function guardFallback(
  sessionModel: string,
  sessionEffort: Effort | number | undefined,
): { model: Model; effort: Effort | undefined } | null {
  return isAllowedSessionModel(sessionModel) ? null : { model: 'sonnet', effort: capAtHigh(sessionEffort) }
}

export const classifierPrompt = (prompt: string): string => `You route a coding assistant's prompt to a model and a reasoning effort.
Reply with only JSON: {"model": "<model>", "effort": "<effort>"}

Models:
- haiku: lookups, quick questions, trivial or mechanical edits
- sonnet: ordinary coding, refactors, writing and reviewing code
- opus: hard design, tricky debugging, large multi-file changes

Efforts, by how much reasoning the task needs:
- low: almost none
- medium: some
- high: careful multi-step reasoning
- xhigh: very hard problems
- max: the hardest problems, where depth matters more than time

<prompt>
${prompt}
</prompt>`

export const statusFor = (choice: Choice): string => `auto: ${choice.model} · ${choice.effort}`
