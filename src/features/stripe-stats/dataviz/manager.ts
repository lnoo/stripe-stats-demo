/**
 * DataVizManager — ported 1:1 from webpack module 40428 (`eC`) plus the
 * render loop / renderer capability helpers from module 90126 and the
 * WebGL support probe from module 84712.
 */
import {
  CanvasTexture,
  PerspectiveCamera,
  Vector2,
  WebGLRenderer,
} from 'three'

import { Animation, DEFAULT_PALETTE, type GradientPalette } from './animation'
import {
  PaymentMethodsScene,
  PaymentsVolumeScene,
  SubscriptionsScene,
  UptimeScene,
  type DataVizScene,
} from './scenes'

/* ------------------------------------------------------------------ */
/* WebGL capability probe (module 84712)                               */
/* ------------------------------------------------------------------ */

const BLOCKLISTED_GPUS = [
  'geforce 320m',
  'geforce 8600',
  'geforce 8600m gt',
  'geforce 8800 gs',
  'geforce 8800 gt',
  'geforce 9400',
  'geforce 9400m g',
  'geforce 9400m',
  'geforce 9600m gt',
  'geforce 9600m',
  'geforce fx go5200',
  'geforce gt 120',
  'geforce gt 130',
  'geforce gt 330m',
  'geforce gtx 285',
  'google swiftshader',
  'intel g41',
  'intel g45',
  'intel gma 4500mhd',
  'intel gma x3100',
  'intel hd 3000',
  'intel q45',
  'legacy',
  'mali-2',
  'mali-3',
  'mali-4',
  'quadro fx 1500',
  'quadro fx 4',
  'quadro fx 5',
  'radeon hd 2400',
  'radeon hd 2600',
  'radeon hd 4670',
  'radeon hd 4850',
  'radeon hd 4870',
  'radeon hd 5670',
  'radeon hd 5750',
  'radeon hd 6290',
  'radeon hd 6300',
  'radeon hd 6310',
  'radeon hd 6320',
  'radeon hd 6490m',
  'radeon hd 6630m',
  'radeon hd 6750m',
  'radeon hd 6770m',
  'radeon hd 6970m',
  'sgx 543',
  'sgx543',
]

const LOW_END_APPLE_CHIPS = ['a7', 'a8', 'a9', 'a10']
const LOW_END_ADRENO_MODELS = [
  205, 220, 225, 302, 303, 304, 305, 306, 308, 320, 330, 405, 418, 420, 430,
  505, 506,
]
const LOW_END_MALI_PATTERNS = [
  /mali-[234]/i,
  /mali-t[67]\d{2}/i,
  /mali-t8[0-6]\d/i,
  /mali-g3[01]/i,
  /mali-g5[01]/i,
]

export interface WebGlSupportResult {
  supported: boolean
  reason: string
}

let cachedWebGlSupport: WebGlSupportResult | null = null

