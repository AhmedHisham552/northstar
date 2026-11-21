import { expect, test } from 'claude-code/testing'
import { idle, idleStops } from './idle'

test('Claude-started spinners stop only after a quiet minute', async () => {
  const s = idle()
  s.started.add('13')
  s.started.add('2.4')
  s.mainBusy = true
  expect(idleStops(s, 0, 60_000)).toEqual([]) // turn running
  s.mainBusy = false
  s.agents = 1
  expect(idleStops(s, 1_000, 60_000)).toEqual([]) // an agent is still working
  s.agents = 0
  expect(idleStops(s, 2_000, 60_000)).toEqual([]) // quiet starts now
  expect(idleStops(s, 30_000, 60_000)).toEqual([])
  s.agents = 1
  expect(idleStops(s, 40_000, 60_000)).toEqual([]) // next workflow phase resets the wait
  s.agents = 0
  expect(idleStops(s, 41_000, 60_000)).toEqual([])
  expect(idleStops(s, 101_000, 60_000)).toEqual(['13', '2.4'])
  expect(s.started.size).toBe(0)
})
