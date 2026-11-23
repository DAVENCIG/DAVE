const KEY = "pamana-lang"
const listeners = new Set()
function initial() {
  try {
    // A shared link can pick the language with ?lang=en or ?lang=tl.
    const fromUrl = new URLSearchParams(location.search).get("lang")
    if (fromUrl === "en" || fromUrl === "tl") {
      localStorage.setItem(KEY, fromUrl)
      return fromUrl
    }
    const saved = localStorage.getItem(KEY)
    if (saved === "en" || saved === "tl") return saved
  } catch {
    // Storage can be unavailable (private mode); fall back to Tagalog.
  }
  return "tl"
}
let current = initial()
if (typeof document !== "undefined") document.documentElement.lang = current
export function getLang() {
  return current
}
export function setLang(next) {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
  document.documentElement.lang = next
  listeners.forEach((l) => l())
}
export function subscribeLang(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** Returns the Tagalog or English text for the current language. */
export function tr(tl, en) {
  return current === "en" ? en : tl
}
