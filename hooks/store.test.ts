import { expect, test } from 'claude-code/testing'

import { emptyState } from './model'
import type { Event } from './model'
import { appendEvent, dataDir, loadState, migrate, readEvents, saveState } from './store'
import type { Io } from './store'

function memIo(store: Record<string, unknown> = {}) {
  store = { ...store }
  const files = new Map<string, string>()
  const io: Io = {
    home: async () => '/home/u',
    exists: async p => files.has(p) || [...files.keys()].some(k => k.startsWith(p + '/')),
    read: async p => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`)
      return files.get(p)!
    },
    write: async (p, t) => void files.set(p, t),
    list: async p => [...files.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(k => k.slice(p.length + 1)),
    storeGet: async k => store[k],
    storeSet: async (k, v) => void (store[k] = v),
  }
  return { io, files }
}

const ev = (at: string, text: string): Event => ({ at, type: 'goal.add', goal: 1, label: null, text })

test('data folder defaults to ~/.waypoint, keeps a pre-rename ~/.claude-goals, and expands ~', async () => {
  const { io, files } = memIo()
  expect(await dataDir(io, undefined)).toBe('/home/u/.waypoint')
  files.set('/home/u/.claude-goals/goals.json', '{}')
  expect(await dataDir(io, '~/.waypoint')).toBe('/home/u/.claude-goals')
  files.set('/home/u/.waypoint/goals.json', '{}')
  expect(await dataDir(io, '~/.waypoint')).toBe('/home/u/.waypoint')
  expect(await dataDir(io, '~/x/')).toBe('/home/u/x')
  expect(await dataDir(io, '/abs/goals')).toBe('/abs/goals')
})

test('state round-trips and a missing file is empty', async () => {
  const { io, files } = memIo()
  expect(await loadState(io, '/d')).toEqual(emptyState())
  const s = { ...emptyState(), nextId: 5 }
  await saveState(io, '/d', s)
  expect(files.has('/d/goals.json')).toBe(true)
  expect(await loadState(io, '/d')).toEqual(s)
})

test('events go to one file per month and come back in order', async () => {
  const { io, files } = memIo()
  await appendEvent(io, '/d', ev('2026-11-02T09:00:00+02:00', 'b'))
  await appendEvent(io, '/d', ev('2026-11-03T09:00:00+02:00', 'c'))
  await appendEvent(io, '/d', ev('2026-10-30T09:00:00+02:00', 'a'))
  expect(files.get('/d/log/2026-11.jsonl')!.trim().split('\n')).toHaveLength(2)
  expect((await readEvents(io, '/d', '2026-12-01')).map(e => e.text)).toEqual(['a', 'b', 'c'])
  expect((await readEvents(io, '/d', '2026-10-31')).map(e => e.text)).toEqual(['a'])
})

test('RF2: no log folder is empty, a corrupt line is skipped', async () => {
  const { io, files } = memIo()
  expect(await readEvents(io, '/d', '2026-12-01')).toEqual([])
  files.set('/d/log/2026-11.jsonl', JSON.stringify(ev('2026-11-02T09:00:00+02:00', 'ok')) + '\n{oops\n\n')
  expect((await readEvents(io, '/d', '2026-12-01')).map(e => e.text)).toEqual(['ok'])
})

test('migrates v1 goals and history once', async () => {
  const { io, files } = memIo({
    goals: [{ id: 1, text: 'A', progress: 40 }],
    history: { '2026-11-17': [{ id: 1, text: 'A', progress: 20 }] },
  })
  expect(await migrate(io, '/d', '2026-11-18T10:00:00+02:00')).toBe(true)
  const s = await loadState(io, '/d')
  expect(s.goals).toMatchObject([{ id: 1, text: 'A', progress: 40, label: null, subs: [] }])
  expect(s.nextId).toBe(2)
  const types = (await readEvents(io, '/d', '2026-12-01')).map(e => e.type)
  expect(types).toEqual(['goal.add', 'goal.progress', 'goal.progress', 'migrated'])
  expect(files.has('/d/goals.json')).toBe(true)
  expect(await migrate(io, '/d', '2026-11-18T10:00:00+02:00')).toBe(false)
})

test('final-review: migration closes finished and dropped v1 goals, and runs only once ever', async () => {
  const { io } = memIo({
    goals: [{ id: 1, text: 'A', progress: 100 }],
    history: { '2026-11-17': [{ id: 1, text: 'A', progress: 50 }, { id: 2, text: 'Gone', progress: 0 }] },
  })
  expect(await migrate(io, '/d', '2026-11-18T10:00:00+02:00')).toBe(true)
  const types = (await readEvents(io, '/d', '2026-12-01')).map(e => `${e.type}:${e.goal}`)
  expect(types).toContain('goal.done:1')
  expect(types).toContain('goal.remove:2')
  expect(await migrate(io, '/elsewhere', '2026-11-19T10:00:00+02:00')).toBe(false)
})
