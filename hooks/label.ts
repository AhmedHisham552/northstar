export type Run = (argv: readonly string[], init: { cwd: string }) => Promise<{ exitCode: number; stdout: string }>

const base = (path: string) => path.replace(/\/+$/, '').split('/').pop()!.toLowerCase()

// The main checkout's folder name, so every worktree of a repo shares one label.
export async function repoLabel(run: Run, cwd: string): Promise<string> {
  try {
    const r = await run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd })
    if (r.exitCode === 0 && r.stdout.trim()) return base(r.stdout.trim().replace(/\/\.git$/, ''))
  } catch {
    // no git: fall through
  }
  return base(cwd)
}
