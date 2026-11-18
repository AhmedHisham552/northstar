import { glyph, progressOf, visibleGoals } from './model'
import type { Goal, State, View } from '../types'

export type { View }
type Shown = View & { state: State }
// The surface's element table, as $.ui.resolve(e) returns it.
type Els = { Box: any; Text: any; Button: any }
type Act = { focus: (goal: number) => void; tick: (goal: number, sub: number) => void }

export const fit = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

const amount = (g: Goal) => (g.subs.length ? `${g.subs.filter(s => s.done).length}/${g.subs.length}` : g.doneAt ? '' : `${progressOf(g)}%`)
const row = (left: string, right: string, width: number) => (right ? `${fit(left, width - right.length - 1).padEnd(width - right.length)}${right}` : fit(left, width))

export function focusedGoal(v: Shown): Goal | undefined {
  const id = v.state.focus[v.label] ?? v.state.focus.general
  return v.state.goals.find(g => g.id === id && !g.doneAt)
}

function goalRow(ui: Els, g: Goal, width: number, act: Act) {
  const line = row(`${glyph(progressOf(g))} #${g.id} ${g.text}`, amount(g), width)
  return g.doneAt ? (
    <ui.Text color="green" dimColor>{line}</ui.Text>
  ) : (
    <ui.Button key={`g${g.id}`} plain label={line} onPress={() => act.focus(g.id)} />
  )
}

export function paneTree(ui: Els, v: Shown, width: number, act: Act) {
  const { Box, Text, Button } = ui
  const goals = visibleGoals(v.state, v.today)
  if (!goals.length) return <Text dimColor>No goals yet. /goals add &lt;text&gt;</Text>
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
      {now && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>NOW</Text>
          <Text bold>{row(`${glyph(progressOf(now))} #${now.id} ${now.text}`, amount(now), width)}</Text>
          {now.subs.map(s => (
            <Button key={`s${now.id}.${s.id}`} plain dimColor={s.done} label={fit(`   ${s.done ? '✓' : '○'} ${now.id}.${s.id} ${s.text}`, width)} onPress={() => act.tick(now.id, s.id)} />
          ))}
        </Box>
      )}
      {groups.map(([name, list]) => (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold dimColor>{name}</Text>
          {list.map(g => goalRow(ui, g, width, act))}
        </Box>
      ))}
      {[...folded].map(([label, n]) => (
        <Text dimColor>{fit(`+${n} in ${label}`, width)}</Text>
      ))}
    </Box>
  )
}

export function stripTree(ui: Els, v: Shown, width: number) {
  const g = focusedGoal(v)
  if (!g) return null
  const { Box, Text } = ui
  return (
    <Box>
      <Text bold>NOW </Text>
      <Text>{fit(`${glyph(progressOf(g))} #${g.id} ${g.text}  ${amount(g)}`, Math.max(10, width - 4))}</Text>
    </Box>
  )
}

