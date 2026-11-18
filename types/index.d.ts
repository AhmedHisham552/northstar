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
export type State = { version: 2; nextId: number; focus: Record<string, number>; goals: Goal[] }
export type View = { state: State | null; label: string; today: string; expanded: string | null }

declare module 'claude-code' {
  interface PluginState {
    goals: { view: View | null }
  }
}
