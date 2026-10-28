import { ref } from 'vue'

/**
 * Holiday writes that would cancel existing orders come back with a
 * `confirmImpact` field error (the server counted the affected orders).
 * `handle()` opens a confirmation with that message; `confirm()` replays the
 * request with `confirmImpact: true`.
 */
export function useImpactConfirm() {
  const open = ref(false)
  const message = ref('')
  let replay: (() => void) | null = null

  function handle(errors: Record<string, string | undefined>, again: () => void): boolean {
    const text = errors.confirmImpact
    if (!text) return false
    message.value = text
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

  return { open, message, handle, confirm }
}
