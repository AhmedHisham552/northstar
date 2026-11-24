import { expect, test } from 'claude-code/testing'

import { goalsBrief, hintTail, shortTitle, workPrompt } from './brief'
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

test('a long goal gets the model title, else its first sentence cut to fit', () => {
  const long = 'Improve the pane. It should show details faded under the title so agents know the goal in full and so do I.'
  expect(shortTitle('"Show goal details in the pane."', long)).toBe('Show goal details in the pane')
  expect(shortTitle(null, long)).toBe('Improve the pane.')
  expect(shortTitle('', 'x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
})

test('details reach Claude and dispatched agents', () => {
  const s = build([{ kind: 'add', texts: ['Smarter track add'], details: ['the whole paragraph'], label: null }, { kind: 'focus', goal: 1, label: null }])
  expect(goalsBrief({ state: s, label: 'shop', today: '2026-11-18', collapsed: [] })).toContain('#1 Smarter track add [general] (NOW)\n  details: the whole paragraph')
  expect(workPrompt([{ goal: s.goals[0]! }], 'agents')).toContain('#1 Smarter track add\n  details (as I wrote it): the whole paragraph')
})

test('the brief lists ad-hoc work and a waiting card, and comes even with no open goals', () => {
  let s = emptyState()
  for (const op of [{ kind: 'did', text: 'Slack sync', label: null }, { kind: 'did', text: 'rename', label: null }, { kind: 'group', title: 'W', ids: [1, 2] }] as Op[]) {
    const r = applyOp(s, op, AT)
    if ('error' in r) throw new Error(r.error)
    s = r.state
  }
  const b = goalsBrief({ state: s, label: 'shop', today: '2026-11-18', collapsed: [] })
  expect(b).toContain('(no open goals)')
  expect(b).toContain('Ad-hoc work logged today (id, text):\n  1 Slack sync\n  2 rename')
  expect(b).toContain('Grouping card waiting in the pane: "W" (1, 2)')
  expect(b).toContain('"did <short past-tense line>"')
})
