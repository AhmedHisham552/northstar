import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'goals',
  component: 'Pane',
  requestId: 'goals',
  props: { title: 'Goals', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('add a goal and set its progress, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'goals' } }))
  on('tool.register', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }) as never)
  on('clock.now', () => ({ value: new Date(2026, 10, 18, 12).getTime() }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'goals', args: 'add Draft the onboarding guide' } as never)
  await $.command.run({ command: 'goals', args: '1 40' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Draft the/ }))?.text).toBe('1. Draft the onboarding guide')
    expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('████░░░░░░ 40%')
    await ui.unmount()
  }
  expect(store.get('goals')).toEqual([{ id: 1, text: 'Draft the onboarding guide', progress: 40 }])
})

test('several goals in one command', async ($, on) => {
  on('command.register', () => ({ value: { command: 'goals' } }))
  on('tool.register', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }) as never)
  on('clock.now', () => ({ value: new Date(2026, 10, 18, 12).getTime() }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'goals', args: 'add A; B' } as never)
  await $.command.run({ command: 'goals', args: 'C' } as never)
  expect((store.get('goals') as { text: string }[]).map(g => g.text)).toEqual(['A', 'B', 'C'])
})

test('history keeps one snapshot per day', async ($, on) => {
  on('command.register', () => ({ value: { command: 'goals' } }))
  on('tool.register', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const store = new Map<string, unknown>([['history', { '2026-11-17': [{ id: 1, text: 'A', progress: 10 }] }]])
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }) as never)
  on('clock.now', () => ({ value: new Date(2026, 10, 18, 12).getTime() }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'goals', args: 'add A' } as never)
  await $.command.run({ command: 'goals', args: '1 60' } as never)
  const out = (await $.command.run({ command: 'goals', args: 'history' } as never)) as unknown as { text: string }
  expect(out.text).toBe(
    ['2026-11-18  0/1 done', '  ██████░░░░  60%  A', '', '2026-11-17  0/1 done', '  █░░░░░░░░░  10%  A'].join('\n'),
  )
})
