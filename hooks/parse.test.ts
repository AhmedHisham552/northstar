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

test('final-review: v1 commands do not become goals', () => {
  expect(parse('clear')).toEqual({ kind: 'help' })
  expect(parse('history 7')).toEqual({ kind: 'help' })
  expect(parse('list')).toEqual({ kind: 'help' })
})

test('work starts a goal', () => {
  expect(parse('work 3')).toEqual({ kind: 'work', items: [{ goal: 3 }] })
  expect(parse('work 1 #3')).toEqual({ kind: 'work', items: [{ goal: 1 }, { goal: 3 }] })
  expect(parse('work [1,3]')).toEqual({ kind: 'work', items: [{ goal: 1 }, { goal: 3 }] })
  expect(parse('work 1, 3')).toEqual({ kind: 'work', items: [{ goal: 1 }, { goal: 3 }] })
  expect(parse('work 2.4 2.5 1')).toEqual({ kind: 'work', items: [{ goal: 2, subs: [4, 5] }, { goal: 1 }] })
  expect(parse('work 2.4 workflow')).toEqual({ kind: 'work', items: [{ goal: 2, subs: [4] }], mode: 'workflow' })
  expect(parse('work 1 agents')).toEqual({ kind: 'work', items: [{ goal: 1 }], mode: 'agents' })
  expect(parse('work')).toEqual({ kind: 'help' })
})

test('rm takes a list of goals and sub-tasks', () => {
  const rm = (goal: number, sub?: number) => ({ kind: 'rm', goal, ...(sub ? { sub } : {}) })
  expect(parse('rm 5, 6')).toEqual({ kind: 'ops', ops: [rm(5), rm(6)] })
  expect(parse('rm [5,6]')).toEqual({ kind: 'ops', ops: [rm(5), rm(6)] })
  expect(parse('rm 5 3.2')).toEqual({ kind: 'ops', ops: [rm(5), rm(3, 2)] })
  expect(parse('rm 4')).toEqual({ kind: 'op', op: rm(4) })
  expect(parse('rm 4, x')).toEqual({ kind: 'help' })
})

test('start and stop', () => {
  expect(parse('start 2.4')).toEqual({ kind: 'ops', ops: [{ kind: 'start', goal: 2, sub: 4 }] })
  expect(parse('start 2.4, 3')).toEqual({ kind: 'ops', ops: [{ kind: 'start', goal: 2, sub: 4 }, { kind: 'start', goal: 3 }] })
  expect(parse('stop 3')).toEqual({ kind: 'ops', ops: [{ kind: 'stop', goal: 3 }] })
  expect(parse('stop')).toEqual({ kind: 'ops', ops: [{ kind: 'stop' }] })
})
