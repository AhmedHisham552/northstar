export type Goal = { id: number; text: string; progress: number }

declare module 'claude-code' {
  interface PluginState {
    goals: { list: Shaped<Goal[]> }
  }
}
