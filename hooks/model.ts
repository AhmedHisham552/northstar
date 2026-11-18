import type { Goal, State, Sub } from '../types'

export type { Goal, State, Sub }
export type Event = {
  at: string
  type: string
  goal: number
  sub?: number
  label: string | null
  text: string
  from?: number
  to?: number
  note?: string
  open?: string[]
}
export type Op =
  | { kind: 'add'; texts: string[]; label: string | null }
  | { kind: 'sub'; goal: number; texts: string[] }
  | { kind: 'tick'; goal: number; sub: number; note?: string; done?: boolean }
  | { kind: 'progress'; goal: number; value: number; note?: string }
  | { kind: 'done'; goal: number; note?: string }
  | { kind: 'rm'; goal: number; sub?: number }
  | { kind: 'focus'; goal: number | null; label: string | null }
  | { kind: 'tag'; goal: number; label: string | null }
  | { kind: 'start'; goal: number; sub?: number }
  | { kind: 'stop'; goal?: number; sub?: number }

type Result = { state: State; events: Event[] } | { error: string }

export const emptyState = (): State => ({ version: 2, nextId: 1, focus: {}, goals: [] })

export const labelKey = (label: string | null) => label ?? 'general'

export function progressOf(g: Goal): number {
  if (g.doneAt) return 100
  if (g.subs.length) return Math.round((g.subs.filter(s => s.done).length / g.subs.length) * 100)
  return g.progress ?? 0
}

export function glyph(p: number): string {
  if (p >= 100) return '✓'
  if (p >= 63) return '◕'
  if (p >= 38) return '◑'
  if (p >= 1) return '◔'
  return '○'
}

export const visibleGoals = (s: State, today: string) => s.goals.filter(g => !g.doneAt || g.doneAt.slice(0, 10) >= today)

const STALE_MS = 8 * 60 * 60 * 1000

// In progress, unless the mark is older than 8 hours (work that was never closed).
export function isActive(s: State, key: string, nowMs: number): boolean {
  const since = s.active?.[key]
  return !!since && nowMs - Date.parse(since) < STALE_MS
}

function unmark(s: State, key: string) {
  if (!s.active) return
  for (const k of Object.keys(s.active)) if (k === key || k.startsWith(`${key}.`)) delete s.active[k]
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

export function applyOp(input: State, op: Op, at: string): Result {
  const s: State = structuredClone(input)
  const events: Event[] = []
  const log = (g: Goal, type: string, extra: Partial<Event> = {}) =>
    events.push({ at, type, goal: g.id, label: g.label, text: g.text, ...extra })

  if (op.kind === 'add') {
    for (const text of op.texts) {
      const g: Goal = { id: s.nextId++, text, label: op.label, progress: null, createdAt: at, doneAt: null, nextSub: 1, subs: [] }
      s.goals.push(g)
      log(g, 'goal.add')
    }
    return { state: s, events }
  }

  if (op.kind === 'stop' && op.goal === undefined) {
    s.active = {}
    return { state: s, events }
  }

  if (op.kind === 'focus' && op.goal === null) {
    delete s.focus[labelKey(op.label)]
    return { state: s, events }
  }

  const g = s.goals.find(x => x.id === op.goal)
  if (!g) return { error: `no goal #${op.goal}` }

  const finish = (note?: string) => {
    g.doneAt = at
    unmark(s, String(g.id))
    const open = g.subs.filter(x => !x.done).map(x => x.text)
    log(g, 'goal.done', { ...(note ? { note } : {}), ...(open.length ? { open } : {}) })
  }
  const reopen = () => {
    g.doneAt = null
    log(g, 'goal.reopen')
  }

  switch (op.kind) {
    case 'sub':
      for (const text of op.texts) {
        const sub = { id: g.nextSub++, text, done: false }
        g.subs.push(sub)
        log(g, 'sub.add', { sub: sub.id, text })
      }
      if (g.doneAt) reopen()
      break
    case 'tick': {
      const sub = g.subs.find(x => x.id === op.sub)
      if (!sub) return { error: `no sub-task ${g.id}.${op.sub}` }
      // The pane sends the state it showed, so a stale pane can't undo another session's tick.
      if (op.done !== undefined && op.done === sub.done) return { state: s, events }
      sub.done = !sub.done
      if (sub.done) unmark(s, `${g.id}.${sub.id}`)
      log(g, sub.done ? 'sub.done' : 'sub.undone', { sub: sub.id, text: sub.text, ...(op.note ? { note: op.note } : {}) })
      if (sub.done && !g.doneAt && g.subs.every(x => x.done)) finish()
      if (!sub.done && g.doneAt) reopen()
      break
    }
    case 'progress': {
      if (g.subs.length) return { error: `goal ${g.id} has sub-tasks; tick them instead` }
      const from = progressOf(g)
      g.progress = clamp(op.value)
      if (g.progress < 100 && g.doneAt) reopen()
      log(g, 'goal.progress', { from, to: g.progress, ...(op.note ? { note: op.note } : {}) })
      if (g.progress === 100 && !g.doneAt) finish()
      break
    }
    case 'done':
      if (!g.doneAt) finish(op.note)
      break
    case 'rm':
      if (op.sub === undefined) {
        s.goals = s.goals.filter(x => x.id !== g.id)
        unmark(s, String(g.id))
        for (const k of Object.keys(s.focus)) if (s.focus[k] === g.id) delete s.focus[k]
        log(g, 'goal.remove')
      } else {
        const sub = g.subs.find(x => x.id === op.sub)
        if (!sub) return { error: `no sub-task ${g.id}.${op.sub}` }
        g.subs = g.subs.filter(x => x !== sub)
        unmark(s, `${g.id}.${sub.id}`)
        log(g, 'sub.remove', { sub: sub.id, text: sub.text })
      }
      break
    case 'focus':
      if (s.focus[labelKey(g.label)] === g.id) break // already NOW: nothing to log
      s.focus[labelKey(g.label)] = g.id
      log(g, 'goal.focus')
      break
    case 'start':
    case 'stop': {
      if (op.sub !== undefined && !g.subs.some(x => x.id === op.sub)) return { error: `no sub-task ${g.id}.${op.sub}` }
      const key = op.sub === undefined ? String(g.id) : `${g.id}.${op.sub}`
      if (op.kind === 'stop') unmark(s, key)
      else if (!s.active?.[key]) s.active = { ...s.active, [key]: at }
      break
    }
    case 'tag': {
      const old = labelKey(g.label)
      if (s.focus[old] === g.id) delete s.focus[old]
      g.label = op.label
      log(g, 'goal.label')
      break
    }
  }
  return { state: s, events }
}
