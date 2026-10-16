import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// Hooks beneath the mod stand in for the engine; they record what reaches them.
function engine(on: On, classifier: string | null | Error, opts: { drop?: boolean } = {}) {
  const seen = { models: [] as string[], classified: 0, steps: [] as { model: string; effort: unknown }[], status: [] as unknown[] }
  on('model.complete', ($, e) => {
    seen.classified++
    seen.models.push(e.model)
    if (classifier instanceof Error) throw classifier
    return {
      value: classifier === null
        ? { isAnswered: false, reason: 'api-error', status: 500, error: 'server_error', usage: USAGE }
        : { isAnswered: true, text: classifier, usage: USAGE },
    } as never
  })
  on('ui.status', ($, e) => {
    seen.status.push(e)
    return { value: undefined } as never
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => (opts.drop ? { drop: 'not now' } : { text: e.text }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    seen.steps.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  return seen
}

const start = ($: Engine) => $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true } as never)
const prompt = ($: Engine, extra: object = {}) =>
  $.prompt.submit({ text: 'fix the bug', wait: false, origin: { kind: 'sdk' }, ...extra } as never)
const command = ($: Engine, args: string) =>
  $.command.run({ command: 'agent-switcher', args, origin: { kind: 'composer' } } as never) as Promise<{ text: string }>
async function step($: Engine, model: string, effort: unknown, agentId?: string) {
  const s = $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
  for await (const _ of s);
}

test('classified choice reaches main-loop steps', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  await prompt($)
  await step($, 'claude-sonnet-5-5', 'high')
  expect(seen.steps).toEqual([{ model: 'cc/claude-opus-5-5', effort: 'medium' }])
})

test('subagent steps are untouched', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  await prompt($)
  await step($, 'claude-haiku-5-5', 'low', 'a1')
  expect(seen.steps).toEqual([{ model: 'claude-haiku-5-5', effort: 'low' }])
})

test('slash commands are not classified', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  await prompt($, { command: { name: 'compact' } })
  expect(seen.classified).toBe(0)
})

test('paused skips classification and switching', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  expect((await command($, 'off')).text).toBe('agent-switcher paused for this session.')
  await prompt($)
  await step($, 'claude-fable-5-1', 'max')
  expect(seen.classified).toBe(0)
  expect(seen.steps).toEqual([{ model: 'claude-fable-5-1', effort: 'max' }])
})

test('on resumes', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  await command($, 'off')
  expect((await command($, 'on')).text).toBe('agent-switcher resumed for this session.')
  await prompt($)
  expect(seen.classified).toBe(1)
})

test('prompt during a running turn is not classified', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await prompt($)
  expect(seen.classified).toBe(0)
})

test('classifier failure under sdk keeps, guard catches fable', async ($, on) => {
  const seen = engine(on, null)
  await start($)
  await prompt($)
  await step($, 'claude-fable-5-1', 'max')
  expect(seen.steps).toEqual([{ model: 'cc/claude-sonnet-5-5', effort: 'high' }])
})

test('classifier failure keeps an allowed session model', async ($, on) => {
  const seen = engine(on, null)
  await start($)
  await prompt($)
  await step($, 'claude-sonnet-5-5', 'max')
  expect(seen.steps).toEqual([{ model: 'claude-sonnet-5-5', effort: 'max' }])
})

test('decision cleared after turn.complete', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  await prompt($)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await step($, 'claude-sonnet-5-5', 'high')
  expect(seen.steps).toEqual([{ model: 'claude-sonnet-5-5', effort: 'high' }])
})

test('bare command reports state', async ($, on) => {
  engine(on, null)
  await start($)
  expect((await command($, '')).text).toBe('agent-switcher is on in this session.')
  await command($, 'off')
  expect((await command($, '')).text).toBe('agent-switcher is paused in this session.')
  expect((await command($, 'sideways')).text).toBe('Usage: /agent-switcher [on|off]')
})

test('unclassified turn on a Fable session is still guarded', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"medium"}')
  await start($)
  await prompt($, { command: { name: 'review' } })
  await step($, 'claude-fable-5-1', 'max')
  expect(seen.steps).toEqual([{ model: 'cc/claude-sonnet-5-5', effort: 'high' }])
})

test('classifier rejection fails closed', async ($, on) => {
  const seen = engine(on, new Error('blocked model'))
  await start($)
  await prompt($)
  await step($, 'claude-fable-5-1', 'max')
  expect(seen.steps).toEqual([{ model: 'cc/claude-sonnet-5-5', effort: 'high' }])
})

test('a dropped prompt leaves no decision behind', async ($, on) => {
  const seen = engine(on, '{"model":"opus","effort":"max"}', { drop: true })
  await start($)
  await prompt($)
  await step($, 'claude-sonnet-5-5', 'high')
  expect(seen.steps).toEqual([{ model: 'claude-sonnet-5-5', effort: 'high' }])
})

test('the classifier is asked through the gateway id', async ($, on) => {
  const seen = engine(on, null)
  await start($)
  await prompt($)
  expect(seen.models).toEqual(['cc/claude-haiku-5-5'])
})
