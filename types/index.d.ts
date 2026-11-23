export type Sub = { id: number; text: string; done: boolean }
export type Goal = {
  id: number
  text: string
  // The full text a long goal was typed with; `text` is its short title.
  detail?: string
  label: string | null
  progress: number | null
  createdAt: string
  doneAt: string | null
  nextSub: number
  subs: Sub[]
}
// names: label key → the label as first typed, for display ('getpaid' → 'GetPaid').
// active: work in progress, key '3' (goal) or '3.2' (sub-task) → when it started.
export type State = { version: 2; nextId: number; focus: Record<string, number>; goals: Goal[]; active?: Record<string, string>; names?: Record<string, string> }
export type View = { state: State | null; label: string; today: string; collapsed?: string[] }

declare module 'claude-code' {
  interface PluginState {
    waypoint: { view: View | null; frame: number | null }
  }
}