function detectWebGlSupport(): WebGlSupportResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const { userAgent, platform, maxTouchPoints } = window.navigator
  const isAppleMobile = /(iphone|ipod|ipad)/i.test(userAgent)
  const isIpad =
    platform === 'iPad' ||
    (platform === 'MacIntel' && maxTouchPoints > 0 && !('MSStream' in window))
  const isMobile = /android/i.test(userAgent) || isAppleMobile || isIpad
  const isSafari12 = /Version\/12.+Safari/.test(userAgent)

  const contextAttributes: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: true,
    stencil: false,
  }
  if (!isSafari12) {
    contextAttributes.powerPreference = 'high-performance'
  }
  const probeCanvas = window.document.createElement('canvas')
  const gl =
    probeCanvas.getContext('webgl', contextAttributes) ??
    probeCanvas.getContext('experimental-webgl', contextAttributes)
  if (!gl) {
    return { supported: false, reason: 'WebGL not supported' }
  }
  const glContext = gl as WebGLRenderingContext
  const debugInfo = glContext.getExtension('WEBGL_debug_renderer_info')
  let rendererName = ''
  if (debugInfo) {
    rendererName =
      (glContext.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) || ''
  }
  if (!rendererName) {
    rendererName = (glContext.getParameter(glContext.RENDERER) as string) || ''
  }
  const normalized = rendererName
    .toLowerCase()
    .replace(/.*angle ?\((.+)\)(?: on vulkan [0-9.]+)?$/i, '$1')
    .replace(/\s(\d{1,2}gb|direct3d.+$)|\(r\)| \([^)]+\)$/g, '')
    .replace(/(?:vulkan|opengl) \d+\.\d+(?:\.\d+)?(?: \((.*)\))?/, '$1')
    .replace(/angle metal renderer: apple (m\d+(?:\s+(?:pro|max|ultra))?)/i, 'apple $1')

  if (BLOCKLISTED_GPUS.some((gpu) => normalized.includes(gpu))) {
    return { supported: false, reason: `Blocklisted GPU: ${normalized}` }
  }
  const appleChip = normalized.match(/apple (a\d+|m\d+(?:\s+(?:pro|max|ultra))?)/i)
  if (
    isMobile &&
    appleChip &&
    LOW_END_APPLE_CHIPS.some((chip) => appleChip[1].toLowerCase().startsWith(chip))
  ) {
    return { supported: false, reason: `Low-end Apple mobile chip: ${normalized}` }
  }
  const adreno = normalized.match(/adreno[- ]?(\d+)/i)
  if (adreno && LOW_END_ADRENO_MODELS.includes(parseInt(adreno[1], 10))) {
    return { supported: false, reason: `Low-end Adreno GPU: ${normalized}` }
  }
  if (LOW_END_MALI_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { supported: false, reason: `Low-end Mali GPU: ${normalized}` }
  }
  if (/powervr\s*(sgx|series\s*[456])/i.test(normalized)) {
    return { supported: false, reason: 'Low-end PowerVR GPU' }
  }
  if (/intel.*(gma|g4[15]|q45|hd 3000|hd graphics 3000)/i.test(normalized)) {
    return { supported: false, reason: 'Low-end Intel GPU' }
  }
  if (/geforce.*(8\d{3}|9\d{3}|gt\s*[123]\d{2})/i.test(normalized)) {
    return { supported: false, reason: 'Low-end NVIDIA GPU' }
  }
  if (/radeon.*(hd\s*[2-5]\d{3})/i.test(normalized)) {
    return { supported: false, reason: 'Low-end AMD GPU' }
  }
  void started
  return { supported: true, reason: `Capable GPU: ${normalized}` }
}

/**
 * Returns null until the (cached) probe has run, mirroring Stripe's hook.
 */
export function getWebGlSupport(): WebGlSupportResult {
  if (!cachedWebGlSupport) {
    cachedWebGlSupport = detectWebGlSupport()
  }
  return cachedWebGlSupport
}

/* ------------------------------------------------------------------ */
/* Render loop (module 90126)                                          */
/* ------------------------------------------------------------------ */

const KNOWN_REFRESH_RATES = [240, 160, 144, 120, 60, 30, 24]

class RenderLoopHandle {
  frameCount = 0
  frameInterval = 1
  initialFrameInterval = 1
  renderFunction: (elapsed: number) => void
  onPerformanceWarning = (level: number) => {
    this.frameInterval = Math.max(level + 1, this.frameInterval)
  }
  onPerformanceRecovered = (level: number) => {
    this.frameInterval = Math.max(level + 1, this.initialFrameInterval)
  }
  onRenderSuspended = (_reason: string) => {}
  onRenderResumed = (_reason: string) => {}

  constructor(renderFunction: (elapsed: number) => void) {
    this.renderFunction = renderFunction
  }

  start() {
    RenderLoopController.instance.addRenderLoop(this)
  }

