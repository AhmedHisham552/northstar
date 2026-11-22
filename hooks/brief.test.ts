import { expect, test } from 'claude-code/testing'

import { goalsBrief, hintTail, workPrompt } from './brief'
import { applyOp, emptyState } from './model'
import type { Op, State } from './model'

const AT = '2026-11-18T10:00:00+02:00'
function build(ops: Op[]): State {
  let s = emptyState()
  for (const op of ops) {
    const r = applyOp(s, op, AT)
    if ('error' in r) throw new Error(r.error)
    s = r.state
  }
  return s
}
const state = build([
  { kind: 'add', texts: ['Card research', 'Done thing'], label: 'shop' },
  { kind: 'add', texts: ['Write post'], label: null },
  { kind: 'sub', goal: 1, texts: ['Read docs', 'Pricing call'] },
  { kind: 'done', goal: 2 },
  { kind: 'focus', goal: 1, label: null },
])
const view = { state, label: 'shop', today: '2026-11-18', collapsed: [] }

test('the brief lists open goals with sub-tasks and tells Claude when to update', () => {
  const b = goalsBrief(view)
  expect(b).toContain('#1 Card research [shop] (NOW)')
  expect(b).toContain('1.1 [ ] Read docs')
  expect(b).toContain('#3 Write post [general]')
  expect(b).not.toContain('Done thing')
  expect(b).toContain('update_goals')
  expect(b).toContain('focus')
  expect(b).toContain('"start <n>.<m>"')
})

test('the hint tail names the focused goal, and is empty without focus', () => {
  expect(hintTail(view)).toBe('◎ Now ○ #1 Card research 0/2')
  expect(hintTail({ ...view, state: build([{ kind: 'add', texts: ['A'], label: null }]) })).toBe('')
})

test('the work prompt aligns first, then dispatches each goal', () => {
  const p = workPrompt([{ goal: state.goals[0]! }, { goal: state.goals[2]! }], 'agents')
  expect(p).toContain('#1 Card research')
  expect(p).toContain('1.2 Pricing call')
  expect(p).toContain('#3 Write post')
  expect(p).toContain('update_goals')
  expect(p).toMatch(/Phase 1, align/)
  expect(p).toMatch(/Phase 2, dispatch/)
  expect(p).toContain('start <n>.<m>')
})

test('work on chosen sub-tasks only, dispatched as workflows', () => {
  const p = workPrompt([{ goal: state.goals[0]!, subs: [2] }], 'workflow')
  expect(p).toContain('1.2 Pricing call')
  expect(p).not.toContain('1.1 Read docs')
  expect(p).toContain('only these sub-tasks')
  expect(p).toContain('Workflow tool')
  expect(p).not.toContain('one background agent per goal')
})
