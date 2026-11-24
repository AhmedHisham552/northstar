import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { TITLE_MAX, applyOp, isActive, labelKey } from './model'
import type { Goal, Op } from './model'
import { idle, idleStops } from './idle'
import { repoLabel } from './label'
import { parse } from './parse'
import type { Cmd } from './parse'
import { appendEvent, dataDir, engineIo, loadState, migrate, readEvents, saveState } from './store'
import type { Engine } from './store'
import { dayRange, localDay, localIso, periodRange, postPrompt, summarize } from './summary'
import type { WorkWeek } from './summary'
import { goalsBrief, hintTail, shortTitle, titlePrompt, workPrompt } from './brief'
import { paneTree, summaryTree } from './view'
import type { View } from './view'

const PANE = 'waypoint'
const TOOL = 'mcp__waypoint__update_goals'
const MODEL = 'claude-haiku-5-5'
const view = atom({ plugin: 'waypoint', key: 'view' } as const, null as View | null)
const frame = atom({ plugin: 'waypoint', key: 'frame' } as const, null as number | null)
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// Advance the spinner only while something is in progress, so an idle pane never redraws.
async function spinTick($: Engine) {
  const v = await read($, view)
  if (!v?.state?.active || !Object.keys(v.state.active).length) return
  const nowMs = await $.clock.now()
  const busy = Object.keys(v.state.active).some(k => isActive(v.state!, k, nowMs))
  if (busy) await update($, frame, f => ((f ?? 0) + 1) % SPINNER.length)
}

// Spinners started with /track start are the user's and are left alone; Claude's stop after a quiet minute.
const IDLE_MS = 60_000
const quiet = idle()

async function sweepIdle($: Engine, o: Opts) {
  if (!quiet.started.size) return
  for (const k of idleStops(quiet, await $.clock.now(), IDLE_MS)) {
    const [goal, sub] = k.split('.').map(Number)
    await change($, o, sub ? { kind: 'stop', goal: goal!, sub } : { kind: 'stop', goal: goal! })
  }
}

export const HELP = [
  '/track add [@label|@here] A; B   add goals (General by default)',
  '/track sub <n> A; B              add sub-tasks to goal n',
  '/track tick <n>.<m> ["note"]     tick / untick a sub-task',
  '/track <n> <0-100> ["note"]      set progress (goals without sub-tasks)',
  '/track done <n> ["note"]         mark goal n done',
  '/track rm <n>[, <n>.<m> …]       remove goals and/or sub-tasks',
  '/track focus <n> | focus off     set or clear the NOW goal',
  '/track start <n|n.m> … | stop    mark work in progress (spins in the pane)',
  '/track rename <n|n.m> <name>     rename a goal or sub-task',
  '/track move <n>[, <n> …] @label  move goals to a label (@general, @here)',
  '/track did <what you did>        log ad-hoc work under Today',
  '/track yes | no                  accept or dismiss the grouping card',
  '/track @label                    open / close a label in the pane',
  '/track yesterday | today | week  summary with a ready-to-post update',
  '/track from YYYY-MM-DD to YYYY-MM-DD',
  '/waypoint:work <n|n.m> … [workflow] align here, then dispatch agents or workflows',
  '/track done-list                 finished goals',
].join('\n')

type Opts = { dataDir: string | undefined; workWeek: WorkWeek; autoUpdate: boolean; dispatch: 'agents' | 'workflow' }

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

// Labels start open; a header click or `/track @label` collapses and reopens one.
const toggled = (v: View, label: string): View => {
  const c = v.collapsed ?? []
  return { ...v, collapsed: c.includes(label) ? c.filter(x => x !== label) : [...c, label] }
}

// A long goal gets a short title from the model; the full text stays as its detail.
async function shorten($: Engine, t: string): Promise<string> {
  const r = await $.model.complete({ model: MODEL, prompt: titlePrompt(t), maxTokens: 40 }).catch(() => null)
  return shortTitle(r?.isAnswered ? r.text : null, t)
}

