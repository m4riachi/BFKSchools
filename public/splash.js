/*
 * Animated logo while the installed app starts. Phones draw their own first
 * screen from the app icon, and it cannot animate: this one follows it. Only
 * in the installed app, once per launch, and it can never stay on screen.
 * A plain file in public/: it must run before the app's bundle has loaded, and
 * the content security policy refuses inline scripts.
 */
;(function () {
  var splash = document.getElementById('app-splash')
  if (!splash) return

  var installed =
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  var seen = false
  try {
    seen = sessionStorage.getItem('app-splash-seen') === '1'
    sessionStorage.setItem('app-splash-seen', '1')
  } catch (error) {
    // No storage: the logo may show on a reload, nothing worse.
  }
  if (!installed || seen) {
    splash.remove()
    return
  }

  var MIN_MS = 1800 // long enough for the logo's entrance
  var MAX_MS = 6000 // a slow network never traps the user here
  var image = document.createElement('img')
  image.src = '/bfk-logo-animated.svg'
  image.alt = ''
  splash.appendChild(image)
  splash.hidden = false

  var closed = false
  function close() {
    if (closed) return
    closed = true
    splash.classList.add('app-splash-out')
    setTimeout(function () {
      splash.remove()
    }, 300)
  }

  var loaded = document.readyState === 'complete'
  var waited = false
  function closeWhenReady() {
    if (loaded && waited) close()
  }
  window.addEventListener('load', function () {
    loaded = true
    closeWhenReady()
  })
  setTimeout(function () {
    waited = true
    closeWhenReady()
  }, MIN_MS)
  setTimeout(close, MAX_MS)
})()
