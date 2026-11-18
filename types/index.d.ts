export type Sub = { id: number; text: string; done: boolean }
export type Goal = {
  id: number
  text: string
  label: string | null
  progress: number | null
  createdAt: string
  doneAt: string | null
  nextSub: number
  subs: Sub[]
}
// active: work in progress, key '3' (goal) or '3.2' (sub-task) → when it started.
export type State = { version: 2; nextId: number; focus: Record<string, number>; goals: Goal[]; active?: Record<string, string> }
export type View = { state: State | null; label: string; today: string; expanded: string | null }

declare module 'claude-code' {
  interface PluginState {
    goals: { view: View | null; frame: number | null }
  }
}
