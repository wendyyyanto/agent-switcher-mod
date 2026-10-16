import { expect, test } from 'claude-code/testing'

import {
  capAtHigh,
  guardFallback,
  isAboveHigh,
  parseChoice,
  statusFor,
  type Effort,
} from '../hooks/policy'

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
  expect((['low', 'medium', 'high'] as Effort[]).map(isAboveHigh)).toEqual([false, false, false])
  expect(isAboveHigh('xhigh')).toBe(true)
  expect(isAboveHigh('max')).toBe(true)
})

test('capAtHigh', () => {
  expect(capAtHigh('max')).toBe('high')
  expect(capAtHigh('xhigh')).toBe('high')
  expect(capAtHigh('medium')).toBe('medium')
  expect(capAtHigh(32000)).toBe('high')
  expect(capAtHigh(undefined)).toBe(undefined)
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
