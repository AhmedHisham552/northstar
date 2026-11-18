import { expect, test } from 'claude-code/testing'

import { applyOp, emptyState, glyph, labelKey, progressOf, visibleGoals } from './model'
import type { State } from './model'

const AT = '2026-11-18T10:00:00.000Z'

function ok(r: ReturnType<typeof applyOp>) {
  if ('error' in r) throw new Error(r.error)
  return r
}

function seeded(): State {
  let s = ok(applyOp(emptyState(), { kind: 'add', texts: ['A', 'B'], label: null }, AT)).state
  s = ok(applyOp(s, { kind: 'sub', goal: 1, texts: ['x', 'y', 'z'] }, AT)).state
  return s
}

test('add assigns permanent ids and logs goal.add', () => {
  const r = ok(applyOp(emptyState(), { kind: 'add', texts: ['A', 'B'], label: 'work' }, AT))
  expect(r.state.goals.map(g => g.id)).toEqual([1, 2])
  expect(r.state.nextId).toBe(3)
  expect(r.events.map(e => [e.type, e.goal, e.label, e.text])).toEqual([
    ['goal.add', 1, 'work', 'A'],
    ['goal.add', 2, 'work', 'B'],
  ])
})

test('ticking the only sub finishes the goal, unticking reopens it', () => {
  let s = ok(applyOp(emptyState(), { kind: 'add', texts: ['A'], label: null }, AT)).state
  s = ok(applyOp(s, { kind: 'sub', goal: 1, texts: ['x'] }, AT)).state
  const done = ok(applyOp(s, { kind: 'tick', goal: 1, sub: 1, note: 'n' }, AT))
  expect(done.events.map(e => e.type)).toEqual(['sub.done', 'goal.done'])
  expect(done.events[0]!.note).toBe('n')
  expect(done.state.goals[0]!.doneAt).toBe(AT)
  const back = ok(applyOp(done.state, { kind: 'tick', goal: 1, sub: 1 }, AT))
  expect(back.events.map(e => e.type)).toEqual(['sub.undone', 'goal.reopen'])
  expect(back.state.goals[0]!.doneAt).toBe(null)
})

test('done with open subs lists them', () => {
  let s = seeded()
  s = ok(applyOp(s, { kind: 'tick', goal: 1, sub: 1 }, AT)).state
  const r = ok(applyOp(s, { kind: 'done', goal: 1 }, AT))
  expect(r.events.at(-1)!.type).toBe('goal.done')
  expect(r.events.at(-1)!.open).toEqual(['y', 'z'])
  expect(progressOf(r.state.goals[0]!)).toBe(100)
})

test('manual progress is refused on a goal with subs, logged otherwise', () => {
  const s = seeded()
  expect(applyOp(s, { kind: 'progress', goal: 1, value: 40 }, AT)).toEqual({ error: 'goal 1 has sub-tasks; tick them instead' })
  const r = ok(applyOp(s, { kind: 'progress', goal: 2, value: 40 }, AT))
  expect(r.events[0]).toMatchObject({ type: 'goal.progress', goal: 2, from: 0, to: 40 })
  expect(progressOf(r.state.goals[1]!)).toBe(40)
  expect(progressOf(seeded().goals[0]!)).toBe(0)
})

test('ids are never reused', () => {
  let s = ok(applyOp(seeded(), { kind: 'rm', goal: 2 }, AT)).state
  s = ok(applyOp(s, { kind: 'add', texts: ['C'], label: null }, AT)).state
  expect(s.goals.map(g => g.id)).toEqual([1, 3])
  s = ok(applyOp(s, { kind: 'rm', goal: 1, sub: 3 }, AT)).state
  s = ok(applyOp(s, { kind: 'sub', goal: 1, texts: ['w'] }, AT)).state
  expect(s.goals[0]!.subs.map(x => x.id)).toEqual([1, 2, 4])
})

test('focus is kept per label and cleared', () => {
  let s = ok(applyOp(emptyState(), { kind: 'add', texts: ['A'], label: 'work' }, AT)).state
  s = ok(applyOp(s, { kind: 'add', texts: ['B'], label: null }, AT)).state
  s = ok(applyOp(s, { kind: 'focus', goal: 1, label: null }, AT)).state
  s = ok(applyOp(s, { kind: 'focus', goal: 2, label: null }, AT)).state
  expect(s.focus).toEqual({ work: 1, general: 2 })
  s = ok(applyOp(s, { kind: 'focus', goal: null, label: 'work' }, AT)).state
  expect(s.focus).toEqual({ general: 2 })
  expect(labelKey(null)).toBe('general')
})

test('RF1: unknown goal or sub is an error and changes nothing', () => {
  const s = seeded()
  const before = JSON.stringify(s)
  expect(applyOp(s, { kind: 'tick', goal: 9, sub: 9 }, AT)).toEqual({ error: 'no goal #9' })
  expect(applyOp(s, { kind: 'done', goal: 42 }, AT)).toEqual({ error: 'no goal #42' })
  expect(applyOp(s, { kind: 'tick', goal: 1, sub: 9 }, AT)).toEqual({ error: 'no sub-task 1.9' })
  expect(JSON.stringify(s)).toBe(before)
})

test('glyph thresholds', () => {
  expect([0, 1, 37, 38, 62, 63, 99, 100].map(glyph)).toEqual(['○', '◔', '◔', '◑', '◑', '◕', '◕', '✓'])
})

test('finished goals show only on the day they were finished', () => {
  let s = ok(applyOp(emptyState(), { kind: 'add', texts: ['old', 'new', 'open'], label: null }, AT)).state
  s = ok(applyOp(s, { kind: 'done', goal: 1 }, '2026-11-17T09:00:00.000Z')).state
  s = ok(applyOp(s, { kind: 'done', goal: 2 }, '2026-11-18T09:00:00.000Z')).state
  expect(visibleGoals(s, '2026-11-18').map(g => g.text)).toEqual(['new', 'open'])
})

test('final-review: a tick with an explicit target state is a no-op when already there', () => {
  const s = seeded()
  const once = ok(applyOp(s, { kind: 'tick', goal: 1, sub: 1, done: true }, AT))
  const again = ok(applyOp(once.state, { kind: 'tick', goal: 1, sub: 1, done: true }, AT))
  expect(again.events).toEqual([])
  expect(again.state.goals[0]!.subs[0]!.done).toBe(true)
})
