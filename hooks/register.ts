import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { decide } from './flow'
import { classifierPrompt, guardFallback, parseChoice, statusFor, type Choice } from './policy'

const paused = atom({ plugin: 'agent-switcher-mod', key: 'paused' } as const, false)

const CLASSIFIED = ['composer', 'bridge', 'sdk', 'scheduled-trigger']
const INTERACTIVE = ['composer', 'bridge']

export const register: Register = on => {
  // The decision for the main loop's running turn: null leaves it untouched.
  let current: Choice | 'keep' | null = null
  let inTurn = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-switcher',
      description: 'Pause or resume automatic model and effort switching for this session (on | off)',
    })
    $.ui.status((await read($, paused)) ? 'auto: paused' : 'auto: on')
    return next(e)
  })

  on('command.run', { command: 'agent-switcher' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off' || arg === 'on') {
      await update($, paused, () => arg === 'off')
      $.ui.status(arg === 'off' ? 'auto: paused' : 'auto: on')
      return { text: `agent-switcher ${arg === 'off' ? 'paused' : 'resumed'} for this session.` }
    }
    if (arg === '') return { text: `agent-switcher is ${(await read($, paused)) ? 'paused' : 'on'} in this session.` }
    return { text: 'Usage: /agent-switcher [on|off]' }
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) inTurn = true
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      inTurn = false
      current = null
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || inTurn || e.turnId !== undefined || !CLASSIFIED.includes(e.origin.kind) || (await read($, paused)))
      return next(e)

    current = await decide({
      interactive: INTERACTIVE.includes(e.origin.kind),
      classify: async () => {
        const r = await $.model.complete({ model: 'haiku', effort: 'low', prompt: classifierPrompt(e.text), timeoutMs: 15000 })
        return r.isAnswered ? parseChoice(r.text) : null
      },
      ask: (question, options, header) => $.ui.ask(question, { options, header }),
    })
    $.ui.status(current === 'keep' ? 'auto: not switched' : statusFor(current))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || current === null) return yield* next(e)
    if (current !== 'keep') return yield* next({ ...e, model: current.model, effort: current.effort })

    // Credit guard: "not switched" must still never run on a model off the allowlist.
    const guard = guardFallback(e.model, e.effort)
    if (!guard) return yield* next(e)
    $.ui.status(`auto: sonnet · ${guard.effort ?? 'default'}`)
    return yield* next({ ...e, model: guard.model, ...(guard.effort ? { effort: guard.effort } : {}) })
  })
}
