import { expect, test } from 'claude-code/testing'

import { applyOp, emptyState } from './model'
import type { Op, State } from './model'

const DAY = '2026-11-18'
const AT = `${DAY}T10:00:00+02:00`

function build(ops: Op[], at = AT): State {
  let s = emptyState()
  for (const op of ops) {
    const r = applyOp(s, op, at)
    if ('error' in r) throw new Error(r.error)
    s = r.state
  }
  return s
}

const LONG = 'A very long goal title that will never fit in a narrow side pane at all'
const state = build([
  { kind: 'add', texts: ['Card research', 'Demo prep'], label: 'shop' },
  { kind: 'add', texts: ['Write post'], label: null },
  { kind: 'add', texts: ['Other repo work'], label: 'other' },
  { kind: 'add', texts: [LONG], label: null },
  { kind: 'sub', goal: 1, texts: ['Read docs', 'Pricing call'] },
  { kind: 'tick', goal: 1, sub: 1 },
  { kind: 'focus', goal: 1, label: null },
])
const view = (s: State) => ({ value: { value: { state: s, label: 'shop', today: DAY, expanded: null }, version: 1 } })

const PANE = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'goals', surface, component: 'Pane', requestId: 'goals',
    props: { title: 'Goals', isFocused: false, bodyColumns: 32, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as const

type Found = { text?: string; label?: string; props?: { label?: string } }
const texts = async (ui: { find: (q: object) => Promise<Found | undefined> }, re: RegExp) => {
  const t = await ui.find({ type: 'Text', text: re })
  if (t) return t.text
  return undefined
}
const button = async (ui: { find: (q: object) => Promise<Found | undefined> }, key: string) => {
  const b = await ui.find({ type: 'Button', key })
  return b?.label ?? b?.props?.label ?? b?.text
}

test('pane shows NOW with sub-tasks, groups, folded labels and cuts long names', async ($, on) => {
  on('state.get', () => view(state))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await texts(ui, /^NOW$/)).toBe('NOW')
    expect(await texts(ui, /Goals/)).toBe('◎ Goals · shop')
    expect(await texts(ui, /^0\/5$/)).toBe('0/5')
    expect(await texts(ui, /#1 Card research/)).toBe('◑ #1 Card research')
    expect(await texts(ui, /^1\/2$/)).toBe('1/2')
    expect(await button(ui, 'g2')).toBe('○ #2 Demo prep')
    expect(await button(ui, 's1.1')).toContain('✓ 1.1 Read docs')
    expect(await texts(ui, /^SHOP$/)).toBe('SHOP')
    expect(await texts(ui, /^GENERAL$/)).toBe('GENERAL')
    expect(await button(ui, 'lother')).toMatch(/^▸ OTHER +1$/)
    const long = (await button(ui, 'g5'))!
    expect(long.length).toBeLessThanOrEqual(32)
    expect(long).toMatch(/…$/)
    await ui.unmount()
  }
})

test('goals finished on an earlier day leave the pane', async ($, on) => {
  const s = build([{ kind: 'add', texts: ['Old', 'Today'], label: null }])
  const old = applyOp(s, { kind: 'done', goal: 1 }, '2026-11-17T10:00:00+02:00')
  if ('error' in old) throw new Error(old.error)
  const both = applyOp(old.state, { kind: 'done', goal: 2 }, AT)
  if ('error' in both) throw new Error(both.error)
  on('state.get', () => view(both.state))
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await texts(ui, /Old/)).toBeUndefined()
  expect(await texts(ui, /#2 Today/)).toContain('✓')
  await ui.unmount()
})


test('commands write goals.json and the month log, summaries add a post', async ($, on) => {
  const files = new Map<string, string>()
  const prompts: string[] = []
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) || [...files.keys()].some(k => k.startsWith(e.path + '/')) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => (files.set(e.path, e.text), { value: undefined }))
  on('fs.list', (_, e) => ({ value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }))
  on('store.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/home/u/shop/.git\n', stderr: '' } }) as never)
  on('clock.now', () => ({ value: new Date(2026, 10, 18, 10).getTime() }))
  on('command.register', () => ({ value: { command: 'goals' } }))
  on('tool.register', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', (_, e) => (prompts.push(String(e.prompt)), { value: { isAnswered: true, text: 'Today I ticked Read docs.' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const submitted: string[] = []
  let lastContext: readonly string[] = []
  on('prompt.submit', (_, e) => (submitted.push(e.text), (lastContext = (e as { context?: readonly string[] }).context ?? []), { text: e.text }) as never)
  on('fs.stat', (_, e) => ({ value: { size: (files.get(e.path) ?? '').length, mtimeMs: (files.get(e.path) ?? '').length, kind: 'file', isLink: false } }) as never)
  on('clock.every', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/home/u/shop', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => ((await $.command.run({ command: 'goals', args } as never)) as unknown as { text: string }).text
  await run('add @here Card research; Demo prep')
  await run('sub 1 Read docs; Pricing call')
  await run('tick 1.1 "quick win"')
  expect(await run('tick 9.9')).toBe('no goal #9')
  expect(await run('')).toContain('/goals:work <n|n.m>')

  // Another session ticks 1.2: the next prompt here carries the fresh state.
  const other = JSON.parse(files.get('/home/u/.claude-goals/goals.json')!)
  other.goals[0].subs[1].done = true
  files.set('/home/u/.claude-goals/goals.json', JSON.stringify(other))
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } } as never)
  expect(lastContext.join('\n')).toContain('1.2 [x] Pricing call')
  expect(await run('work [1]')).toBe('Run /goals:work 1 to start working on #1.')
  expect(await run('work 1.2 workflow')).toBe('Run /goals:work 1.2 workflow to start working on #1.2.')
  expect(submitted).toEqual(['next'])
  const viaTool = (await $.tool.call({ tool: 'mcp__goals__update_goals', command: 'work 1' } as never)) as unknown as { result?: string; text?: string }
  expect(String(viaTool.result ?? viaTool.text)).toMatch(/^Orchestrate work on my goal:\n#1 Card research/)
  const subOnly = (await $.tool.call({ tool: 'mcp__goals__update_goals', command: 'work 1.9' } as never)) as unknown as { result?: string }
  expect(subOnly.result).toBe('no sub-task 1.9')
  await run('focus 1')

  const saved = JSON.parse(files.get('/home/u/.claude-goals/goals.json')!)
  expect(saved.focus).toEqual({ shop: 1 })
  expect(saved.goals[0]).toMatchObject({ id: 1, label: 'shop', subs: [{ done: true }, { done: true }] }) // 1.2 was ticked by the other session
  const log = files.get('/home/u/.claude-goals/log/2026-11.jsonl')!.trim().split('\n').map(l => JSON.parse(l).type)
  expect(log).toEqual(['goal.add', 'goal.add', 'sub.add', 'sub.add', 'sub.done', 'goal.focus'])
  await run('add Tmp A; Tmp B')
  expect(await run('rm [3, 4]')).toBe('goal remove: #3 Tmp A\ngoal remove: #4 Tmp B')
  expect(await run('rm 3')).toBe('no goal #3')

  const today = await run('today')
  expect(today).toContain('DONE        ✓ Read docs (Card research)')
  expect(today).toContain('quick win')
  expect(today).toContain('POST\nToday I ticked Read docs.')
  expect(prompts[0]).toContain('Read docs')
  expect(await run('yesterday')).toBe('Nothing logged for Tue 17 Nov.')
  expect(prompts).toHaveLength(1)

  // final-review: focus off clears the focus NOW actually shows (General when the repo has none)
  await run('focus off')
  await run('add Write post')
  await run('focus 3')
  await run('focus off')
  expect(JSON.parse(files.get('/home/u/.claude-goals/goals.json')!).focus).toEqual({})
})

