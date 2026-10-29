import { test } from '@japa/runner'
import { RenderBusyError, RenderGate } from '#support/render_gate'
import { clampGrid, LABEL_GRID_LIMITS } from '#services/label_pdf_service'

test.group('PDF render gate', () => {
  test('runs at most N renders at a time, queues the rest, refuses past the queue', async ({
    assert,
  }) => {
    const gate = new RenderGate(2, 1)
    let running = 0
    let peak = 0
    const releases: Array<() => void> = []
    const work = () =>
      gate.run(async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise<void>((resolve) => releases.push(resolve))
        running -= 1
        return 'ok'
      })
    const first = work()
    const second = work()
    const third = work() // waits
    await assert.rejects(() => work(), RenderBusyError as any)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(gate.running, 2)
    assert.equal(gate.waiting, 1)
    releases.shift()!()
    await first
    await new Promise((resolve) => setImmediate(resolve))
    releases.shift()!()
    releases.shift()!()
    assert.deepEqual(await Promise.all([second, third]), ['ok', 'ok'])
    assert.equal(peak, 2)
    assert.equal(gate.running, 0)
    assert.equal(gate.waiting, 0)
  })

  test('a failing render frees its slot', async ({ assert }) => {
    const gate = new RenderGate(1, 0)
    await assert.rejects(() =>
      gate.run(async () => {
        throw new Error('boom')
      })
    )
    assert.equal(await gate.run(async () => 42), 42)
  })

  test('label grid values are clamped, NaN and Infinity included', ({ assert }) => {
    assert.equal(clampGrid(Number.NaN, LABEL_GRID_LIMITS.cols), 1)
    assert.equal(clampGrid(Number.POSITIVE_INFINITY, LABEL_GRID_LIMITS.rows), 1)
    assert.equal(clampGrid(3.7, LABEL_GRID_LIMITS.cols), 3)
    assert.equal(clampGrid(99, LABEL_GRID_LIMITS.rows), 20)
    assert.equal(clampGrid(-2, LABEL_GRID_LIMITS.cols), 1)
  })
})
