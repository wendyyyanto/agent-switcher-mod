import { expect, test } from 'claude-code/testing'

import { decide, type Ask, type Classify } from '../hooks/flow'
import type { Choice } from '../hooks/policy'

// A string answers the dialog, an Error dismisses it.
function script(answers: (string | Error)[]) {
  const asks: { question: string; options: readonly string[]; header: string }[] = []
  const ask: Ask = async (question, options, header) => {
    asks.push({ question, options, header })
    const next = answers.shift()
    if (next === undefined || next instanceof Error) throw next ?? new Error('dismissed')
    return next
  }
  return { ask, asks }
}

function classifier(results: (Choice | null)[]) {
  const calls = { n: 0 }
  const classify: Classify = async () => {
    calls.n++
    return results.shift() ?? null
  }
  return { classify, calls }
}

test('choice at or below high needs no dialog', async () => {
  const { ask, asks } = script([])
  const { classify } = classifier([{ model: 'sonnet', effort: 'high' }])
  expect(await decide({ classify, ask, interactive: true })).toEqual({ model: 'sonnet', effort: 'high' })
  expect(asks.length).toBe(0)
})

test('above high approved keeps it', async () => {
  const { ask, asks } = script(['Use max'])
  const { classify } = classifier([{ model: 'opus', effort: 'max' }])
  expect(await decide({ classify, ask, interactive: true })).toEqual({ model: 'opus', effort: 'max' })
  expect(asks[0]).toEqual({
    question: 'This prompt looks like it needs max effort. Use it?',
    options: ['Use max', 'Use high'],
    header: 'Effort',
  })
})

test('above high rejected or dismissed drops to high', async () => {
  for (const answer of ['Use high', new Error('dismissed')]) {
    const { ask } = script([answer])
    const { classify } = classifier([{ model: 'opus', effort: 'xhigh' }])
    expect(await decide({ classify, ask, interactive: true })).toEqual({ model: 'opus', effort: 'high' })
  }
})

test('above high without anyone to ask drops to high', async () => {
  const { ask, asks } = script([])
  const { classify } = classifier([{ model: 'opus', effort: 'max' }])
  expect(await decide({ classify, ask, interactive: false })).toEqual({ model: 'opus', effort: 'high' })
  expect(asks.length).toBe(0)
})

test('failure then retry uses the second answer', async () => {
  const { ask, asks } = script(['Retry'])
  const { classify, calls } = classifier([null, { model: 'haiku', effort: 'low' }])
  expect(await decide({ classify, ask, interactive: true })).toEqual({ model: 'haiku', effort: 'low' })
  expect(calls.n).toBe(2)
  expect(asks[0]).toEqual({
    question: "Couldn't pick a model for this prompt. Retry or choose yourself?",
    options: ['Retry', "I'll choose"],
    header: 'Auto model',
  })
})

test('failure twice asks twice, never loops alone', async () => {
  const { ask, asks } = script(['Retry', new Error('dismissed')])
  const { classify, calls } = classifier([null, null])
  expect(await decide({ classify, ask, interactive: true })).toBe('keep')
  expect(asks.length).toBe(2)
  expect(calls.n).toBe(2)
})

test("I'll choose with Above High needs no confirmation", async () => {
  const { ask, asks } = script(["I'll choose", 'Opus', 'Above High', 'max'])
  const { classify } = classifier([null])
  expect(await decide({ classify, ask, interactive: true })).toEqual({ model: 'opus', effort: 'max' })
  expect(asks.length).toBe(4)
  expect(asks.slice(1)).toEqual([
    { question: 'Which model for this prompt?', options: ['Haiku', 'Sonnet', 'Opus'], header: 'Model' },
    { question: 'Which effort?', options: ['Low', 'Medium', 'High', 'Above High'], header: 'Effort' },
    { question: 'Which level above High?', options: ['xhigh', 'max'], header: 'Effort' },
  ])
})

test("I'll choose basic", async () => {
  const { ask } = script(["I'll choose", 'Sonnet', 'Low'])
  const { classify } = classifier([null])
  expect(await decide({ classify, ask, interactive: true })).toEqual({ model: 'sonnet', effort: 'low' })
})

test('free text counts as dismissal', async () => {
  for (const answers of [['whatever'], ["I'll choose", 'gpt'], ["I'll choose", 'Opus', 'extreme']]) {
    const { ask } = script(answers)
    const { classify } = classifier([null])
    expect(await decide({ classify, ask, interactive: true })).toBe('keep')
  }
  const { ask } = script(['sure'])
  const { classify } = classifier([{ model: 'opus', effort: 'max' }])
  expect(await decide({ classify, ask, interactive: true })).toEqual({ model: 'opus', effort: 'high' })
})

test('failure without anyone to ask keeps', async () => {
  const { ask, asks } = script([])
  const { classify } = classifier([null])
  expect(await decide({ classify, ask, interactive: false })).toBe('keep')
  expect(asks.length).toBe(0)
})
