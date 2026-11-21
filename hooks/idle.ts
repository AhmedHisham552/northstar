// Spinners Claude started, stopped once Claude has been idle for a while: no turn running, no agent alive.
export type Idle = { started: Set<string>; mainBusy: boolean; agents: number; since: number | null }

export const idle = (): Idle => ({ started: new Set(), mainBusy: false, agents: 0, since: null })

// Called on a timer: the keys to stop now, if Claude has been idle for waitMs.
export function idleStops(s: Idle, now: number, waitMs: number): string[] {
  if (!s.started.size || s.mainBusy || s.agents > 0) return void (s.since = null), []
  if (s.since === null) return void (s.since = now), []
  if (now - s.since < waitMs) return []
  const keys = [...s.started]
  s.started.clear()
  s.since = null
  return keys
}
