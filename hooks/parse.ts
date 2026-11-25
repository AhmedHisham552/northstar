import { TITLE_MAX } from './model'
import type { Op } from './model'

export type Cmd =
  | { kind: 'op'; op: Op }
  | { kind: 'ops'; ops: Op[] }
  | { kind: 'summary'; period: 'yesterday' | 'today' | 'week' }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'show'; label: string }
  | { kind: 'doneList' }
  | { kind: 'work'; items: WorkItem[]; mode?: Dispatch }
  | { kind: 'help' }

export type Dispatch = 'agents' | 'workflow'
export type WorkItem = { goal: number; subs?: number[] }

const HELP: Cmd = { kind: 'help' }
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
// '@general' → null (General); '@here' kept for register to resolve to the session's repo label.
const toLabel = (t: string) => (t.slice(1).toLowerCase() === 'general' ? null : t === '@here' ? '@here' : t.slice(1))
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
  if (['clear', 'history', 'list', 'help'].includes(cmd) || (words.length === 1 && goalNo(cmd))) return HELP // command words and bare numbers, not goal names
  if (cmd === 'from') return isDate(a) && b === 'to' && isDate(words[3] ?? '') ? { kind: 'range', from: a, to: words[3]! } : HELP
  if (cmd.startsWith('@') && words.length === 1) return { kind: 'show', label: cmd.slice(1).toLowerCase() }

  const n = goalNo(a)
  const dotted = a.match(/^#?(\d+)\.(\d+)$/)
  switch (cmd) {
    case 'work': {
      // Goals and/or sub-tasks: `work 1 3`, `work [1,3]`, `work 2.4 2.5 workflow`.
      const items: WorkItem[] = []
      let mode: Dispatch | undefined
      for (const t of words.slice(1).join(' ').split(/[\s,[\]]+/).filter(Boolean)) {
        if (t === 'workflow' || t === 'workflows') mode = 'workflow'
        else if (t === 'agents' || t === 'agent') mode = 'agents'
        else {
          const d = t.match(/^#?(\d+)\.(\d+)$/)
          const g = d ? Number(d[1]) : goalNo(t)
          if (!g) return HELP
          let item = items.find(i => i.goal === g)
          if (!item) items.push((item = { goal: g }))
          if (d) item.subs = [...(item.subs ?? []), Number(d[2])]
        }
      }
      return items.length ? { kind: 'work', items, ...(mode ? { mode } : {}) } : HELP
    }
    case 'sub':
      return n && split(words.slice(2).join(' ')).length ? op({ kind: 'sub', goal: n, texts: split(words.slice(2).join(' ')) }) : HELP
    case 'tick':
      return dotted ? op(withNote({ kind: 'tick', goal: Number(dotted[1]), sub: Number(dotted[2]) })) : HELP
    case 'done':
      return n ? op(withNote({ kind: 'done', goal: n })) : HELP
    case 'start':
    case 'stop': {
      const ops: Op[] = []
      for (const t of words.slice(1).join(' ').split(/[\s,[\]]+/).filter(Boolean)) {
        const d = t.match(/^#?(\d+)\.(\d+)$/)
        const g = goalNo(t)
        if (d) ops.push({ kind: cmd, goal: Number(d[1]), sub: Number(d[2]) })
        else if (g) ops.push({ kind: cmd, goal: g })
        else return HELP
      }
      if (!ops.length) return cmd === 'stop' ? { kind: 'ops', ops: [{ kind: 'stop' }] } : HELP
      return { kind: 'ops', ops }
    }
    case 'rm': {
      // One or many: `rm 5`, `rm 5, 6`, `rm [5,6]`, `rm 5 3.2`.
      const ops: Op[] = []
      for (const t of words.slice(1).join(' ').split(/[\s,[\]]+/).filter(Boolean)) {
        const d = t.match(/^#?(\d+)\.(\d+)$/)
        const g = goalNo(t)
        if (d) ops.push({ kind: 'rm', goal: Number(d[1]), sub: Number(d[2]) })
        else if (g) ops.push({ kind: 'rm', goal: g })
        else return HELP
      }
      return ops.length === 1 ? op(ops[0]!) : ops.length ? { kind: 'ops', ops } : HELP
    }
    case 'focus':
      return a === 'off' ? op({ kind: 'focus', goal: null, label: '@here' }) : n ? op({ kind: 'focus', goal: n, label: '@here' }) : HELP
    case 'yes':
      return words.length === 1 ? op({ kind: 'accept' }) : HELP
    case 'no':
      return words.length === 1 ? op({ kind: 'dismiss' }) : HELP
    case 'did': {
      // `did [@label] Rewrote the status sync`: ad-hoc work for Today, raw so quotes stay.
      const rest = args.trim().slice(3).trim().split(/\s+/).filter(Boolean)
      const label = rest[0]?.startsWith('@') ? toLabel(rest.shift()!) : '@here'
      return rest.length ? op({ kind: 'did', text: rest.join(' '), label }) : HELP
    }
    case 'offer': {
      // `offer [@label] Title`: Claude's goal card for new work; the user adds it from the pane.
      const rest = args.trim().slice(5).trim().split(/\s+/).filter(Boolean)
      const label = rest[0]?.startsWith('@') ? toLabel(rest.shift()!) : '@here'
      return rest.length ? op({ kind: 'offer', title: rest.join(' '), label }) : HELP
    }
    case 'undo':
      return words.length === 1 ? op({ kind: 'undo' }) : words.length === 2 && /^\d+$/.test(a) ? op({ kind: 'undo', id: Number(a) }) : HELP
    case 'group': {
      // `group Waypoint improvements: 3, 4, 5`
      const m = args.trim().slice(5).match(/^(.+):\s*([\d,\s[\]]+)$/)
      const ids = (m?.[2] ?? '').split(/[\s,[\]]+/).filter(Boolean).map(Number)
      return m && m[1]!.trim() && ids.length ? op({ kind: 'group', title: m[1]!.trim(), ids }) : HELP
    }
    case 'rename': {
      // The new name is read from the raw line, so quotes in it are kept.
      const text = args.trim().split(/\s+/).slice(2).join(' ')
      if (!text) return HELP
      return dotted ? op({ kind: 'rename', goal: Number(dotted[1]), sub: Number(dotted[2]), text }) : n ? op({ kind: 'rename', goal: n, text }) : HELP
    }
    case 'tag':
    case 'move': {
      // `move 3 @work`, `move 3, 5 @work`, `move [3,5] @general`.
      const to = words.at(-1) ?? ''
      const ids = words.slice(1, -1).join(' ').split(/[\s,[\]]+/).filter(Boolean).map(goalNo)
      if (!to.startsWith('@') || !ids.length || ids.some(x => !x)) return HELP
      const ops: Op[] = ids.map(goal => ({ kind: 'tag', goal, label: toLabel(to) }))
      return ops.length === 1 ? op(ops[0]!) : { kind: 'ops', ops }
    }
  }
  if (!Number.isNaN(goalNo(cmd)) && words.length === 2 && /^\d+$/.test(a)) {
    return op(withNote({ kind: 'progress', goal: goalNo(cmd), value: Number(a) }))
  }
  // Goals keep their quotes; `;` splits only a list of short names, so a pasted paragraph stays one goal.
  const rest = (cmd === 'add' ? args.trim().slice(3) : args).trim().split(/\s+/).filter(Boolean)
  const label = rest[0]?.startsWith('@') ? toLabel(rest.shift()!) : null
  const body = rest.join(' ')
  const parts = split(body)
  const texts = parts.every(t => t.length <= TITLE_MAX) ? parts : [body]
  return parts.length ? op({ kind: 'add', texts, label }) : HELP
}