  stop() {
    RenderLoopController.instance.removeRenderLoop(this)
  }

  get suspended() {
    return RenderLoopController.instance.suspended
  }
}

class RenderLoopController {
  private static _instance: RenderLoopController | null = null
  static get instance() {
    if (!RenderLoopController._instance) {
      RenderLoopController._instance = new RenderLoopController()
    }
    return RenderLoopController._instance
  }

  private _frameTimes: number[] = []
  private _lastFrameTime = 0
  private _resumedTime: number | null = null
  private _elapsedTime = 0
  private _renderLoops = new Set<RenderLoopHandle>()
  private _warningLevel = 0
  private _suspended = false
  private _rafId: number | null = null
  private _estimatedRefreshRate: number | undefined
  private _estimatedRefreshRateTimeStamp: number | undefined

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.suspend('visibility')
    } else {
      this.resume('visibility')
    }
  }

  private startLoop = () => {
    if (!this._rafId && !this._suspended) {
      this._lastFrameTime = performance.now()
      this._resumedTime = null
      this._rafId = requestAnimationFrame(this.update)
    }
  }

  private stopLoop = () => {
    if (this._rafId) cancelAnimationFrame(this._rafId)
    this._rafId = null
  }

  private update = (t: number) => {
    this._rafId = requestAnimationFrame(this.update)
    const delta = t - this._lastFrameTime
    this._lastFrameTime = t
    this._frameTimes.push(delta)
    if (this._frameTimes.length >= 12 && !this._estimatedRefreshRate) {
      this._estimatedRefreshRate = this.getEstimatedRefreshRate()
      this._estimatedRefreshRateTimeStamp = performance.now()
      this._frameTimes = []
    } else if (this._estimatedRefreshRate && this._estimatedRefreshRateTimeStamp) {
      if (this._resumedTime === null) {
        this._resumedTime = t - this._elapsedTime
      }
      this._elapsedTime = Math.max(t - this._resumedTime, 0)
      this._renderLoops.forEach((loop) => {
        loop.frameCount += 1
        if (loop.frameCount % loop.frameInterval === 0) {
          loop.renderFunction(this._elapsedTime)
        }
      })
      if (this._frameTimes.length >= 24) {
        const sorted = this._frameTimes.slice().sort((a, b) => a - b)
        sorted.splice(-2)
        const average =
          sorted.reduce((a, b) => a + b, 0) / Math.max(sorted.length, 1)
        const fps = 1e3 / average
        const drift = this._estimatedRefreshRate - fps
        if (drift > 0.1 * this._estimatedRefreshRate) {
          const level = Math.min(this._warningLevel + 1, 3)
          if (this._warningLevel !== level) {
            this._warningLevel = level
            this._renderLoops.forEach((loop) => loop.onPerformanceWarning(level))
          }
        } else if (drift < 0 && this._warningLevel > 0) {
          const level = this._warningLevel - 1
          this._warningLevel = level
          this._renderLoops.forEach((loop) => loop.onPerformanceRecovered?.(level))
        }
        this._frameTimes = []
      }
    }
  }

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.startLoop()
  }

  addRenderLoop(loop: RenderLoopHandle) {
    RenderLoopController.instance._renderLoops.add(loop)
  }

  removeRenderLoop(loop: RenderLoopHandle) {
    RenderLoopController.instance._renderLoops.delete(loop)
  }

  private suspend(reason: string) {
    this._renderLoops.forEach((loop) => loop.onRenderSuspended?.(reason))
    this.stopLoop()
  }

  private resume(reason: string) {
    this._lastFrameTime = performance.now()
    this._renderLoops.forEach((loop) => loop.onRenderResumed?.(reason))
    this.startLoop()
  }

  private getEstimatedRefreshRate() {
    if (!this._frameTimes.length) return
    const estimated = 1e3 / median(this._frameTimes)
    return KNOWN_REFRESH_RATES.reduce((best, rate) =>
      Math.abs(rate - estimated) < Math.abs(best - estimated) ? rate : best,
    )
  }

  get suspended() {
    return RenderLoopController.instance._suspended
  }
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function createRenderLoop(
  renderFunction: (elapsed: number) => void,
  frameInterval = 1,
) {
  const loop = new RenderLoopHandle(renderFunction)
  loop.frameInterval = frameInterval
  loop.initialFrameInterval = frameInterval
  return loop
}

