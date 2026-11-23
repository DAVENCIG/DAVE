import { useSyncExternalStore } from "react"
import {
  DEFAULT_GRADE_ID,
  getDailyChallengeTopic,
  getGrade,
  getTopic,
  getTopicsByGrade,
} from "../data"
import { evaluateBadges } from "./achievements"
import { todayKey } from "./date"
import { sanitizeProgress } from "./progressSchema"
export const INITIAL_POINTS = 50
export const POINTS_PER_CORRECT = 10
export const CHALLENGE_BONUS = 20
const STORAGE_KEY = "pamana.progress.v1"
const MAX_ATTEMPTS = 100
const MAX_ACTIVE_DAYS = 120
const EMPTY_TOPIC = {
  lessonRead: false,
  bestCorrect: 0,
  bestPercent: 0,
  attempts: 0,
}
function defaults() {
  return {
    version: 1,
    selectedGradeId: null,
    onboardingCompleted: false,
    points: INITIAL_POINTS,
    recentTopicId: null,
    topics: {},
    attempts: [],
    activeQuizzes: {},
    challengeCompletedOn: null,
    rating: null,
    challengeCount: 0,
    activeDays: [],
    quizSettings: { shuffle: true },
  }
}
/** Parses saved progress JSON; returns null when it is not a valid version-1 save. */
function parse(raw, importing = false) {
  try {
    return sanitizeProgress(
      JSON.parse(raw),
      defaults(),
      importing ? (id) => !!getTopic(id) : undefined,
    )
  } catch {
    return null
  }
}
const CORRUPT_KEY = "pamana.progress.v1.corrupt"
function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults()
    const parsed = parse(raw)
    if (parsed) return parsed
    // Unreadable save: keep a copy before the next write replaces it, so it can be recovered.
    if (!window.localStorage.getItem(CORRUPT_KEY))
      window.localStorage.setItem(CORRUPT_KEY, raw)
    return defaults()
  } catch {
    return defaults()
  }
}
let state = typeof window === "undefined" ? defaults() : load()
let persistent = true
const listeners = new Set()
function commit(next) {
  state = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    persistent = true
  } catch {
    // Storage can be unavailable (private mode, quota). Keep working in memory.
    persistent = false
  }
  listeners.forEach((listener) => listener())
}
function update(fn) {
  commit(fn(state))
}
if (typeof window !== "undefined") {
  // Keep multiple open tabs in sync.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return
    state = load()
    listeners.forEach((listener) => listener())
  })
}
function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function useProgress() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}
export function isProgressPersistent() {
  return persistent
}
export function getTopicProgress(s, topicId) {
  return s.topics[topicId] ?? EMPTY_TOPIC
}
export function getActiveQuiz(s, topic) {
  const active = s.activeQuizzes[topic.id]
  if (!active) return undefined
  // Discard saved quizzes whose questions no longer exist after a content update.
  const valid = active.questionIds.every((id) =>
    topic.questions.some((q) => q.id === id),
  )
  return valid ? active : undefined
}
export function quizMode(quiz) {
  return quiz.mode ?? "normal"
}
/** Display order of a question's options: position -> original option index. */
export function getOptionOrder(quiz, questionId, optionCount) {
  const order = quiz.optionOrder?.[questionId]
  const identity = Array.from({ length: optionCount }, (_, i) => i)
  // Fall back to the authored order if the saved order no longer matches the content.
  if (!order || order.length !== optionCount) return identity
  const valid = [...order].sort((a, b) => a - b).every((v, i) => v === i)
  return valid ? order : identity
}
export function getTopicAttempts(s, topicId) {
  return s.attempts.filter((a) => a.topicId === topicId)
}
export function useCurrentGrade() {
  const s = useProgress()
  return getGrade(s.selectedGradeId) ?? getGrade(DEFAULT_GRADE_ID)
}
/** The topic to resume: the last opened topic in this grade, else the first unfinished one. */
export function getResumeTopic(s, gradeId) {
  const recent = getTopic(s.recentTopicId)
  if (recent && recent.gradeId === gradeId) return recent
  const list = getTopicsByGrade(gradeId)
  return (
    list.find((t) => getTopicProgress(s, t.id).bestPercent < 100) ?? list[0]
  )
}
function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
function shuffled(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
function buildQuiz(topic, questionIds, mode, shuffle) {
  const optionOrder = {}
  if (shuffle) {
    for (const id of questionIds) {
      const q = topic.questions.find((x) => x.id === id)
      if (q) optionOrder[id] = shuffled(q.options.map((_, i) => i))
    }
  }
  return {
    topicId: topic.id,
    questionIds: shuffle ? shuffled(questionIds) : questionIds,
    index: 0,
    selectedIndex: null,
    submitted: false,
    answers: [],
    startedAt: new Date().toISOString(),
    mode,
    optionOrder,
    elapsedMs: 0,
  }
}
function patchTopic(s, topicId, patch) {
  return {
    ...s,
    topics: {
      ...s.topics,
      [topicId]: { ...getTopicProgress(s, topicId), ...patch },
    },
  }
}
export const progress = {
  selectGrade(gradeId) {
    update((s) => ({
      ...s,
      selectedGradeId: gradeId,
      onboardingCompleted: true,
    }))
  },
  setRecentTopic(topicId) {
    if (state.recentTopicId === topicId) return
    update((s) => ({ ...s, recentTopicId: topicId }))
  },
  markLessonRead(topicId) {
    if (getTopicProgress(state, topicId).lessonRead) return
    update((s) => patchTopic(s, topicId, { lessonRead: true }))
  },
  /** Starts a quiz, or keeps the saved one unless `restart` is true. */
  startQuiz(topic, restart = false) {
    if (!restart && getActiveQuiz(state, topic)) return
    const quiz = buildQuiz(
      topic,
      topic.questions.map((q) => q.id),
      "normal",
      state.quizSettings.shuffle,
    )
    update((s) => ({
      ...s,
      activeQuizzes: { ...s.activeQuizzes, [topic.id]: quiz },
    }))
  },
  /**
   * Starts a practice round with only the given questions (typically the ones answered wrong).
   * Practice rounds never change points or best scores. Returns false if nothing can be practised.
   */
  startPractice(topic, questionIds) {
    const ids = questionIds.filter((id) =>
      topic.questions.some((q) => q.id === id),
    )
    if (ids.length === 0) return false
    const quiz = buildQuiz(topic, ids, "practice", true)
    update((s) => ({
      ...s,
      activeQuizzes: { ...s.activeQuizzes, [topic.id]: quiz },
    }))
    return true
  },
  /** Adds active answering time to the saved quiz. */
  addQuizTime(topicId, ms) {
    const current = state.activeQuizzes[topicId]
    if (!current || ms <= 0) return
    // Cap a single slice so a sleeping device does not inflate the timer.
    const delta = Math.min(ms, 5 * 60_000)
    update((s) => ({
      ...s,
      activeQuizzes: {
        ...s.activeQuizzes,
        [topicId]: { ...current, elapsedMs: (current.elapsedMs ?? 0) + delta },
      },
    }))
  },
  setShuffle(shuffle) {
    update((s) => ({ ...s, quizSettings: { ...s.quizSettings, shuffle } }))
  },
  saveQuiz(topicId, patch) {
    const current = state.activeQuizzes[topicId]
    if (!current) return
    update((s) => ({
      ...s,
      activeQuizzes: {
        ...s.activeQuizzes,
        [topicId]: { ...current, ...patch },
      },
    }))
  },
  /**
   * Finalises the saved quiz exactly once. Points are earned only for correct answers beyond the
   * learner's previous best on this topic, so retaking a quiz cannot farm points. Practice rounds
   * are recorded for review but never change points or best scores.
   */
  completeQuiz(topicId) {
    const active = state.activeQuizzes[topicId]
    if (!active || active.answers.length < active.questionIds.length)
      return null
    const mode = quizMode(active)
    const practice = mode === "practice"
    const correct = active.answers.filter((a) => a.correct).length
    const total = active.questionIds.length
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0
    const previous = getTopicProgress(state, topicId)
    const today = todayKey()
    const isChallenge = getDailyChallengeTopic(today).id === topicId
    const bonusAwarded =
      !practice && isChallenge && state.challengeCompletedOn !== today
        ? CHALLENGE_BONUS
        : 0
    const pointsAwarded = practice
      ? 0
      : Math.max(0, correct - previous.bestCorrect) * POINTS_PER_CORRECT
    const attempt = {
      id: newId(),
      topicId,
      correct,
      total,
      percent,
      pointsAwarded,
      bonusAwarded,
      previousBestCorrect: previous.bestCorrect,
      completedAt: new Date().toISOString(),
      answers: active.answers,
      mode,
      durationMs: active.elapsedMs ?? 0,
      pointsBefore: state.points,
      unlockedBadges: [],
    }
    const before = new Set(evaluateBadges(state))
    update((s) => {
      const { [topicId]: _finished, ...remaining } = s.activeQuizzes
      const withTopic = practice
        ? s
        : patchTopic(s, topicId, {
            bestCorrect: Math.max(previous.bestCorrect, correct),
            bestPercent: Math.max(previous.bestPercent, percent),
            attempts: previous.attempts + 1,
          })
      const next = {
        ...withTopic,
        activeQuizzes: remaining,
        attempts: [attempt, ...s.attempts].slice(0, MAX_ATTEMPTS),
        points: s.points + pointsAwarded + bonusAwarded,
        challengeCompletedOn: bonusAwarded > 0 ? today : s.challengeCompletedOn,
        challengeCount: s.challengeCount + (bonusAwarded > 0 ? 1 : 0),
        activeDays: s.activeDays.includes(today)
          ? s.activeDays
          : [today, ...s.activeDays].slice(0, MAX_ACTIVE_DAYS),
      }
      // Record which badges this attempt unlocked so the result page can celebrate them later.
      attempt.unlockedBadges = evaluateBadges(next).filter(
        (id) => !before.has(id),
      )
      return next
    })
    return attempt
  },
  setRating(rating) {
    update((s) => ({ ...s, rating }))
  },
  reset() {
    commit(defaults())
  },
  /** Progress as a JSON backup that can be restored with `importBackup`. */
  exportBackup() {
    return JSON.stringify(state, null, 2)
  },
  /** Validates a backup without applying it; returns what it contains, or null if invalid. */
  previewBackup(raw) {
    const next = parse(raw, true)
    if (!next) return null
    return {
      points: next.points,
      lessonsRead: Object.values(next.topics).filter((t) => t.lessonRead)
        .length,
      attempts: next.attempts.length,
    }
  },
  /** Replaces progress with a backup. Returns false if the file is not a PAMANA backup. */
  importBackup(raw) {
    const next = parse(raw, true)
    if (!next) return false
    commit(next)
    return true
  },
}