async function titled($: Engine, op: Op): Promise<Op> {
  if (op.kind === 'rename' && op.sub === undefined && op.text.length > TITLE_MAX) return { ...op, text: await shorten($, op.text), detail: op.text }
  if (op.kind !== 'add' || op.texts.every(t => t.length <= TITLE_MAX)) return op
  const texts: string[] = []
  const details: (string | undefined)[] = []
  for (const t of op.texts) {
    if (t.length <= TITLE_MAX) {
      texts.push(t)
      details.push(undefined)
      continue
    }
    texts.push(await shorten($, t))
    details.push(t)
  }
  return { ...op, texts, details }
}

async function change($: Engine, o: Opts, input: Op): Promise<string> {
  const op = await titled($, input)
  const io = engineIo($)
  const d = await dir($, o)
  const v = await read($, view)
  const label = v?.label ?? 'general'
  const resolved: Op =
    op.kind === 'add' && op.label === '@here' ? { ...op, label } :
    op.kind === 'focus' && op.label === '@here' ? { ...op, label } :
    op.kind === 'tag' && op.label === '@here' ? { ...op, label } :
    op.kind === 'did' && op.label === '@here' ? { ...op, label } : op
  const at = localIso(await now($))
  const current = await loadState(io, d)
  // `focus off` clears the focus NOW shows: the repo's, else General's.
  const target: Op = resolved.kind === 'focus' && resolved.goal === null && current.focus[label] === undefined ? { ...resolved, label: null } : resolved
  const r = applyOp(current, target, at)
  if ('error' in r) return r.error
  await saveState(io, d, r.state)
  for (const e of r.events) await appendEvent(io, d, e)
  await update($, view, old => ({ state: r.state, label, today: at.slice(0, 10), collapsed: old?.collapsed ?? [] }))
  if (target.kind === 'focus' && target.goal === null) return `Focus cleared for ${labelKey(target.label)}.`
  if (target.kind === 'did') return `logged today: ${target.text}`
  if (target.kind === 'group') return `Suggested in the pane: group as "${target.title}" (/track yes or /track no)`
  if (target.kind === 'dismiss') return 'Grouping dismissed.'
  if (target.kind === 'accept') return r.events.filter(e => e.type === 'goal.add').map(e => `grouped: #${e.goal} ${e.text}`).join('\n')
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
      await update($, view, v => (v ? toggled(v, cmd.label) : v))
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
      const items: { goal: Goal; subs?: number[] }[] = []
      for (const it of cmd.items) {
        const goal = s.goals.find(g => g.id === it.goal)
        if (!goal) return `no goal #${it.goal}`
        const bad = it.subs?.find(id => !goal.subs.some(x => x.id === id))
        if (bad !== undefined) return `no sub-task ${goal.id}.${bad}`
        items.push(it.subs ? { goal, subs: it.subs } : { goal })
      }
      await change($, o, { kind: 'focus', goal: cmd.items[0]!.goal, label: '@here' })
      return workPrompt(items, cmd.mode ?? o.dispatch)
    }
  }
}

