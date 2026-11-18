import { expect, test } from 'claude-code/testing'

import { repoLabel } from './label'

test('worktrees share the main checkout name as their label', async () => {
  const run = async () => ({ exitCode: 0, stdout: '/home/u/Work/Shop/.git\n' })
  expect(await repoLabel(run, '/home/u/Work/Shop/.claude/worktrees/T-1')).toBe('shop')
})

test('RF3: outside git the folder name is the label', async () => {
  const run = async () => ({ exitCode: 128, stdout: '' })
  expect(await repoLabel(run, '/tmp/Scratch')).toBe('scratch')
  expect(await repoLabel(async () => Promise.reject(new Error('no git')), '/tmp/Scratch/')).toBe('scratch')
})
