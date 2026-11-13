/**
 * Animation primitives, easing curves and time-of-day color palettes,
 * ported 1:1 from the stripe.com stats-section DataViz module
 * (webpack modules 40428 + 80931).
 */
import { Color, Vector2, MathUtils } from 'three'

/* ------------------------------------------------------------------ */
/* Helpers (module 80931)                                              */
/* ------------------------------------------------------------------ */

export function createSeededRandom(seed = 1) {
  let state = 0 | ((4294967296 * seed) >>> 0)
  const next = () => {
    state = (state + 2654435769) | 0
    let t = state ^ (state >>> 16)
    t = Math.imul(t, 569420461)
    t ^= t >>> 15
    t = Math.imul(t, 1935289751)
    t = (t ^ (t >>> 15)) >>> 0
    return t / 4294967296
  }
  return {
    randFloat: (e: number, t: number) => next() * (t - e) + e,
    randInt: (e: number, t: number) =>
      Math.floor(next() * (t - e + 1)) + e,
  }
}

/** normalize: clamp((v - start) / (end - start), 0, 1) */
export const normalize = (start: number, end: number, v: number) =>
  MathUtils.clamp((v - start) / (end - start), 0, 1)

/** map a value from one range to another */
export const mapRange = (
  e: number,
  t: number,
  n: number,
  i: number,
  o: number,
) => (o - e) * (i - n) / (t - e) + n

