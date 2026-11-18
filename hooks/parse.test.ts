import { expect, test } from 'claude-code/testing'

import { parse } from './parse'

const op = (args: string) => {
  const c = parse(args)
  if (c.kind !== 'op') throw new Error(`not an op: ${args}`)
  return c.op
}

test('add, with and without labels, split on ;', () => {
  expect(op('add A; B')).toEqual({ kind: 'add', texts: ['A', 'B'], label: null })
  expect(op('Write docs')).toEqual({ kind: 'add', texts: ['Write docs'], label: null })
  expect(op('add @work A; B')).toEqual({ kind: 'add', texts: ['A', 'B'], label: 'work' })
  expect(op('add @here A')).toEqual({ kind: 'add', texts: ['A'], label: '@here' })
  expect(op('add @general A')).toEqual({ kind: 'add', texts: ['A'], label: null })
})

test('sub, tick, progress, done, rm with notes', () => {
  expect(op('sub 3 x; y')).toEqual({ kind: 'sub', goal: 3, texts: ['x', 'y'] })
  expect(op('tick 3.2 "met PM"')).toEqual({ kind: 'tick', goal: 3, sub: 2, note: 'met PM' })
  expect(op('tick 3.2 “curly”')).toEqual({ kind: 'tick', goal: 3, sub: 2, note: 'curly' })
  expect(op('tick 3.2')).toEqual({ kind: 'tick', goal: 3, sub: 2 })
  expect(op('3 40')).toEqual({ kind: 'progress', goal: 3, value: 40 })
  expect(op('#3 40 "half"')).toEqual({ kind: 'progress', goal: 3, value: 40, note: 'half' })
  expect(op('done 4')).toEqual({ kind: 'done', goal: 4 })
  expect(op('rm 4')).toEqual({ kind: 'rm', goal: 4 })
  expect(op('rm 4.1')).toEqual({ kind: 'rm', goal: 4, sub: 1 })
})

test('focus and tag', () => {
  expect(op('focus 2')).toEqual({ kind: 'focus', goal: 2, label: null })
  expect(op('focus off')).toEqual({ kind: 'focus', goal: null, label: '@here' })
  expect(op('tag 2 @work')).toEqual({ kind: 'tag', goal: 2, label: 'work' })
  expect(op('tag 2 @general')).toEqual({ kind: 'tag', goal: 2, label: null })
})

test('views and summaries', () => {
  expect(parse('')).toEqual({ kind: 'help' })
  expect(parse('@work')).toEqual({ kind: 'show', label: 'work' })
  expect(parse('done-list')).toEqual({ kind: 'doneList' })
  expect(parse('yesterday')).toEqual({ kind: 'summary', period: 'yesterday' })
  expect(parse('week')).toEqual({ kind: 'summary', period: 'week' })
  expect(parse('from 2026-11-01 to 2026-11-15')).toEqual({ kind: 'range', from: '2026-11-01', to: '2026-11-15' })
  expect(parse('from 2026-11-40 to x')).toEqual({ kind: 'help' })
  expect(parse('tick x')).toEqual({ kind: 'help' })
})
