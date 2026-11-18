import type { Op } from './model'

export type Cmd =
  | { kind: 'op'; op: Op }
  | { kind: 'summary'; period: 'yesterday' | 'today' | 'week' }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'show'; label: string }
  | { kind: 'doneList' }
  | { kind: 'help' }

const HELP: Cmd = { kind: 'help' }
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
// '@general' → null (General); '@here' kept for register to resolve to the session's repo label.
const toLabel = (t: string) => (t.slice(1).toLowerCase() === 'general' ? null : t === '@here' ? '@here' : t.slice(1).toLowerCase())
const split = (t: string) => t.split(';').map(x => x.trim()).filter(Boolean)
const goalNo = (t = '') => (/^#?\d+$/.test(t) ? Number(t.replace('#', '')) : NaN)

export function parse(args: string): Cmd {
  const m = args.match(/["“](.*?)["”]/)
  const note = m?.[1]?.trim() || undefined
  const words = (m ? args.replace(m[0], '') : args).trim().split(/\s+/).filter(Boolean)
  const [cmd = '', a = '', b = ''] = words
  const withNote = <T extends object>(o: T) => (note ? { ...o, note } : o)
  const op = (o: Op): Cmd => ({ kind: 'op', op: o })

  if (!cmd) return HELP
  if (cmd === 'yesterday' || cmd === 'today' || cmd === 'week') return { kind: 'summary', period: cmd }
  if (cmd === 'done-list') return { kind: 'doneList' }
  if (cmd === 'clear' || cmd === 'history' || cmd === 'list') return HELP // v1 commands, not goal names
  if (cmd === 'from') return isDate(a) && b === 'to' && isDate(words[3] ?? '') ? { kind: 'range', from: a, to: words[3]! } : HELP
  if (cmd.startsWith('@') && words.length === 1) return { kind: 'show', label: cmd.slice(1).toLowerCase() }

  const n = goalNo(a)
  const dotted = a.match(/^#?(\d+)\.(\d+)$/)
  switch (cmd) {
    case 'sub':
      return n && split(words.slice(2).join(' ')).length ? op({ kind: 'sub', goal: n, texts: split(words.slice(2).join(' ')) }) : HELP
    case 'tick':
      return dotted ? op(withNote({ kind: 'tick', goal: Number(dotted[1]), sub: Number(dotted[2]) })) : HELP
    case 'done':
      return n ? op(withNote({ kind: 'done', goal: n })) : HELP
    case 'rm':
      return dotted ? op({ kind: 'rm', goal: Number(dotted[1]), sub: Number(dotted[2]) }) : n ? op({ kind: 'rm', goal: n }) : HELP
    case 'focus':
      return a === 'off' ? op({ kind: 'focus', goal: null, label: '@here' }) : n ? op({ kind: 'focus', goal: n, label: null }) : HELP
    case 'tag':
      return n && b.startsWith('@') ? op({ kind: 'tag', goal: n, label: toLabel(b) }) : HELP
  }
  if (!Number.isNaN(goalNo(cmd)) && words.length === 2 && /^\d+$/.test(a)) {
    return op(withNote({ kind: 'progress', goal: goalNo(cmd), value: Number(a) }))
  }
  const rest = cmd === 'add' ? words.slice(1) : words
  const label = rest[0]?.startsWith('@') ? toLabel(rest.shift()!) : null
  const texts = split(rest.join(' '))
  return texts.length ? op({ kind: 'add', texts, label }) : HELP
}