test('Claude gets the goals with each prompt, and the hint line gets the NOW tail', async ($, on) => {
  on('state.get', () => view(state))
  let context: readonly string[] = []
  let seen: string | undefined
  on('prompt.submit', (_, e) => ((context = (e as { context?: readonly string[] }).context ?? []), { text: e.text }) as never)
  on('ui.render', ($, e) => {
    seen = (e as { props: { tail?: string } }).props.tail
    const { Text } = $.ui.resolve(e)
    return <Text>hint</Text>
  })
  await $.prompt.submit({ text: 'look at the card pricing', wait: false, origin: { kind: 'composer' } } as never)
  expect(context.join('\n')).toContain('#1 Card research [shop] (NOW)')

  const ui = await $.ui.mount({ plugin: 'goals', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts', modes: [] } } as never)
  expect(seen).toBe('· NOW ◑ #1 Card research 1/2')
  await ui.unmount()
})

test('another label opens and closes from its header', async ($, on) => {
  on('state.get', () => ({ value: { value: { state, label: 'shop', today: DAY, expanded: 'other' }, version: 1 } }))
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await button(ui, 'lother')).toBe('▾ OTHER')
  expect(await button(ui, 'g4')).toBe('○ #4 Other repo work')
  await ui.unmount()
})

test('work in progress spins in the pane', async ($, on) => {
  const r = applyOp(state, { kind: 'start', goal: 1, sub: 2 }, AT)
  const r2 = 'error' in r ? r : applyOp(r.state, { kind: 'start', goal: 2 }, AT)
  if ('error' in r2) throw new Error(r2.error)
  on('state.get', (_, e) => ((e as { key: string }).key === 'frame' ? { value: { value: 3, version: 1 } } : view(r2.state)) as never)
  on('clock.now', () => ({ value: Date.parse(AT) + 60_000 }) as never)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await button(ui, 's1.2')).toContain('⠸ 1.2 Pricing call')
  expect(await button(ui, 'g2')).toMatch(/^⠸ #2 Demo prep/)
  expect(await button(ui, 's1.1')).toContain('✓ 1.1')
  await ui.unmount()
})

test('a summary draws framed with accent keys and a post', async ($, on) => {
  const out = (text: string) => ({ plugin: 'goals', surface: 'terminal', component: 'CommandOutput', props: { command: 'goals', args: 'yesterday', text, isErrored: false } }) as never
  const text = 'Tue 17 Nov\nPLANNED     2 goals open\nDONE        ✓ Draft (Ship docs)\n                sandbox next week\n\nPOST\nDrafted the docs.'
  const ui = await $.ui.mount(out(text))
  expect(await texts(ui, /^PLANNED/)).toBe('PLANNED     2 goals open')
  expect(await texts(ui, /^POST$/)).toBe('POST')
  expect(await texts(ui, /^Drafted the docs\.$/)).toBe('Drafted the docs.')
  await ui.unmount()
})
