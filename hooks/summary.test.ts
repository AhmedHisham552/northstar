import { expect, test } from 'claude-code/testing'

import type { Event } from './model'
import { dayRange, localIso, periodRange, postPrompt, summarize } from './summary'

const at = (day: number, hour: number) => localIso(new Date(2026, 10, day, hour))
const ev = (day: number, hour: number, type: string, goal: number, text: string, extra: Partial<Event> = {}): Event => ({
  at: at(day, hour), type, goal, label: null, text, ...extra,
})

test('yesterday is the previous working day for each work week', () => {
  const sunday = new Date(2026, 10, 22, 10)
  expect(periodRange('yesterday', sunday, 'sun-thu').title).toBe('Thu 19 Nov')
  expect(periodRange('yesterday', sunday, 'mon-fri').title).toBe('Fri 20 Nov')
  expect(periodRange('yesterday', new Date(2026, 10, 18, 10), 'sun-thu').from).toEqual(new Date(2026, 10, 17))
  expect(periodRange('today', sunday, 'sun-thu').from).toEqual(new Date(2026, 10, 22))
})

test('week starts on the work week first day', () => {
  const wed = new Date(2026, 10, 18, 10)
  expect(periodRange('week', wed, 'sun-thu').from).toEqual(new Date(2026, 10, 15))
  expect(periodRange('week', wed, 'mon-fri').from).toEqual(new Date(2026, 10, 16))
  expect(periodRange('week', wed, 'mon-fri').title).toBe('Mon 16 Nov – Wed 18 Nov')
  expect(dayRange('2026-11-16', '2026-11-17')).toEqual({ from: new Date(2026, 10, 16), to: new Date(2026, 10, 18), title: 'Mon 16 Nov – Tue 17 Nov' })
})

const LOG: Event[] = [
  ev(16, 9, 'goal.add', 1, 'Card research'),
  ev(16, 9, 'goal.add', 2, 'Demo prep'),
  ev(16, 9, 'goal.add', 3, 'Security review'),
  ev(16, 9, 'goal.add', 4, 'Partner API'),
  ev(16, 9, 'sub.add', 1, 'Read docs', { sub: 1 }),
  ev(16, 9, 'sub.add', 1, 'Pricing call', { sub: 2 }),
  ev(16, 10, 'goal.focus', 1, 'Card research'),
  ev(16, 11, 'goal.progress', 2, 'Demo prep', { from: 0, to: 20 }),
  ev(17, 10, 'sub.done', 1, 'Pricing call', { sub: 2, note: 'sandbox next week' }),
  ev(17, 11, 'goal.done', 3, 'Security review'),
  ev(17, 12, 'goal.progress', 2, 'Demo prep', { from: 20, to: 60 }),
]

test('a day summary lists planned, done, moved and still open', () => {
  const r = periodRange('yesterday', new Date(2026, 10, 18, 9), 'sun-thu')
  expect(summarize(LOG, r.from, r.to, r.title, false)).toBe(
    [
      'Tue 17 Nov',
      'PLANNED     4 goals open, focus: Card research',
      'DONE        ◑ Card research  1/2',
      '              ✓ Pricing call',
      '                sandbox next week',
      '            ✓ Security review',
      'MOVED       ◔→◑ Demo prep  20% → 60%',
      'STILL OPEN  Partner API',
    ].join('\n'),
  )
})

test('grouping by label puts each label under its own heading', () => {
  const tagged = LOG.map(e => (e.goal === 4 ? { ...e, label: 'api' } : e))
  const out = summarize(tagged, new Date(2026, 10, 16), new Date(2026, 10, 18), 'Mon 16 Nov – Tue 17 Nov', true)
  expect(out.split('\n').filter(l => /^[A-Z]+$/.test(l))).toEqual(['API', 'GENERAL'])
})

test('RF4: an empty period says so', () => {
  expect(summarize(LOG, new Date(2026, 10, 19), new Date(2026, 10, 20), 'Thu 19 Nov', false)).toBe('Nothing logged for Thu 19 Nov.')
  expect(postPrompt('LOG', 'day')).toContain('LOG')
})

test('final-review: the post prompt fits the period', () => {
  expect(postPrompt('LOG', 'day')).toContain('standup')
  expect(postPrompt('LOG', 'span')).toContain('weekly review')
  expect(postPrompt('LOG', 'span')).not.toContain('Yesterday')
})

test('a sub-task ticked, unticked and ticked again counts once; a reopened goal is not done', () => {
  const at = (h: number) => new Date(2026, 10, 17, h).toISOString()
  const sub = (type: string, h: number): Event => ({ at: at(h), type, goal: 1, sub: 1, label: null, text: 'Draft' })
  const log: Event[] = [
    { at: new Date(2026, 10, 16).toISOString(), type: 'goal.add', goal: 1, label: null, text: 'Ship docs' },
    { at: new Date(2026, 10, 16).toISOString(), type: 'sub.add', goal: 1, sub: 1, label: null, text: 'Draft' },
    { at: new Date(2026, 10, 16).toISOString(), type: 'sub.add', goal: 1, sub: 2, label: null, text: 'Review' },
    sub('sub.done', 9), sub('sub.undone', 10), sub('sub.done', 11),
    { at: at(12), type: 'goal.done', goal: 1, label: null, text: 'Ship docs' },
    { at: at(13), type: 'goal.reopen', goal: 1, label: null, text: 'Ship docs' },
  ]
  const out = summarize(log, new Date(2026, 10, 17), new Date(2026, 10, 18), 'Tue 17 Nov', false)
  expect(out.match(/✓ Draft/g)?.length).toBe(1)
  expect(out).toContain('◑ Ship docs  1/2')
  expect(out).not.toContain('✓ Ship docs')
})

test('ad-hoc work shows under DONE unless it was grouped under a goal', () => {
  const log: Event[] = [
    ev(18, 9, 'adhoc.done', 0, 'Slack status sync', { sub: 1 }),
    ev(18, 10, 'adhoc.done', 0, 'rename', { sub: 2 }),
    ev(18, 10, 'adhoc.done', 0, 'typo test', { sub: 3 }),
    ev(18, 10, 'adhoc.undo', 0, 'typo test', { sub: 3 }),
    ev(18, 11, 'goal.add', 7, 'Northstar'),
    ev(18, 11, 'sub.add', 7, 'rename', { sub: 1 }),
    ev(18, 11, 'sub.done', 7, 'rename', { sub: 1 }),
    ev(18, 11, 'adhoc.group', 7, 'Northstar', { open: ['2'] }),
    ev(18, 11, 'goal.done', 7, 'Northstar'),
  ]
  const out = summarize(log, new Date(2026, 10, 18), new Date(2026, 10, 19), 'Wed 18 Nov', false)
  expect(out).toContain('· Slack status sync')
  expect(out).toContain('✓ Northstar')
  expect(out.match(/rename/g)).toHaveLength(1)
  expect(out).not.toContain('typo test')
})
