import { useSyncExternalStore } from "react"
const DISMISS_KEY = "pamana.install-dismissed"
const DISMISS_DAYS = 30
function isStandalone() {
  if (typeof window === "undefined") return false
  return (
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches ||
    matchMedia("(display-mode: minimal-ui)").matches ||
    navigator.standalone === true
  )
}
function readDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return !!at && Date.now() - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}
let deferred = null
let state = {
  canInstall: false,
  installed: isStandalone(),
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  updateReady: false,
  bannerDismissed: typeof window === "undefined" ? false : readDismissed(),
}
const listeners = new Set()
function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
if (typeof window !== "undefined") {
  // Attached at module load (imported from main.jsx) so the event is never missed.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferred = e
    set({ canInstall: true })
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    set({ canInstall: false, installed: true })
  })
  window.addEventListener("online", () => set({ online: true }))
  window.addEventListener("offline", () => set({ online: false }))
  matchMedia("(display-mode: standalone)").addEventListener("change", () =>
    set({ installed: isStandalone() }),
  )
}
export function markUpdateReady(ready) {
  set({ updateReady: ready })
}
/** Shows the browser's install prompt. Resolves to the user's choice, or null if unavailable. */
export async function promptInstall() {
  if (!deferred) return null
  const event = deferred
  deferred = null // a prompt event can only be used once
  set({ canInstall: false })
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === "dismissed") dismissInstallBanner()
  return outcome
}
export function dismissInstallBanner() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // Dismissal lasts for this visit only.
  }
  set({ bannerDismissed: true })
}
export function detectPlatform() {
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac with touch support.
  if (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
    return "ios"
  if (/Android/.test(ua)) return "android"
  return "desktop"
}
function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function usePwa() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
