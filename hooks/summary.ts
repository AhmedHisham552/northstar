import { glyph, labelKey } from './model'
import type { Event } from './model'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export const fmtDay = (d: Date) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Local time with its offset, so the date part is the user's own day.
export function localIso(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export type WorkWeek = 'sun-thu' | 'mon-fri'
export type Range = { from: Date; to: Date; title: string }

const workdays = (w: WorkWeek) => (w === 'mon-fri' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4])

export function periodRange(kind: 'yesterday' | 'today' | 'week', now: Date, workWeek: WorkWeek): Range {
  const today = midnight(now)
  const end = new Date(now.getTime() + 1) // include what was logged this very millisecond
  if (kind === 'today') return { from: today, to: end, title: fmtDay(today) }
  if (kind === 'yesterday') {
    let day = addDays(today, -1)
    while (!workdays(workWeek).includes(day.getDay())) day = addDays(day, -1)
    return { from: day, to: addDays(day, 1), title: fmtDay(day) }
  }
  const first = workdays(workWeek)[0]!
  const start = addDays(today, -((today.getDay() - first + 7) % 7))
  return { from: start, to: end, title: `${fmtDay(start)} – ${fmtDay(today)}` }
}

export function dayRange(from: string, to: string): Range {
  const [a, b] = [from, to].map(s => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y!, m! - 1, d!)
  })
  return { from: a!, to: addDays(b!, 1), title: `${fmtDay(a!)} – ${fmtDay(b!)}` }
}

type Replayed = { text: string; label: string | null; manual: number; done: boolean; subs: Map<number, { text: string; done: boolean }> }

function replay(events: Event[]) {
  const goals = new Map<number, Replayed>()
  const focus = new Map<string, number>()
  for (const e of events) {
    let g = goals.get(e.goal)
    if (e.type === 'goal.add' || (!g && e.goal > 0 && e.type !== 'goal.remove')) {
      g = { text: e.type === 'goal.add' ? e.text : `#${e.goal}`, label: e.label, manual: 0, done: false, subs: new Map() }
      goals.set(e.goal, g)
    }
    if (!g) continue
    if (e.type.startsWith('goal.')) g.text = e.text
    g.label = e.label
    switch (e.type) {
      case 'goal.progress': g.manual = e.to ?? g.manual; break
      case 'goal.done': g.done = true; break
      case 'goal.reopen': g.done = false; break
      case 'goal.remove': goals.delete(e.goal); break
      case 'goal.focus': focus.set(labelKey(e.label), e.goal); break
      case 'sub.add': g.subs.set(e.sub!, { text: e.text, done: false }); break
      case 'sub.done': case 'sub.undone': { const s = g.subs.get(e.sub!); if (s) s.done = e.type === 'sub.done'; break }
      case 'sub.remove': g.subs.delete(e.sub!); break
    }
  }
  return { goals, focus }
}

const pct = (g: Replayed) => (g.done ? 100 : g.subs.size ? Math.round(([...g.subs.values()].filter(s => s.done).length / g.subs.size) * 100) : g.manual)
const amount = (g: Replayed) => (g.subs.size ? `${[...g.subs.values()].filter(s => s.done).length}/${g.subs.size}` : `${pct(g)}%`)

type Line = { label: string | null; text: string; note?: string }

function render(sections: [string, Line[]][]): string[] {
  const out: string[] = []
  for (const [name, lines] of sections) {
    lines.forEach((l, i) => {
      out.push(`${(i === 0 ? name : '').padEnd(12)}${l.text}`)
      if (l.note) out.push(`${' '.repeat(16)}${l.note}`)
    })
  }
  return out
}

export function summarize(events: Event[], from: Date, to: Date, title: string, byLabel: boolean): string {
  const t = (e: Event) => Date.parse(e.at)
  const inRange = events.filter(e => t(e) >= from.getTime() && t(e) < to.getTime())
  if (!inRange.length) return `Nothing logged for ${title}.`
  const start = replay(events.filter(e => t(e) < from.getTime()))
  const end = replay(events.filter(e => t(e) < to.getTime()))
  const touched = new Set(inRange.map(e => e.goal))

  const open = [...start.goals.values()].filter(g => !g.done)
  const focusText = [...start.focus.values()].map(id => start.goals.get(id)?.text).filter(Boolean).join(', ')
  const planned: Line[] = [{ label: null, text: `${open.length} goals open${focusText ? `, focus: ${focusText}` : ''}` }]

  const done: Line[] = inRange
    .filter(e => e.type === 'sub.done' || e.type === 'goal.done')
    .map(e => ({
      label: e.label,
      text: e.type === 'sub.done' ? `✓ ${e.text} (${end.goals.get(e.goal)?.text ?? `#${e.goal}`})` : `✓ ${e.text}`,
      ...(e.note ? { note: e.note } : {}),
    }))

  const moved: Line[] = []
  const still: Line[] = []
  for (const [id, g] of [...end.goals.entries()].sort((a, b) => a[0] - b[0])) {
    if (g.done) continue
    const before = start.goals.get(id)
    const a = before ? pct(before) : 0
    const b = pct(g)
    if (touched.has(id) && b > a) {
      const note = inRange.filter(e => e.goal === id && e.type === 'goal.progress' && e.note).map(e => e.note).join('; ')
      moved.push({ label: g.label, text: `${glyph(a)}→${glyph(b)} ${g.text}  ${before ? amount(before) : '0%'} → ${amount(g)}`, ...(note ? { note } : {}) })
    } else still.push({ label: g.label, text: g.text })
  }

  const sections = (keep: (l: Line) => boolean): [string, Line[]][] =>
    ([['DONE', done.filter(keep)], ['MOVED', moved.filter(keep)], ['STILL OPEN', still.filter(keep)]] as [string, Line[]][]).filter(([, l]) => l.length)

  if (!byLabel) return [title, ...render([['PLANNED', planned], ...sections(() => true)])].join('\n')
  const labels = [...new Set([...done, ...moved, ...still].map(l => l.label))].sort((x, y) => (x === null ? 1 : y === null ? -1 : x.localeCompare(y)))
  const out = [title, ...render([['PLANNED', planned]])]
  for (const label of labels) out.push('', (label ?? 'general').toUpperCase(), ...render(sections(l => l.label === label)))
  return out.join('\n')
}

export const postPrompt = (log: string, kind: 'day' | 'span') =>
  (kind === 'day'
    ? 'Rewrite this goal log as a 2-4 sentence standup update in plain first person ("Yesterday I...", "Today..."). '
    : 'Rewrite this goal log as a short weekly review in plain first person: 3-5 sentences on what got done, what moved and what is still open, grouped by label where it helps. ') +
  'Use only facts in the log; do not invent work. No headings, no bullet points.\n\n' +
  log
