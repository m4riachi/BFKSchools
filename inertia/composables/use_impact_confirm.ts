import { ref } from 'vue'

/**
 * Holiday writes that would cancel existing orders come back with a
 * `confirmImpact` field error (the server counted the affected orders).
 * `handle()` opens a confirmation with that message; `confirm()` replays the
 * request with `confirmImpact: true` and `confirmedCount` = `count` (the
 * number the server reported in its `confirmedCount` error): the server
 * recounts inside its transaction and asks again if more orders exist now.
 */
export function useImpactConfirm() {
  const open = ref(false)
  const message = ref('')
  const count = ref(0)
  let replay: (() => void) | null = null

  function handle(errors: Record<string, string | undefined>, again: () => void): boolean {
    const text = errors.confirmImpact
    if (!text) return false
    message.value = text
    const reported = Number(errors.confirmedCount)
    count.value = Number.isSafeInteger(reported) && reported >= 0 ? reported : 0
    replay = again
    open.value = true
    return true
  }

  function confirm() {
    open.value = false
    const run = replay
    replay = null
    run?.()
  }

  return { open, message, count, handle, confirm }
}
