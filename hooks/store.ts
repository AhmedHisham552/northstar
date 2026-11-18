import type { Hook } from 'claude-code'

import { emptyState } from './model'
import type { Event, Goal, State } from './model'

export type Engine = Parameters<Hook<'session.start'>>[0]

// The IO the store needs: register.tsx builds it from $, tests from a Map.
export type Io = {
  home: () => Promise<string | undefined>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<string[]>
  storeGet: (key: string) => Promise<unknown>
}

export function engineIo($: Engine): Io {
  return {
    home: () => $.env.get('HOME'),
    exists: path => $.fs.exists(path),
    read: async path => (await $.fs.read(path)) as string,
    write: (path, text) => $.fs.write(path, text),
    list: async path => (await $.fs.list(path)).map(f => f.name),
    storeGet: key => $.store.get(key),
  }
}

export async function dataDir(io: Io, configured: string | undefined): Promise<string> {
  const raw = (configured?.trim() || '~/.claude-goals').replace(/\/+$/, '')
  return raw.startsWith('~') ? `${(await io.home()) ?? ''}${raw.slice(1)}` : raw
}

export async function loadState(io: Io, dir: string): Promise<State> {
  const path = `${dir}/goals.json`
  return (await io.exists(path)) ? (JSON.parse(await io.read(path)) as State) : emptyState()
}

export async function saveState(io: Io, dir: string, s: State): Promise<void> {
  await io.write(`${dir}/goals.json`, JSON.stringify(s, null, 2) + '\n')
}

// $.fs has no append: read the month's file, add the line, write it back.
// ponytail: two sessions writing in the same moment can drop one event; a lock file if that ever bites.
export async function appendEvent(io: Io, dir: string, e: Event): Promise<void> {
  const path = `${dir}/log/${e.at.slice(0, 7)}.jsonl`
  const old = (await io.exists(path)) ? (await io.read(path)) : ''
  await io.write(path, old + JSON.stringify(e) + '\n')
}

// Every event up to the end of `to` (YYYY-MM-DD or ISO), oldest first; unreadable lines are skipped.
export async function readEvents(io: Io, dir: string, to: string): Promise<Event[]> {
  const logDir = `${dir}/log`
  if (!(await io.exists(logDir))) return []
  const months = (await io.list(logDir))
    .filter(n => /^\d{4}-\d{2}\.jsonl$/.test(n) && n.slice(0, 7) <= to.slice(0, 7))
    .sort()
  const events: Event[] = []
  for (const name of months) {
    for (const line of (await io.read(`${logDir}/${name}`)).split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as Event)
      } catch {
        // skip a corrupt line rather than lose the whole summary
      }
    }
  }
  const end = to.length === 10 ? `${to}T23:59:59.999` : to
  return events.filter(e => e.at <= end || e.at.slice(0, 10) <= to.slice(0, 10)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

type V1Goal = { id: number; text: string; progress: number }

// One-time import of v1 data kept in the plugin's $.store; the store itself is left as is.
export async function migrate(io: Io, dir: string, now: string): Promise<boolean> {
  if (await io.exists(`${dir}/goals.json`)) return false
  const goals = (await io.storeGet('goals')) as V1Goal[] | undefined
  if (!goals?.length) return false
  const history = ((await io.storeGet('history')) as Record<string, V1Goal[]> | undefined) ?? {}
  const days = Object.keys(history).sort()
  const start = days[0] ? `${days[0]}T00:00:00` : now
  const events: Event[] = []
  const last = new Map<number, number>()
  const state: State = { ...emptyState(), nextId: Math.max(0, ...goals.map(g => g.id)) + 1 }
  const seen = new Set<number>()
  const add = (g: V1Goal, at: string) => {
    if (seen.has(g.id)) return
    seen.add(g.id)
    events.push({ at, type: 'goal.add', goal: g.id, label: null, text: g.text })
    last.set(g.id, 0)
  }
  const move = (g: V1Goal, at: string) => {
    const from = last.get(g.id) ?? 0
    if (from === g.progress) return
    events.push({ at, type: 'goal.progress', goal: g.id, label: null, text: g.text, from, to: g.progress })
    last.set(g.id, g.progress)
  }
  for (const g of goals) add(g, start)
  for (const day of days) for (const g of history[day] ?? []) (add(g, start), move(g, `${day}T23:59:00`))
  for (const g of goals) {
    move(g, now)
    const goal: Goal = { id: g.id, text: g.text, label: null, progress: g.progress, createdAt: start, doneAt: g.progress >= 100 ? now : null, nextSub: 1, subs: [] }
    state.goals.push(goal)
  }
  events.push({ at: now, type: 'migrated', goal: 0, label: null, text: `${goals.length} goals from v1` })
  await saveState(io, dir, state)
  for (const e of events) await appendEvent(io, dir, e)
  return true
}
