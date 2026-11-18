import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { applyOp, labelKey } from './model'
import type { Op } from './model'
import { repoLabel } from './label'
import { parse } from './parse'
import type { Cmd } from './parse'
import { appendEvent, dataDir, engineIo, loadState, migrate, readEvents, saveState } from './store'
import type { Engine } from './store'
import { dayRange, localDay, localIso, periodRange, postPrompt, summarize } from './summary'
import type { WorkWeek } from './summary'
import { goalsBrief, hintTail, workPrompt } from './brief'
import { paneTree } from './view'
import type { View } from './view'

const PANE = 'goals'
const TOOL = 'mcp__goals__update_goals'
const MODEL = 'claude-haiku-5-5'
const view = atom({ plugin: 'goals', key: 'view' } as const, null as View | null)

export const HELP = [
  '/goals add [@label|@here] A; B   add goals (General by default)',
  '/goals sub <n> A; B              add sub-tasks to goal n',
  '/goals tick <n>.<m> ["note"]     tick / untick a sub-task',
  '/goals <n> <0-100> ["note"]      set progress (goals without sub-tasks)',
  '/goals done <n> ["note"]         mark goal n done',
  '/goals rm <n>[, <n>.<m> …]       remove goals and/or sub-tasks',
  '/goals focus <n> | focus off     set or clear the NOW goal',
  '/goals tag <n> @label|@general   move a goal to a label',
  '/goals @label                    open / close a label in the pane',
  '/goals yesterday | today | week  summary with a ready-to-post update',
  '/goals from YYYY-MM-DD to YYYY-MM-DD',
  '/goals:work <n> [<n> …]          align here, then dispatch agents per goal',
  '/goals done-list                 finished goals',
].join('\n')

type Opts = { dataDir: string | undefined; workWeek: WorkWeek; autoUpdate: boolean }

function dir($: Engine, o: Opts) {
  return dataDir(engineIo($), o.dataDir)
}

// Other sessions write the same files: pick their changes up when goals.json changes on disk.
let seenMtime = -1
async function refresh($: Engine, o: Opts) {
  try {
    const io = engineIo($)
    const path = `${await dir($, o)}/goals.json`
    if (!(await io.exists(path))) return
    const { mtimeMs } = await $.fs.stat(path)
    if (mtimeMs === seenMtime) return
    seenMtime = mtimeMs
    const state = await loadState(io, await dir($, o))
    await update($, view, v => (v ? { ...v, state } : v))
  } catch {
    // a refresh that fails keeps the last state; it must never block a prompt
  }
}

async function now($: Engine) {
  return new Date(await $.clock.now())
}

