import { focused } from './brief'
import { glyph, labelName, progressOf, visibleGoals } from './model'
import type { Goal, State, View } from '../types'

export type { View }
type Shown = View & { state: State }
// The surface's element table, as $.ui.resolve(e) returns it.
type Els = { Box: any; Text: any; Button: any }
type Act = { focus: (goal: number) => void; tick: (goal: number, sub: number, done: boolean) => void; toggle: (label: string) => void; spin: (key: string) => string | null }

const ACCENT = 'claude'

export const fit = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

// Only show a count once there is something to count.
const amount = (g: Goal) => (g.subs.length ? `${g.subs.filter(s => s.done).length}/${g.subs.length}` : progressOf(g) && !g.doneAt ? `${progressOf(g)}%` : '')

export const focusedGoal = focused

// A spinner frame replaces the glyph while the goal is being worked on.
const goalMark = (g: Goal, act: Act) => (g.doneAt ? glyph(100) : act.spin(String(g.id)) ?? glyph(progressOf(g)))

// One row in parts: glyph in the accent (green once done), number dim, text, count dim and flush right.
type Parts = { mark: string; num: string; text: string; right: string; done: boolean; busy: boolean; indent?: string }
function parts(ui: Els, p: Parts, width: number) {
  const { Text } = ui
  const head = `${p.indent ?? ''}${p.mark} ${p.num} `
  const room = Math.max(1, width - head.length - (p.right ? p.right.length + 1 : 0))
  const body = p.right ? fit(p.text, room).padEnd(room + 1) : fit(p.text, room)
  return [
    p.indent ?? '',
    <Text color={p.done ? 'success' : ACCENT}>{p.mark}</Text>,
    ' ',
    <Text color="subtle">{p.num}</Text>,
    ' ',
    <Text dimColor={p.done} bold={p.busy}>{body}</Text>,
    ...(p.right ? [<Text color="subtle">{p.right}</Text>] : []),
  ]
}

// Sub-tasks under a goal, each one a click to tick or untick.
function subRows(ui: Els, g: Goal, width: number, act: Act) {
  return g.subs.map(s => {
    const spin = s.done ? null : act.spin(`${g.id}.${s.id}`)
    return (
      <ui.Button key={`s${g.id}.${s.id}`} plain onPress={() => act.tick(g.id, s.id, !s.done)}>
        {parts(ui, { indent: '  ', mark: s.done ? '✓' : spin ?? '○', num: `${g.id}.${s.id}`, text: s.text, right: '', done: s.done, busy: !!spin }, width)}
      </ui.Button>
    )
  })
}

function goalRow(ui: Els, g: Goal, width: number, act: Act) {
  const mark = goalMark(g, act)
  const row = parts(ui, { mark, num: `#${g.id}`, text: g.text, right: amount(g), done: !!g.doneAt, busy: !g.doneAt && mark !== glyph(progressOf(g)) }, width)
  const head = g.doneAt ? <ui.Text>{row}</ui.Text> : <ui.Button key={`g${g.id}`} plain onPress={() => act.focus(g.id)}>{row}</ui.Button>
  return g.doneAt || !g.subs.length ? head : <ui.Box flexDirection="column">{head}{subRows(ui, g, width, act)}</ui.Box>
}

export function paneTree(ui: Els, v: Shown, width: number, act: Act) {
  const { Box, Text, Button } = ui
  const goals = visibleGoals(v.state, v.today)
  const done = goals.filter(g => g.doneAt).length
  const count = `${done}/${goals.length}`
  const header = (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color={ACCENT} bold>◎ Waypoint · Goals</Text>
        <Text color="subtle">{count}</Text>
      </Box>
      <Text color="subtle">{'─'.repeat(width)}</Text>
    </Box>
  )
  if (!goals.length)
    return (
      <Box flexDirection="column">
        {header}
        <Text color="subtle">No goals yet.</Text>
        <Text color="subtle">/track add &lt;text&gt;</Text>
      </Box>
    )
  const now = focusedGoal(v)
  const rest = goals.filter(g => g !== now)
  const groups: [string, Goal[]][] = []
  const here = rest.filter(g => g.label === v.label)
  const general = rest.filter(g => g.label === null)
  if (here.length) groups.push([labelName(v.state, v.label), here])
  if (general.length) groups.push(['General', general])
  // Other repos' labels: open by default, each header collapses and reopens it.
  const others = new Map<string, Goal[]>()
  for (const g of rest) if (g.label !== null && g.label !== v.label) others.set(g.label, [...(others.get(g.label) ?? []), g])

  return (
    <Box flexDirection="column">
      {header}
      {now && (
        <Box flexDirection="column" marginBottom={1}>
          <Box justifyContent="space-between">
            <Text color={ACCENT} bold>Now</Text>
            {amount(now) && <Text color="subtle">{amount(now)}</Text>}
          </Box>
          <Text bold wrap="wrap">
            <Text color={now.doneAt ? 'success' : ACCENT}>{goalMark(now, act)}</Text> <Text color="subtle">{`#${now.id}`}</Text> {now.text}
          </Text>
          {now.detail && <Text dimColor wrap="wrap">{fit(now.detail, width * 4)}</Text>}
          {subRows(ui, now, width, act)}
        </Box>
      )}
      {groups.map(([name, list]) => (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={ACCENT} bold>{name}</Text>
          {list.map(g => goalRow(ui, g, width, act))}
        </Box>
      ))}
      {[...others].map(([label, list]) =>
        !(v.collapsed ?? []).includes(label) ? (
          <Box flexDirection="column" marginBottom={1}>
            <Button key={`l${label}`} plain onPress={() => act.toggle(label)}>
              <Text color={ACCENT}>{`▾ ${labelName(v.state, label)}`}</Text>
            </Button>
            {list.map(g => goalRow(ui, g, width, act))}
          </Box>
        ) : (
          <Button key={`l${label}`} plain onPress={() => act.toggle(label)}>
            <Text color={ACCENT}>{fit(`▸ ${labelName(v.state, label)}`, width - String(list.length).length - 1).padEnd(width - String(list.length).length)}</Text>
            <Text color="subtle">{String(list.length)}</Text>
          </Button>
        ),
      )}
    </Box>
  )
}

const KEYS = /^(PLANNED|DONE|MOVED|STILL OPEN)?\s*$/

// The summary as the film draws it: the log framed with accent section keys, the post framed in the accent.
export function summaryTree(ui: Els, text: string) {
  const { Box, Text } = ui
  const [log = '', post = ''] = text.split('\n\nPOST\n')
  // The engine prefixes the plugin's name; notes stay in the text Claude reads and are left off screen.
  const [title = '', ...lines] = log.split('\n')
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        <Text bold>{title.replace(/^[\w-]+: /, '')}</Text>
        {lines.filter(l => !l.startsWith(' '.repeat(16))).map(l => {
          if (!l.trim()) return <Text> </Text>
          const key = l.slice(0, 12)
          if (l.length > 12 && KEYS.test(key)) {
            const v = l.slice(12)
            const tick = v.match(/^(\s*)✓(.*)$/)
            return (
              <Text wrap="truncate-end">
                <Text color={ACCENT} bold>{key}</Text>
                {tick ? [tick[1], <Text color="success">✓</Text>, <Text dimColor={!!tick[1]}>{tick[2]}</Text>] : v}
              </Text>
            )
          }
          return <Text color="subtle" bold>{l}</Text>
        })}
      </Box>
      {post && (
        <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
          <Text color={ACCENT} bold>POST</Text>
          <Text>{post}</Text>
        </Box>
      )}
    </Box>
  )
}