export function median(values: number[]) {
  if (!values.length) return
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function mean(values: number[]) {
  if (values.length) return values.reduce((a, b) => a + b) / values.length
}

/* ------------------------------------------------------------------ */
/* Animation manager (class o) + tween (class r)                       */
/* ------------------------------------------------------------------ */

interface ManagedAnimation {
  startTime: number
  startDelay: number
  started: boolean
  complete: boolean
  val: number
  lastUpdate: number
  integrate: (seconds: number) => void
  startFn: (val: number) => void
  updateFn: (val: number) => void
  completeFn: (val: number) => void
}

export class AnimationManager {
  animations: ManagedAnimation[] = []
  paused = false

  pause = () => {
    this.paused = true
  }

  resume = () => {
    if (this.paused) {
      this.paused = false
      requestAnimationFrame(this.tick)
    }
  }

  tick = (t: number) => {
    if (!this.paused) {
      requestAnimationFrame(this.tick)
      this.update(t)
    }
  }

  update = (t: number) => {
    const completed: ManagedAnimation[] = []
    const now = performance.now()
    this.animations.forEach((anim) => {
      if (t - anim.startTime < anim.startDelay) return
      if (!anim.started) {
        anim.started = true
        anim.startTime = now
        anim.lastUpdate = now
        anim.startFn(anim.val)
      }
      if (anim.complete) {
        completed.push(anim)
        anim.completeFn(anim.val)
        return
      }
      const dt = now - anim.lastUpdate
      anim.integrate(dt / 1e3)
      anim.updateFn(anim.val)
      anim.lastUpdate = now
    })
    this.animations = this.animations.filter((a) => !completed.includes(a))
  }

  add = (anim: ManagedAnimation) => {
    if (this.paused || this.animations.indexOf(anim) !== -1) return
    this.animations.push(anim)
  }

  remove = (anim: ManagedAnimation) => {
    const i = this.animations.indexOf(anim)
    if (i !== -1) this.animations.splice(i, 1)
  }

  constructor() {
    requestAnimationFrame(this.tick)
  }
}

export class Animation implements ManagedAnimation {
  static manager: AnimationManager | null = null

  start = (delay?: number) => {
    this.startDelay = delay || 0
    if (!Animation.manager) Animation.manager = new AnimationManager()
    Animation.manager.add(this)
  }
  integrate = (seconds: number) => {
    this.elapsed += seconds
    const t = (this.elapsed - this.startDelay) / this.duration
    this.val = Math.max(Math.min(t, 1), 0)
    if (this.val === 1) this.complete = true
  }

  stop = () => {
    this.val = 1
    this.updateFn(1)
    this.complete = true
  }

  cancel = () => {
    this.complete = true
  }

  val = 0
  duration: number
  startTime = 0
  startDelay = 0
  lastUpdate = 0
  complete = false
  started = false
  startFn: (val: number) => void = () => {}
  updateFn: (val: number) => void = () => {}
  completeFn: (val: number) => void = () => {}
  elapsed = 0

  constructor(duration: number) {
    this.duration = duration
  }
}

export const easing = {
  inSine: (e: number) => 1 - Math.cos((Math.PI / 2) * e),
  outSine: (e: number) => Math.sin((Math.PI / 2) * e),
  inOutSine: (e: number) => -0.5 * (Math.cos(Math.PI * e) - 1) + 0,
  inExpo: (e: number) => (e === 0 ? 0 : 2 ** (10 * (e - 1))),
  outExpo: (e: number) => (e === 1 ? 1 : 1 - 2 ** (-10 * e)),
  inOutExpo: (e: number) =>
    e === 0
      ? 0
      : e === 1
        ? 1
        : e < 0.5
          ? 0.5 * 2 ** (10 * (2 * e - 1)) + 0
          : 0.5 * (-(2 ** (-10 * (e / 0.5 - 1))) + 2) + 0,
  outBack: (e: number, t?: number) => {
    const a = e - 1
    const s = t || 1.70158
    return a * a * ((s + 1) * a + s) + 1
  },
  inQuad: (e: number) => e * e,
  outQuad: (e: number) => -e * (e - 2),
  inOutQuad: (e: number) => (e < 0.5 ? e * e * 2 : 4 * e - 2 * e * e - 1),
  inQuart: (e: number) => e * e * e * e,
  outQuart: (e: number) => {
    const t = e - 1
    return 1 - t * t * t * t
  },
  inOutQuart: (e: number) => {
    const t = 2 * e
    if (t < 1) return 0.5 * t * t * t * t
    const u = t - 2
    return 1 - 0.5 * (u * u * u * u)
  },
  outQuint: (e: number) => {
    const t = e - 1
    return t * t * t * t * t + 1
  },
  inQuint: (e: number) => e * e * e * e * e,
  inOutQuint: (e: number) => {
    const t = 2 * e
    if (t < 1) return 0.5 * t * t * t * t * t
    const u = t - 2
    return 0.5 * (u * u * u * u * u) + 1
  },
  inElastic: (e: number) =>
    Math.sin((Math.PI / 2) * 13 * e) * 2 ** (10 * (e - 1)),
  outElastic: (e: number) =>
    Math.sin(-((Math.PI / 2) * 13) * (e + 1)) * 2 ** (-10 * e) + 1,
}

/* ------------------------------------------------------------------ */
/* Gradient palettes (classes y / b / x)                               */
/* ------------------------------------------------------------------ */

export interface GradientPalette {
  colorTop: Color
  colorBottom: Color
  colorStop: Vector2
}

export class GradientPaletteImpl implements GradientPalette {
  colorTop: Color
  colorBottom: Color
  colorStop: Vector2

  constructor(colorTop: string | Color, colorBottom: string | Color, colorStop: Vector2) {
    this.colorTop = new Color(colorTop)
    this.colorBottom = new Color(colorBottom)
    this.colorStop = colorStop
  }

  static lerp(a: GradientPalette, b: GradientPalette, t: number) {
    return new GradientPaletteImpl(
      a.colorTop.clone().lerp(b.colorTop, t),
      a.colorBottom.clone().lerp(b.colorBottom, t),
      a.colorStop.clone().lerp(b.colorStop, t),
    )
  }
}

export const TIME_OF_DAY_VALUES = [
  'pre-dawn',
  'sunrise',
  'daytime',
  'dusk',
  'sunset',
  'night',
] as const

export type TimeOfDay = (typeof TIME_OF_DAY_VALUES)[number]

export function getTimeOfDayFromDate(date = new Date()): TimeOfDay {
  const hours = date.getHours()
  if (hours >= 5 && hours < 8) return 'pre-dawn'
  if (hours >= 8 && hours < 11) return 'sunrise'
  if (hours >= 11 && hours < 16) return 'daytime'
  if (hours >= 16 && hours < 20) return 'dusk'
  if (hours >= 20 && hours < 23) return 'sunset'
  return 'night'
}

const vectorStop = (x: number, y: number) => new Vector2(x, y)

export const TIME_OF_DAY_PALETTES: Record<TimeOfDay, GradientPalette> = {
  'pre-dawn': new GradientPaletteImpl('#d91aff', '#0008ff', vectorStop(0, 0.75)),
  sunrise: new GradientPaletteImpl('#ff29b0', '#9435ed', vectorStop(0, 0.75)),
  daytime: new GradientPaletteImpl('#66c9ff', '#0000db', vectorStop(0, 0.75)),
  dusk: new GradientPaletteImpl('#66c9ff', '#0000ff', vectorStop(0, 0.75)),
  sunset: new GradientPaletteImpl('#f394ff', '#5b24db', vectorStop(0, 0.75)),
  night: new GradientPaletteImpl('#ffffff', '#FFFFFF', vectorStop(0, 0.66)),
}

export const DEFAULT_PALETTE = TIME_OF_DAY_PALETTES.night
