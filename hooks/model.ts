import type { DoneItem, Goal, State, Sub, Today } from '../types'

export type { DoneItem, Goal, State, Sub, Today }
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
  | { kind: 'add'; texts: string[]; label: string | null; details?: (string | undefined)[] }
  | { kind: 'sub'; goal: number; texts: string[] }
  | { kind: 'tick'; goal: number; sub: number; note?: string; done?: boolean }
  | { kind: 'progress'; goal: number; value: number; note?: string }
  | { kind: 'done'; goal: number; note?: string }
  | { kind: 'rm'; goal: number; sub?: number }
  | { kind: 'focus'; goal: number | null; label: string | null }
  | { kind: 'tag'; goal: number; label: string | null }
  | { kind: 'rename'; goal: number; sub?: number; text: string; detail?: string }
  | { kind: 'did'; text: string; label: string | null }
  | { kind: 'group'; title: string; ids: number[] }
  | { kind: 'accept' }
  | { kind: 'dismiss' }
  | { kind: 'start'; goal: number; sub?: number }
  | { kind: 'stop'; goal?: number; sub?: number }

type Result = { state: State; events: Event[] } | { error: string }

// Longer goal names get a short title, with the full text kept as the goal's detail.
export const TITLE_MAX = 60

export const emptyState = (): State => ({ version: 2, nextId: 1, focus: {}, goals: [] })

export const labelKey = (label: string | null) => label ?? 'general'
export const labelName = (s: State, label: string | null) => (label === null ? 'General' : s.names?.[label] ?? label)

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

// Today's list, started fresh on a new day.
export function todayOf(s: State, at: string): Today {
  const day = at.slice(0, 10)
  if (s.today?.day !== day) s.today = { day, items: [] }
  return s.today
}

export const shownToday = (s: State, today: string) => (s.today?.day === today ? s.today : undefined)
const groupKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',')

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
  // Labels match case-insensitively; the first casing typed is kept for display.
  if ((op.kind === 'add' || op.kind === 'tag') && op.label) {
    const key = op.label.toLowerCase()
    if (op.label !== key && !s.names?.[key]) s.names = { ...s.names, [key]: op.label }
    op = { ...op, label: key }
  }
  const events: Event[] = []
  const log = (g: Goal, type: string, extra: Partial<Event> = {}) =>
    events.push({ at, type, goal: g.id, label: g.label, text: g.text, ...extra })

  if (op.kind === 'add') {
    for (const [i, text] of op.texts.entries()) {
      const detail = op.details?.[i]
      const g: Goal = { id: s.nextId++, text, ...(detail ? { detail } : {}), label: op.label, progress: null, createdAt: at, doneAt: null, nextSub: 1, subs: [] }
      s.goals.push(g)
      log(g, 'goal.add')
    }
    return { state: s, events }
  }

  if (op.kind === 'did') {
    const id = s.nextLog ?? 1
    s.nextLog = id + 1
    todayOf(s, at).items.push({ id, text: op.text, label: op.label })
    events.push({ at, type: 'adhoc.done', goal: 0, sub: id, label: op.label, text: op.text })
    return { state: s, events }
  }

  if (op.kind === 'group') {
    const t = todayOf(s, at)
    const bad = op.ids.find(id => !t.items.some(i => i.id === id))
    if (bad !== undefined) return { error: `no ad-hoc item ${bad} today` }
    if (op.ids.length < 2) return { error: 'group needs at least 2 items' }
    if (t.dismissed?.includes(groupKey(op.ids))) return { error: 'that grouping was dismissed earlier' }
    t.suggest = { title: op.title, ids: op.ids }
    return { state: s, events }
  }

  if (op.kind === 'dismiss') {
    const t = todayOf(s, at)
    if (!t.suggest) return { error: 'nothing to dismiss' }
    t.dismissed = [...(t.dismissed ?? []), groupKey(t.suggest.ids)]
    delete t.suggest
    return { state: s, events }
  }

  // Accepting a grouping files the ad-hoc items as a finished goal's ticked sub-tasks; adding a sub-task reopens it.
  if (op.kind === 'accept') {
    const t = todayOf(s, at)
    if (!t.suggest) return { error: 'nothing to accept' }
    const items = t.suggest.ids.map(id => t.items.find(i => i.id === id)).filter((i): i is DoneItem => !!i)
    const subs = items.map((i, n) => ({ id: n + 1, text: i.text, done: true }))
    const g: Goal = { id: s.nextId++, text: t.suggest.title, label: items[0]?.label ?? null, progress: null, createdAt: at, doneAt: at, nextSub: subs.length + 1, subs }
    s.goals.push(g)
    log(g, 'goal.add')
    for (const x of subs) log(g, 'sub.add', { sub: x.id, text: x.text })
    for (const x of subs) log(g, 'sub.done', { sub: x.id, text: x.text })
    log(g, 'adhoc.group', { open: t.suggest.ids.map(String) })
    log(g, 'goal.done')
    t.items = [...t.items.filter(i => !t.suggest!.ids.includes(i.id ?? -1)), { ref: `#${g.id}`, text: g.text, label: g.label }]
    delete t.suggest
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

  const done = (ref: string, text: string) => todayOf(s, at).items.push({ ref, text, label: g.label })
  const undone = (ref: string) => {
    if (s.today) s.today.items = s.today.items.filter(i => i.ref !== ref)
  }
  const finish = (note?: string) => {
    g.doneAt = at
    done(`#${g.id}`, g.text)
    unmark(s, String(g.id))
    const open = g.subs.filter(x => !x.done).map(x => x.text)
    log(g, 'goal.done', { ...(note ? { note } : {}), ...(open.length ? { open } : {}) })
  }
  const reopen = () => {
    g.doneAt = null
    undone(`#${g.id}`)
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
      if (sub.done) done(`${g.id}.${sub.id}`, sub.text)
      else undone(`${g.id}.${sub.id}`)
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
    case 'focus': {
      // Now belongs to the session's label (passed in), so a goal from any label can be Now here.
      const key = op.label ?? labelKey(g.label)
      if (s.focus[key] === g.id) break // already NOW: nothing to log
      s.focus[key] = g.id
      log(g, 'goal.focus')
      break
    }
    case 'start':
    case 'stop': {
      if (op.sub !== undefined && !g.subs.some(x => x.id === op.sub)) return { error: `no sub-task ${g.id}.${op.sub}` }
      const key = op.sub === undefined ? String(g.id) : `${g.id}.${op.sub}`
      if (op.kind === 'stop') unmark(s, key)
      else if (!s.active?.[key]) s.active = { ...s.active, [key]: at }
      break
    }
    case 'rename': {
      if (op.sub === undefined) {
        g.text = op.text
        if (op.detail) g.detail = op.detail // a short new title keeps the old details
        log(g, 'goal.rename')
        break
      }
      const sub = g.subs.find(x => x.id === op.sub)
      if (!sub) return { error: `no sub-task ${g.id}.${op.sub}` }
      sub.text = op.text
      log(g, 'sub.rename', { sub: sub.id, text: sub.text })
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
