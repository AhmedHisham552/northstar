import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

type Engine = Parameters<Hook<'session.start'>>[0]

import type { Goal } from '../types'

const PANE = 'goals'
const TOOL = 'mcp__goals__update_goals'
const goals = atom({ plugin: 'goals', key: 'list' } as const, [] as Goal[], { shape: 'goals-1' })

const HELP = [
  '/goals add A; B; C   add goals ("add" optional)',
  '/goals <n> <0-100>   set progress of goal n',
  '/goals done <n>      mark goal n 100%',
  '/goals rm <n>        remove goal n',
  '/goals clear         remove all goals',
  '/goals history [d]   goals per day, last d days (default 7)',
  '/goals               open the pane',
].join('\n')

type Op = { action: 'add'; text: string } | { action: 'progress'; n: number; progress: number } | { action: 'remove'; n: number } | { action: 'clear' }
type Cmd = Op | { action: 'history'; days: number }

const clamp = (p: number) => Math.max(0, Math.min(100, Math.round(p)))

function apply(list: Goal[], op: Op): Goal[] {
  switch (op.action) {
    case 'add':
      return [...list, { id: Math.max(0, ...list.map(g => g.id)) + 1, text: op.text.trim(), progress: 0 }]
    case 'progress':
      return list.map((g, i) => (i + 1 === op.n ? { ...g, progress: clamp(op.progress) } : g))
    case 'remove':
      return list.filter((_, i) => i + 1 !== op.n)
    case 'clear':
      return []
  }
}

function parse(args: string): Cmd[] | string {
  const [cmd = '', ...rest] = args.trim().split(/\s+/)
  const n = Number(rest[0])
  if (cmd === 'done' && n) return [{ action: 'progress', n, progress: 100 }]
  if (cmd === 'rm' && n) return [{ action: 'remove', n }]
  if (cmd === 'clear') return [{ action: 'clear' }]
  if (cmd === 'history') return [{ action: 'history', days: n || 7 }]
  if (Number(cmd) && rest.length === 1 && !Number.isNaN(n)) return [{ action: 'progress', n: Number(cmd), progress: n }]
  // `add A; B; C` or bare text adds goals, split on `;`.
  const text = cmd === 'add' ? rest.join(' ') : args
  const adds = text.split(';').map(t => t.trim()).filter(Boolean)
  return adds.length ? adds.map(t => ({ action: 'add' as const, text: t })) : HELP
}

const bar = (p: number, w = 10) => '█'.repeat(Math.round((p / 100) * w)) + '░'.repeat(w - Math.round((p / 100) * w))

type History = Record<string, Goal[]>

async function today($: Engine) {
  const d = new Date(await $.clock.now())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// $.store is the source of truth (shared by every session); the atom mirrors it so the pane redraws.
// Re-reading the store first keeps a second open session from overwriting this one's goals.
async function change($: Engine, op: Op) {
  const saved = ((await $.store.get('goals')) as Goal[] | undefined) ?? []
  const list = apply(saved, op)
  await update($, goals, () => list)
  await $.store.set('goals', list)
  // ponytail: one snapshot per day (last state wins), no per-change log; add one if intra-day timing matters.
  const history = ((await $.store.get('history')) as History | undefined) ?? {}
  await $.store.set('history', { ...history, [await today($)]: list })
}

async function historyText($: Engine, days: number) {
  const history = ((await $.store.get('history')) as History | undefined) ?? {}
  const dates = Object.keys(history).sort().slice(-days).reverse()
  if (!dates.length) return 'No history yet.'
  return dates
    .map(date => {
      const list = history[date] ?? []
      const done = list.filter(g => g.progress >= 100).length
      return [`${date}  ${done}/${list.length} done`, ...list.map(g => `  ${bar(g.progress)} ${String(g.progress).padStart(3)}%  ${g.text}`)].join('\n')
    })
    .join('\n\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('goals')) as Goal[] | undefined
    if (saved) await update($, goals, () => saved)
    await $.command.register({ name: 'goals', description: 'Manage your goals pane: add, set progress, done, rm, clear' })
    await $.tool.register({
      name: 'update_goals',
      description:
        "Update the user's goals pane. Call it when work you did moves one of the user's listed goals forward (set progress 0-100), or when the user asks to add/remove a goal. Goals are numbered from 1 in the pane.",
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'progress', 'remove', 'list', 'history'] },
          n: { type: 'number', description: 'goal number (1-based) for progress/remove; days for history (default 7)' },
          progress: { type: 'number', description: '0-100 for progress' },
          text: { type: 'string', description: 'goal text for add' },
        },
        required: ['action'],
      },
    })
    void $.ui.open({ id: PANE, title: 'Goals' })
    return next(e)
  })

  on('command.run', { command: 'goals' }, async ($, e) => {
    const op = parse(e.args)
    await $.ui.open({ id: PANE, title: 'Goals' })
    if (typeof op === 'string') return { text: op }
    const first = op[0]!
    if (first.action === 'history') return { text: await historyText($, first.days) }
    for (const one of op) await change($, one as Op)
    return { text: first.action === 'add' ? `Added ${op.length} goal(s).` : 'Goals updated.' }
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    const input = (e as unknown as { input: { action: string; n?: number; progress?: number; text?: string } }).input
    if (input.action === 'history') return { result: await historyText($, input.n || 7) } as never
    if (input.action !== 'list') await change($, input as Op)
    const list = ((await $.store.get('goals')) as Goal[] | undefined) ?? []
    return { result: list.map((g, i) => `${i + 1}. [${g.progress}%] ${g.text}`).join('\n') || 'No goals.' } as never
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, goals)
    const done = list.filter(g => g.progress >= 100).length
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No goals. /goals add &lt;text&gt;</Text>}
        {list.length > 0 && <Text bold>{done}/{list.length} done</Text>}
        {list.map((g, i) => (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor={g.progress >= 100} strikethrough={g.progress >= 100}>
              {i + 1}. {g.text}
            </Text>
            <Text color={g.progress >= 100 ? 'green' : undefined}>
              {bar(g.progress)} {g.progress}%
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