async function change($: Engine, o: Opts, op: Op): Promise<string> {
  const io = engineIo($)
  const d = await dir($, o)
  const v = await read($, view)
  const label = v?.label ?? 'general'
  const resolved: Op =
    op.kind === 'add' && op.label === '@here' ? { ...op, label } :
    op.kind === 'focus' && op.label === '@here' ? { ...op, label } :
    op.kind === 'tag' && op.label === '@here' ? { ...op, label } : op
  const at = localIso(await now($))
  const current = await loadState(io, d)
  // `focus off` clears the focus NOW shows: the repo's, else General's.
  const target: Op = resolved.kind === 'focus' && resolved.goal === null && current.focus[label] === undefined ? { ...resolved, label: null } : resolved
  const r = applyOp(current, target, at)
  if ('error' in r) return r.error
  await saveState(io, d, r.state)
  for (const e of r.events) await appendEvent(io, d, e)
  await update($, view, old => ({ state: r.state, label, today: at.slice(0, 10), expanded: old?.expanded ?? null }))
  if (target.kind === 'focus' && target.goal === null) return `Focus cleared for ${labelKey(target.label)}.`
  return r.events.map(e => `${e.type.replace('.', ' ')}: ${e.sub ? `${e.goal}.${e.sub}` : `#${e.goal}`} ${e.text}`).join('\n')
}

async function summary($: Engine, o: Opts, range: { from: Date; to: Date; title: string }, byLabel: boolean): Promise<string> {
  const events = await readEvents(engineIo($), await dir($, o), localDay(range.to))
  const log = summarize(events, range.from, range.to, range.title, byLabel)
  if (log.startsWith('Nothing logged')) return log
  const post = await $.model.complete({ model: MODEL, prompt: postPrompt(log, byLabel ? 'span' : 'day'), maxTokens: 300 })
  return `${log}\n\nPOST\n${post.isAnswered ? post.text.trim() : '(post could not be generated)'}`
}

async function run($: Engine, o: Opts, cmd: Cmd): Promise<string> {
  switch (cmd.kind) {
    case 'help':
      return HELP
    case 'op':
      return change($, o, cmd.op)
    case 'ops': {
      const out: string[] = []
      for (const op of cmd.ops) out.push(await change($, o, op))
      return out.join('\n')
    }
    case 'show':
      await update($, view, v => (v ? { ...v, expanded: v.expanded === cmd.label ? null : cmd.label } : v))
      return `Toggled @${cmd.label} in the pane.`
    case 'doneList': {
      const s = await loadState(engineIo($), await dir($, o))
      const done = s.goals.filter(g => g.doneAt)
      return done.length ? done.map(g => `✓ #${g.id} ${g.text}  (${g.doneAt!.slice(0, 10)})`).join('\n') : 'No finished goals.'
    }
    case 'summary':
      return summary($, o, periodRange(cmd.period, await now($), o.workWeek), cmd.period === 'week')
    case 'range':
      return summary($, o, dayRange(cmd.from, cmd.to), true)
    case 'work': {
      const s = await loadState(engineIo($), await dir($, o))
      const goals = cmd.goals.map(id => s.goals.find(g => g.id === id))
      const missing = cmd.goals.filter((_, i) => !goals[i])
      if (missing.length) return `no goal ${missing.map(id => `#${id}`).join(', ')}`
      await change($, o, { kind: 'focus', goal: cmd.goals[0]!, label: null })
      return workPrompt(goals.filter(g => g !== undefined))
    }
  }
}

export const register: Register = (on, options) => {
  const o: Opts = {
    dataDir: typeof options.dataDir === 'string' ? options.dataDir : undefined,
    workWeek: options.workWeek === 'mon-fri' ? 'mon-fri' : 'sun-thu',
    autoUpdate: options.autoUpdate !== false,
  }

  on('session.start', async ($, e, next) => {
    const io = engineIo($)
    const d = await dir($, o)
    const at = localIso(await now($))
    await migrate(io, d, at)
    const label = await repoLabel((argv, init) => $.process.run(argv, init), e.cwd)
    const state = await loadState(io, d)
    await update($, view, () => ({ state, label, today: at.slice(0, 10), expanded: null }))
    await $.command.register({ name: 'goals', description: 'Goals pane: add, sub-tasks, tick, focus, summaries (yesterday/today/week)' })
    await $.tool.register({
      name: 'update_goals',
      description:
        "Read or change the user's goals pane, or get a summary. Takes one /goals command line without the slash word, e.g. " +
        '"add @here Write docs; Ship v2", "sub 3 Draft; Review", "tick 3.1 \\"note\\"", "3 60", "done 3", "focus 3", "yesterday", "week", "from 2026-11-01 to 2026-11-15". ' +
        'Use it when work you did completes a listed sub-task or moves a goal, or when the user asks about their goals or for a standup/weekly summary. Goal numbers are the #ids shown in the pane.',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    })
    void $.ui.open({ id: PANE, title: 'Goals', columns: 32, backgroundColor: 'transparent' })
    // ponytail: 4s mtime poll; a file watcher if the API ever offers one.
    $.clock.every(4000, () => void refresh($, o))
    return next(e)
  })

  on('command.run', { command: 'goals' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Goals', columns: 32, backgroundColor: 'transparent' })
    const cmd = parse(e.args)
    // A command can't start a turn; the plugin's /goals:work skill does.
    if (cmd.kind === 'work') return { text: `Run /goals:work ${cmd.goals.join(' ')} to start working on ${cmd.goals.map(n => `#${n}`).join(', ')}.` }
    return { text: await run($, o, cmd) }
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    // The tool's arguments arrive on the event itself.
    const args = e as unknown as { command?: string; input?: { command?: string } }
    const cmd = parse(args.command ?? args.input?.command ?? '')
    const before = await read($, view)
    const result = await run($, o, cmd)
    // Claude changed the tracker on its own: say so, with the way back for a focus switch.
    if (cmd.kind === 'op' && ['focus', 'tick', 'done', 'progress'].includes(cmd.op.kind) && !result.startsWith('no ')) {
      const prev = before?.state ? (before.state.focus[before.label] ?? before.state.focus.general) : undefined
      const undo = cmd.op.kind === 'focus' && prev && prev !== cmd.op.goal ? ` · /goals focus ${prev} to undo` : ''
      $.ui.toast(`Goals: ${result.split('\n').at(-1)}${undo}`)
    }
    return { result } as never
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const v = await read($, view)
    if (!v?.state) return <ui.Text dimColor>Loading goals…</ui.Text>
    return paneTree(ui as never, { ...v, state: v.state }, e.props.bodyColumns, {
      focus: goal => void change($, o, { kind: 'focus', goal, label: null }),
      tick: (goal, sub, done) => void change($, o, { kind: 'tick', goal, sub, done }),
      toggle: label => void update($, view, x => (x ? { ...x, expanded: x.expanded === label ? null : label } : x)),
    })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const v = await read($, view)
    const tail = v?.state ? hintTail({ ...v, state: v.state }) : ''
    return tail ? next({ ...e, props: { ...e.props, tail: `· ${tail}` } }) : next(e)
  })

  // Each prompt carries the current goals, so Claude can switch focus or tick sub-tasks as the talk moves.
  on('prompt.submit', async ($, e, next) => {
    await refresh($, o)
    const v = await read($, view)
    if (!o.autoUpdate || e.command || !v?.state || !v.state.goals.some(g => !g.doneAt)) return next(e)
    return next({ ...e, context: [...(e.context ?? []), goalsBrief({ ...v, state: v.state })] })
  })}
