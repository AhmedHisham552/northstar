import { TITLE_MAX, glyph, labelKey, progressOf, shownToday } from './model'
import type { Goal } from './model'
import type { View } from '../types'

type Shown = View & { state: NonNullable<View['state']> }

const amount = (g: Goal) => (g.subs.length ? `${g.subs.filter(s => s.done).length}/${g.subs.length}` : progressOf(g) ? `${progressOf(g)}%` : '')

export function focused(v: Shown): Goal | undefined {
  const id = v.state.focus[v.label] ?? v.state.focus.general
  return v.state.goals.find(g => g.id === id && !g.doneAt)
}

// Dim text after the hint line under the prompt.
export function hintTail(v: Shown): string {
  const g = focused(v)
  return g ? `◎ Now ${glyph(progressOf(g))} #${g.id} ${g.text}${amount(g) ? ` ${amount(g)}` : ''}` : ''
}

export const titlePrompt = (text: string) =>
  'Rewrite this goal as a short title in plain words: start with a verb, at most 7 words and ' +
  `${TITLE_MAX - 10} characters. Keep names, ticket ids and numbers exactly. Reply with the title only.\n\nGoal:\n${text}`

// The model's title, or the first sentence cut to fit when the model fails or rambles.
export function shortTitle(answer: string | null, text: string): string {
  const t = (answer ?? '').split('\n')[0]!.trim().replace(/^["'“]+|["'”.]+$/g, '').trim()
  if (t && t.length <= TITLE_MAX) return t
  const first = text.split(/(?<=[.!?])\s/)[0]!.trim()
  return first.length <= TITLE_MAX ? first : `${first.slice(0, TITLE_MAX - 1).trimEnd()}…`
}

const cut = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`)

// Added to Claude's instructions each turn so it can keep the tracker current.
export function goalsBrief(v: Shown): string {
  const now = focused(v)
  const open = v.state.goals.filter(g => !g.doneAt)
  const lines = open.flatMap(g => [
    `#${g.id} ${g.text} [${labelKey(g.label)}]${g === now ? ' (NOW)' : ''}${amount(g) ? ` ${amount(g)}` : ''}`,
    ...(g.detail ? [`  details: ${g === now ? g.detail : cut(g.detail, 200)}`] : []),
    ...g.subs.map(s => `  ${g.id}.${s.id} [${s.done ? 'x' : ' '}] ${s.text}`),
  ])
  const t = shownToday(v.state, v.today)
  const adhoc = t?.items.filter(i => i.id !== undefined) ?? []
  return [
    "The user's goals (Waypoint plugin). This session's repo label is " + `"${v.label}".`,
    ...(lines.length ? lines : ['(no open goals)']),
    ...(adhoc.length ? ['', 'Ad-hoc work logged today (id, text):', ...adhoc.map(i => `  ${i.id} ${i.text}`)] : []),
    ...(t?.suggest ? [`Grouping card waiting in the pane: "${t.suggest.title}" (${t.suggest.ids.join(', ')})`] : []),
    '',
    'Keep this tracker current with the update_goals tool, without asking:',
    '- When the user prompts about work that clearly belongs to a different open goal than NOW, call update_goals with "focus <n>" first.',
    '- When you begin a listed sub-task, call "start <n>.<m>" (it spins in the pane); "start <n>" for a goal without sub-tasks.',
    '- When your work finishes a listed sub-task, call "tick <n>.<m>"; when it finishes a goal without sub-tasks, call "done <n>".',
    '- When you stop working on a started item without finishing it, call "stop <n>" or "stop <n>.<m>".',
    '- When you finish a distinct piece of work that is not a listed goal or sub-task, log it with "did <short past-tense line>" without asking. One line per piece of work; skip quick questions and lookups.',
    '- When 3 or more ad-hoc items logged today share one topic, call "group <short title>: <ids>" once. It shows a card in the pane; do not mention it in your reply, and never repeat a grouping that was dismissed.',
    '- Never add goals on your own; add one only when the user asks.',
  ].join('\n')
}

export type Dispatch = 'agents' | 'workflow'

export function workPrompt(items: { goal: Goal; subs?: number[] }[], dispatch: Dispatch): string {
  const list = items.flatMap(({ goal: g, subs }) => [
    `#${g.id} ${g.text}${subs ? ' (only these sub-tasks)' : ''}`,
    ...(g.detail ? [`  details (as I wrote it): ${g.detail}`] : []),
    ...g.subs.filter(s => !subs || subs.includes(s.id)).map(s => `  ${g.id}.${s.id} ${s.done ? '(done) ' : ''}${s.text}`),
  ])
  const runner =
    dispatch === 'workflow'
      ? `run one workflow per goal with the Workflow tool (I opted into workflows by running /waypoint:work in workflow mode). Give each a self-contained brief (goal, its sub-tasks, my answers, constraints). Its agents call update_goals "start <n>.<m>" when they begin a sub-task and tick it ("tick <n>.<m> \\"short note\\"") as they finish them, do not guess on open questions, and the workflow returns the exact question instead of continuing when blocked.`
      : `start one background agent per goal with a self-contained brief (goal, its sub-tasks, my answers, constraints). Each agent calls update_goals "start <n>.<m>" when it begins a sub-task and ticks it ("tick <n>.<m> \\"short note\\"") as it finishes them, does not guess on open questions, and if blocked returns the exact question instead of continuing.`
  return [
    `Orchestrate work on my goal${items.length > 1 ? 's' : ''}:\n${list.join('\n')}`,
    'Phase 1, align (here, with me): for each goal, gather what you can from the code, docs and tools first. ' +
      'Goals without sub-tasks get 3-6 concrete ones via update_goals ("sub <n> A; B; C"). ' +
      'Where only some sub-tasks are listed, work on those alone. ' +
      'Then ask me, in one message, every question you need answered to finish without me. Wait for my answers and confirmation.',
    `Phase 2, dispatch: once I confirm, ${runner}`,
    'Phase 3, report: as each one finishes, give me its result in a few lines and ask me any question it raised. Re-dispatch with my answer when needed.',
  ].join('\n\n')
}