/* ------------------------------------------------------------------ */
/* Renderer capability check (module 90126 `Us`)                       */
/* ------------------------------------------------------------------ */

const REQUIRED_EXTENSIONS = [
  'EXT_color_buffer_float',
  'EXT_texture_filter_anisotropic',
  'WEBGL_debug_renderer_info',
  'WEBGL_debug_shaders',
]

function createRenderer(canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer | null = null
  let hasMajorPerformanceCaveat = false
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
    })
  } catch {
    hasMajorPerformanceCaveat = true
  }
  if (!renderer) {
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      })
    } catch {
      /* renderer stays null */
    }
  }
  let hasRequiredCapabilities = false
  if (renderer) {
    const capabilities = renderer.capabilities
    const extensions = renderer.extensions
    hasRequiredCapabilities =
      capabilities.isWebGL2 &&
      capabilities.maxVertexTextures > 0 &&
      capabilities.maxTextureSize >= 4096 &&
      capabilities.maxVertexUniforms >= 256 &&
      capabilities.maxFragmentUniforms >= 256 &&
      REQUIRED_EXTENSIONS.every((name) => extensions.get(name) !== null)
  }
  return { renderer, hasMajorPerformanceCaveat, hasRequiredCapabilities }
}

/* ------------------------------------------------------------------ */
/* Circle sprite texture (module 40428 `ej`)                           */
/* ------------------------------------------------------------------ */