export const register: Register = (on, options) => {
  const o: Opts = {
    dataDir: typeof options.dataDir === 'string' ? options.dataDir : undefined,
    workWeek: options.workWeek === 'mon-fri' ? 'mon-fri' : 'sun-thu',
    autoUpdate: options.autoUpdate !== false,
    dispatch: options.dispatch === 'workflow' ? 'workflow' : 'agents',
  }

  on('session.start', async ($, e, next) => {
    const io = engineIo($)
    const d = await dir($, o)
    const at = localIso(await now($))
    await migrate(io, d, at)
    const label = await repoLabel((argv, init) => $.process.run(argv, init), e.cwd)
    const state = await loadState(io, d)
    await update($, view, () => ({ state, label, today: at.slice(0, 10), collapsed: [] }))
    await $.command.register({ name: 'track', description: 'Waypoint goals pane: add, sub-tasks, tick, focus, summaries (yesterday/today/week)' })
    await $.tool.register({
      name: 'update_goals',
      description:
        "Read or change the user's goals pane, or get a summary. Takes one /track command line without the slash word, e.g. " +
        '"add @here Write docs; Ship v2", "sub 3 Draft; Review", "tick 3.1 \\"note\\"", "3 60", "done 3", "focus 3", "rename 3 New name", "move 3 @work", "did Rewrote the status sync", "group Waypoint fixes: 3, 4, 5", "yesterday", "week", "from 2026-11-01 to 2026-11-15". ' +
        'A goal name over ' + TITLE_MAX + ' characters gets a short title, with the full text kept as its details. ' +
        'Use it when work you did completes a listed sub-task or moves a goal, or when the user asks about their goals or for a standup/weekly summary. Goal numbers are the #ids shown in the pane.',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    })
    void $.ui.open({ id: PANE, title: 'Waypoint', columns: 32, backgroundColor: 'transparent' })
    // ponytail: 4s mtime poll; a file watcher if the API ever offers one.
    $.clock.every(4000, () => void refresh($, o))
    $.clock.every(120, () => void spinTick($))
    $.clock.every(5000, () => void sweepIdle($, o))
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    quiet.agents++
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) quiet.mainBusy = true
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) quiet.agents = Math.max(0, quiet.agents - 1)
    else quiet.mainBusy = false
    return next(e)
  })

  on('command.run', { command: 'track' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Waypoint', columns: 32, backgroundColor: 'transparent' })
    const cmd = parse(e.args)
    // A command can't start a turn; the plugin's /waypoint:work skill does.
    if (cmd.kind === 'work') {
      const what = cmd.items.flatMap(i => (i.subs ? i.subs.map(x => `${i.goal}.${x}`) : [String(i.goal)]))
      return { text: `Run /waypoint:work ${what.join(' ')}${cmd.mode ? ` ${cmd.mode}` : ''} to start working on ${what.map(n => `#${n}`).join(', ')}.` }
    }
    return { text: await run($, o, cmd) }
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    // The tool's arguments arrive on the event itself.
    const args = e as unknown as { command?: string; input?: { command?: string } }
    const cmd = parse(args.command ?? args.input?.command ?? '')
    const before = await read($, view)
    const result = await run($, o, cmd)
    for (const op of cmd.kind === 'op' ? [cmd.op] : cmd.kind === 'ops' ? cmd.ops : [])
      if (op.kind === 'start') quiet.started.add(op.sub ? `${op.goal}.${op.sub}` : String(op.goal))
    // Claude changed the tracker on its own: say so, with the way back for a focus switch.
    if (cmd.kind === 'op' && ['focus', 'tick', 'done', 'progress', 'did'].includes(cmd.op.kind) && !result.startsWith('no ')) {
      const prev = before?.state ? (before.state.focus[before.label] ?? before.state.focus.general) : undefined
      const undo = cmd.op.kind === 'focus' && prev && prev !== cmd.op.goal ? ` · /track focus ${prev} to undo` : ''
      $.ui.toast(`Waypoint: ${result.split('\n').at(-1)}${undo}`)
    }
    return { result } as never
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const v = await read($, view)
    if (!v?.state) return <ui.Text dimColor>Loading goals…</ui.Text>
    const state = v.state
    const busy = Object.keys(state.active ?? {}).length > 0
    const nowMs = busy ? await $.clock.now() : 0
    const f = busy ? ((await read($, frame)) ?? 0) : 0
    return paneTree(ui as never, { ...v, state }, e.props.bodyColumns, {
      spin: key => (busy && isActive(state, key, nowMs) ? SPINNER[f % SPINNER.length]! : null),
      focus: goal => void change($, o, { kind: 'focus', goal, label: '@here' }),
      tick: (goal, sub, done) => void change($, o, { kind: 'tick', goal, sub, done }),
      toggle: label => void update($, view, x => (x ? toggled(x, label) : x)),
      accept: () => void change($, o, { kind: 'accept' }),
      dismiss: () => void change($, o, { kind: 'dismiss' }),
    })
  })

  // A summary draws as a framed log and post; any other /track answer keeps the plain row.
  on('ui.render', { component: 'CommandOutput', props: { command: 'track' } }, async ($, e, next) => {
    if (e.props.isErrored || !e.props.text.includes('\n\nPOST\n')) return next(e)
    return summaryTree($.ui.resolve(e) as never, e.props.text)
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
    // Sent even with no open goals, so ad-hoc work still gets logged.
    if (!o.autoUpdate || e.command || !v?.state) return next(e)
    return next({ ...e, context: [...(e.context ?? []), goalsBrief({ ...v, state: v.state })] })
  })}
