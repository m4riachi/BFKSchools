import { ref } from 'vue'

/** Chromium's install event (not in the DOM types yet). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const promptEvent = ref<InstallPromptEvent | null>(null)
const installed = ref(false)

/**
 * The browser fires `beforeinstallprompt` once, possibly before any page is
 * mounted: called from inertia/app.ts at startup.
 */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    promptEvent.value = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    promptEvent.value = null
    installed.value = true
  })
}

function runningAsApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone / iPad (recent iPads report a Mac with touch): no prompt, manual steps. */
function isIos() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  )
}

/** A per-browser convenience, safe to lose: storage can be blocked or cleared. */
const DISMISSED_KEY = 'install-prompt-dismissed-at'
const ASK_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  } catch {}
}

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISSED_KEY) ?? 0) < ASK_AGAIN_AFTER_MS
  } catch {
    return false
  }
}

export function useInstallApp() {
  return {
    rememberDismissed,
    dismissedRecently,
    promptEvent,
    installed,
    runningAsApp,
    isIos,
    async install() {
      const event = promptEvent.value
      if (!event) return
      await event.prompt()
      await event.userChoice
      // A prompt can only be used once; the browser fires a new event if dismissed.
      promptEvent.value = null
    },
  }
}
