import { useSyncExternalStore } from "react"
export const PREFS_KEY = "pamana-prefs"
const DEFAULTS = {
  theme: "system",
  textSize: "normal",
  reduceMotion: false,
  showAltTerms: true,
}
const listeners = new Set()
function load() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}
let prefs = load()
const darkQuery =
  typeof matchMedia !== "undefined"
    ? matchMedia("(prefers-color-scheme: dark)")
    : null
/** Mirrors preferences onto <html> so CSS can react; index.html runs the same logic before paint. */
function apply() {
  const root = document.documentElement
  const dark =
    prefs.theme === "dark" || (prefs.theme === "system" && !!darkQuery?.matches)
  root.dataset.theme = dark ? "dark" : "light"
  root.dataset.textSize = prefs.textSize
  if (prefs.reduceMotion) root.dataset.motion = "reduce"
  else delete root.dataset.motion
}
if (typeof document !== "undefined") {
  apply()
  darkQuery?.addEventListener("change", () => {
    if (prefs.theme === "system") apply()
  })
}
export function setPreference(key, value) {
  prefs = { ...prefs, [key]: value }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Applies for this visit only.
  }
  apply()
  listeners.forEach((l) => l())
}
export function resetPreferences() {
  prefs = DEFAULTS
  try {
    localStorage.removeItem(PREFS_KEY)
  } catch {
    // Nothing stored.
  }
  apply()
  listeners.forEach((l) => l())
}
function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function usePreferences() {
  return useSyncExternalStore(
    subscribe,
    () => prefs,
    () => prefs,
  )
}
