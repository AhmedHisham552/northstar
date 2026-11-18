import { focused } from './brief'
import { glyph, progressOf, visibleGoals } from './model'
import type { Goal, State, View } from '../types'

export type { View }
type Shown = View & { state: State }
// The surface's element table, as $.ui.resolve(e) returns it.
type Els = { Box: any; Text: any; Button: any }
type Act = { focus: (goal: number) => void; tick: (goal: number, sub: number, done: boolean) => void }

const ACCENT = 'claude'

export const fit = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

// Only show a count once there is something to count.
const amount = (g: Goal) => (g.subs.length ? `${g.subs.filter(s => s.done).length}/${g.subs.length}` : progressOf(g) && !g.doneAt ? `${progressOf(g)}%` : '')
const row = (left: string, right: string, width: number) => (right ? `${fit(left, width - right.length - 1).padEnd(width - right.length)}${right}` : fit(left, width))

export const focusedGoal = focused

function goalRow(ui: Els, g: Goal, width: number, act: Act) {
  const line = row(`${glyph(progressOf(g))} #${g.id} ${g.text}`, amount(g), width)
  return g.doneAt ? (
    <ui.Text color="success">{line}</ui.Text>
  ) : (
    <ui.Button key={`g${g.id}`} plain label={line} onPress={() => act.focus(g.id)} />
  )
}

export function paneTree(ui: Els, v: Shown, width: number, act: Act) {
  const { Box, Text, Button } = ui
  const goals = visibleGoals(v.state, v.today)
  const done = goals.filter(g => g.doneAt).length
  const count = `${done}/${goals.length}`
  const header = (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={ACCENT} bold>{row(`◎ Goals · ${v.label}`, count, width)}</Text>
      <Text color="subtle">{'─'.repeat(width)}</Text>
    </Box>
  )
  if (!goals.length)
    return (
      <Box flexDirection="column">
        {header}
        <Text color="subtle">No goals yet.</Text>
        <Text color="subtle">/goals add &lt;text&gt;</Text>
      </Box>
    )
  const now = focusedGoal(v)
  const rest = goals.filter(g => g !== now)
  const groups: [string, Goal[]][] = []
  const here = rest.filter(g => g.label === v.label)
  const general = rest.filter(g => g.label === null)
  if (here.length) groups.push([v.label.toUpperCase(), here])
  if (v.expanded && v.expanded !== v.label) groups.push([v.expanded.toUpperCase(), rest.filter(g => g.label === v.expanded)])
  if (general.length) groups.push(['GENERAL', general])
  const folded = new Map<string, number>()
  for (const g of rest) if (g.label !== null && g.label !== v.label && g.label !== v.expanded) folded.set(g.label, (folded.get(g.label) ?? 0) + 1)

  return (
    <Box flexDirection="column">
      {header}
      {now && (
        <Box flexDirection="column" marginBottom={1}>
          <Box justifyContent="space-between">
            <Text color={ACCENT} bold>NOW</Text>
            {amount(now) && <Text color={ACCENT}>{amount(now)}</Text>}
          </Box>
          <Text bold wrap="wrap">{`${glyph(progressOf(now))} #${now.id} ${now.text}`}</Text>
          {now.subs.map(s => (
            <Button key={`s${now.id}.${s.id}`} plain dimColor={s.done} label={fit(`  ${s.done ? '✓' : '○'} ${now.id}.${s.id} ${s.text}`, width)} onPress={() => act.tick(now.id, s.id, !s.done)} />
          ))}
        </Box>
      )}
      {groups.map(([name, list]) => (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="subtle">{name}</Text>
          {list.map(g => goalRow(ui, g, width, act))}
        </Box>
      ))}
      {[...folded].map(([label, n]) => (
        <Text color="subtle">{fit(`+${n} in ${label}`, width)}</Text>
      ))}
    </Box>
  )
}
