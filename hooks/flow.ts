import { isAboveHigh, type Choice, type Effort, type Model } from './policy'

// Resolves to the chosen label or typed text; rejects when dismissed.
export type Ask = (question: string, options: readonly string[], header: string) => Promise<string>
export type Classify = () => Promise<Choice | null>

const MODEL_LABELS: Record<string, Model> = { Haiku: 'haiku', Sonnet: 'sonnet', Opus: 'opus' }
const EFFORT_LABELS: Record<string, Effort> = { Low: 'low', Medium: 'medium', High: 'high' }
const ABOVE_HIGH: readonly Effort[] = ['xhigh', 'max']

// A dismissed dialog reads as undefined, like an answer that is not an option.
const answer = (ask: Ask, question: string, options: readonly string[], header: string) =>
  ask(question, options, header).then(
    picked => (options.includes(picked) ? picked : undefined),
    () => undefined,
  )

async function confirm(choice: Choice, ask: Ask, interactive: boolean): Promise<Choice> {
  if (!isAboveHigh(choice.effort)) return choice
  if (!interactive) return { ...choice, effort: 'high' }
  const use = `Use ${choice.effort}`
  const picked = await answer(ask, `This prompt looks like it needs ${choice.effort} effort. Use it?`, [use, 'Use high'], 'Effort')
  return picked === use ? choice : { ...choice, effort: 'high' }
}

async function chooseManually(ask: Ask): Promise<Choice | 'keep'> {
  const model = MODEL_LABELS[(await answer(ask, 'Which model for this prompt?', ['Haiku', 'Sonnet', 'Opus'], 'Model')) ?? '']
  if (!model) return 'keep'
  const level = await answer(ask, 'Which effort?', ['Low', 'Medium', 'High', 'Above High'], 'Effort')
  if (level === undefined) return 'keep'
  const effort = level === 'Above High'
    ? (await answer(ask, 'Which level above High?', ABOVE_HIGH, 'Effort')) as Effort | undefined
    : EFFORT_LABELS[level]
  return effort ? { model, effort } : 'keep'
}

export async function decide(deps: { classify: Classify; ask: Ask; interactive: boolean }): Promise<Choice | 'keep'> {
  const { classify, ask, interactive } = deps
  for (;;) {
    const choice = await classify()
    if (choice) return confirm(choice, ask, interactive)
    if (!interactive) return 'keep'
    const picked = await answer(ask, "Couldn't pick a model for this prompt. Retry or choose yourself?", ['Retry', "I'll choose"], 'Auto model')
    if (picked === "I'll choose") return chooseManually(ask)
    if (picked !== 'Retry') return 'keep'
  }
}