function createCircleTexture({ devicePixelRatio = 1 }: { devicePixelRatio?: number }) {
  const size = 12 * Math.ceil(devicePixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, size, size)
    const cx = size / 2
    const cy = size / 2
    const radius = size / 2 - 4
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
    ctx.fillStyle = 'red'
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/* ------------------------------------------------------------------ */
/* DataVizManager (module 40428 `eC`)                                  */
/* ------------------------------------------------------------------ */

const requestIdle: (cb: () => void) => number =
  typeof requestIdleCallback !== 'undefined'
    ? (cb) => requestIdleCallback(cb)
    : (cb) => window.setTimeout(cb, 0) as unknown as number

const cancelIdle: (id: number) => void =
  typeof cancelIdleCallback !== 'undefined'
    ? (id) => cancelIdleCallback(id)
    : (id) => clearTimeout(id)

export const isMobileDevice =
  window.matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window

export class DataVizManager {
  activeIndex = 0
  animations: DataVizScene[] = []
  animationsInitialized: boolean[] = []
  currentColorPalette: GradientPalette = DEFAULT_PALETTE
  private resumeTime: number | null = null
  private lastRenderTime: number | null = null
  private runTime = 0
  private renderLoop: RenderLoopHandle | null = null
  private _paused = true
  private initialized = false
  private _preWarmId: number | null = null
  private animationIn: Animation | null = null
  private animationOut: Animation | null = null
  private isTransitioning = false
  private pauseOnTransitionComplete = false
  private canvas: HTMLCanvasElement
  renderer: WebGLRenderer
  camera: PerspectiveCamera
  paymentMethodsAnimation: PaymentMethodsScene
  paymentsVolumeAnimation: PaymentsVolumeScene
  uptimeAnimation: UptimeScene
  subscriptionsAnimation: SubscriptionsScene

  private updateAndRender = (t: number) => {
    if (!this.initialized || this.paused) return
    if (this.resumeTime === null) this.resumeTime = t
    if (this.lastRenderTime === null) this.lastRenderTime = t
    const now = t - this.resumeTime + this.runTime
    const delta = t - this.lastRenderTime
    this.lastRenderTime = t
    this.renderer.clearColor()
    this.renderer.clearDepth()
    this.animations.forEach((scene) => {
      if (!scene.paused) scene.updateAndRender(now, delta)
    })
  }

  constructor(canvas: HTMLCanvasElement) {
    if (isMobileDevice) {
      throw new Error('WebGL disabled on mobile device')
    }
    const { renderer, hasMajorPerformanceCaveat, hasRequiredCapabilities } =
      createRenderer(canvas)
    if (!renderer || !hasRequiredCapabilities || hasMajorPerformanceCaveat) {
      throw new Error('WebGL disabled based on capabilities check')
    }
    this.canvas = canvas
    this.renderer = renderer
    this.renderer.setClearColor(0, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.autoClear = false
    this.renderer.autoClearColor = false
    this.renderer.autoClearDepth = false
    this.camera = new PerspectiveCamera(45, 1, 0.1, 1e3)
    this.camera.position.set(0, 0, 5)
    const circleTexture = createCircleTexture({
      devicePixelRatio: this.renderer.getPixelRatio(),
    })
    this.paymentMethodsAnimation = new PaymentMethodsScene({
      canvas,
      renderer,
      camera: this.camera,
      circleTexture,
      colorPalette: DEFAULT_PALETTE,
    })
    this.paymentsVolumeAnimation = new PaymentsVolumeScene({
      canvas,
      renderer,
      camera: this.camera,
      circleTexture,
      colorPalette: DEFAULT_PALETTE,
    })
    this.uptimeAnimation = new UptimeScene({
      canvas,
      renderer,
      camera: this.camera,
      circleTexture,
      colorPalette: DEFAULT_PALETTE,
    })
    this.subscriptionsAnimation = new SubscriptionsScene({
      canvas,
      renderer,
      camera: this.camera,
      circleTexture,
      colorPalette: DEFAULT_PALETTE,
    })
    this.animations = [
      this.paymentMethodsAnimation,
      this.paymentsVolumeAnimation,
      this.uptimeAnimation,
      this.subscriptionsAnimation,
    ]
    this.animationsInitialized = this.animations.map(() => false)
    this.updateAndRender(0)
  }

  get paused() {
    return this._paused
  }

  set paused(value: boolean) {
    if (value) {
      if (this.isTransitioning) {
        this.pauseOnTransitionComplete = true
        return
      }
      this.runTime += (this.lastRenderTime || 0) - (this.resumeTime || 0)
      this.resumeTime = null
      this.lastRenderTime = null
    } else {
      this.pauseOnTransitionComplete = false
    }
    this.animations[this.activeIndex].paused = value
    this._paused = value
  }

  private initAnimationAtIndex(index: number) {
    if (this.animationsInitialized[index]) return
    const pixelRatio = this.renderer.getPixelRatio()
    const rect = this.canvas.getBoundingClientRect()
    const size = new Vector2(rect.width * pixelRatio, rect.height * pixelRatio)
    const scene = this.animations[index]
    scene.initScene()
    scene.resize(size)
    scene.setColorPalette(this.currentColorPalette, false)
    this.animationsInitialized[index] = true
  }

  initScene() {
    if (this.initialized) return
    const rect = this.canvas.getBoundingClientRect()
    this.renderer.setSize(rect.width, rect.height, false)
    this.camera.aspect = rect.width / rect.height
    this.camera.updateProjectionMatrix()
    this.initAnimationAtIndex(this.activeIndex)
    this.animations[this.activeIndex].addListeners()
    this.renderLoop = createRenderLoop((t) => {
      this.updateAndRender(t)
    })
    this.renderLoop.onRenderSuspended = () => {
      this.cancelAnimations()
    }
    this.renderLoop.frameInterval = 1
    this.renderLoop.start()
    this.initialized = true
    this.preWarmRemainingAnimations()
  }

  private preWarmRemainingAnimations() {
    const remaining = this.animations
      .map((_, index) => index)
      .filter((index) => !this.animationsInitialized[index])
    const step = () => {
      if (this._preWarmId !== null) this._preWarmId = null
      if (!this.initialized) return
      const next = remaining.shift()
      if (next === undefined) return
      this.initAnimationAtIndex(next)
      if (remaining.length > 0) {
        this._preWarmId = requestIdle(step)
      }
    }
    if (remaining.length > 0) this._preWarmId = requestIdle(step)
  }

  cancelAnimations() {
    if (this.animationIn) {
      Animation.manager?.remove(this.animationIn)
      this.animationIn.stop()
      this.animationIn.completeFn(1)
      this.animationIn = null
    }
    if (this.animationOut) {
      Animation.manager?.remove(this.animationOut)
      this.animationOut.stop()
      this.animationOut.completeFn(1)
      this.animationOut = null
    }
  }

  setAnimationIndex(index: number, animate = true) {
    if (index === this.activeIndex) return
    const previousIndex = this.activeIndex
    this.activeIndex = index
    this.cancelAnimations()
    this.isTransitioning = animate
    this.initAnimationAtIndex(index)
    const previousScene = this.animations[previousIndex]
    const nextScene = this.animations[index]
    previousScene.removeListeners()
    nextScene.addListeners()
    const points = previousScene.getPoints()
    const animationIn = nextScene.animateIn(points, () => {
      this.isTransitioning = false
      if (this.pauseOnTransitionComplete) {
        this.paused = true
      }
    })
    const animationOut = previousScene.animateOut(() => {
      previousScene.paused = true
      previousScene.reset()
    })
    if (!animate) {
      animationIn.updateFn(1)
      animationIn.completeFn(1)
      animationOut.updateFn(1)
      animationOut.completeFn(1)
      this.animations.forEach((scene, i) => {
        scene.paused = i !== this.activeIndex
      })
      return
    }
    animationIn.updateFn(0)
    animationOut.updateFn(0)
    animationIn.start()
    animationOut.start()
    this.animationIn = animationIn
    this.animationOut = animationOut
    previousScene.paused = false
    nextScene.paused = false
  }

  renderActive() {
    this.renderer.clearColor()
    this.renderer.clearDepth()
    this.animations[this.activeIndex].updateAndRender(
      (this.resumeTime || 0) + (this.runTime || 0),
      1 / 60,
    )
  }

  resize() {
    const pixelRatio = this.renderer.getPixelRatio()
    const rect = this.canvas.getBoundingClientRect()
    const size = new Vector2(rect.width, rect.height)
    const scaledSize = size.clone().multiplyScalar(pixelRatio)
    this.renderer.setSize(size.width, size.height, false)
    this.animations.forEach((scene, index) => {
      if (this.animationsInitialized[index]) {
        scene.resize(scaledSize)
      }
    })
    if (this._paused) this.renderActive()
  }

  setColorPalette(palette: GradientPalette, animate: boolean) {
    this.currentColorPalette = palette
    this.animations.forEach((scene, index) => {
      if (this.animationsInitialized[index]) {
        const isActive = this.activeIndex === index && animate
        scene.setColorPalette(palette, isActive)
      }
    })
    if (!animate && this.initialized) this.renderActive()
  }

  dispose() {
    if (this._preWarmId !== null) {
      cancelIdle(this._preWarmId)
      this._preWarmId = null
    }
    if (this.renderLoop) {
      this.renderLoop.stop()
      this.renderLoop = null
    }
    this.animations.forEach((scene, index) => {
      if (this.animationsInitialized[index]) {
        scene.dispose()
      }
    })
    this.renderer.dispose()
  }
}
