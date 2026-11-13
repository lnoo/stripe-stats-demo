/**
 * The four stats-section visualizations, ported 1:1 from the stripe.com
 * homepage DataViz bundle (webpack module 40428):
 *
 *   0. PaymentMethodsScene  — radial constellation of lines + dots
 *   1. PaymentsVolumeScene  — rotating globe of wrapping curves + dots
 *   2. UptimeScene          — wave field of vertical lines + pulse waves
 *   3. SubscriptionsScene   — flowing spline "rivers" with heartbeats
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Euler,
  Group,
  Line,
  LineSegments,
  MathUtils,
  NormalBlending,
  PerspectiveCamera,
  Plane,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'

import {
  Animation,
  easing,
  normalize,
  mapRange,
  createSeededRandom,
  GradientPaletteImpl,
  type GradientPalette,
} from './animation'

import {
  paymentMethodsDotsVertex,
  paymentMethodsDotsFragment,
  paymentMethodsLinesVertex,
  paymentMethodsLinesFragment,
  falloffLineVertex,
  falloffLineFragment,
  depthBasedDotsVertex,
  depthBasedDotsFragment,
  uptimeDotsVertex,
  uptimeDotsFragment,
  uptimeLinesVertex,
  uptimeLinesFragment,
  subscriptionsPointsVertex,
  subscriptionsPointsFragment,
  subscriptionsLinesVertex,
  subscriptionsLinesFragment,
} from './shaders'

/* ------------------------------------------------------------------ */
/* Shared resources                                                    */
/* ------------------------------------------------------------------ */

/**
 * Fibonacci-sphere points (module-level `c`) used as "mid points" while
 * dots travel between scenes.
 */
const FIB_SPHERE_POINTS: Vector3[] = (() => {
  const count = 400
  const scale = 12
  const points: Vector3[] = []
  const offset = 2 / count
  const increment = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i += 1) {
    const y = i * offset - 1 + offset / 2
    const r = Math.sqrt(1 - y * y)
    const phi = ((i + 1) % count) * increment
    const x = Math.cos(phi) * r
    const z = Math.sin(phi) * r
    points.push(
      new Vector3(
        x * scale + MathUtils.randFloat(-9, 9),
        y * scale + MathUtils.randFloat(-9, 9),
        z * scale - 90,
      ),
    )
  }
  return points
})()

export function getDomRect(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  if (getComputedStyle(canvas).getPropertyValue('position') === 'fixed') {
    return rect
  }
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height,
  )
}

/** BufferAttribute from a plain number array or typed array (values are copied). */
function numberAttribute(values: ArrayLike<number>, itemSize: number) {
  return new BufferAttribute(new Float32Array(values), itemSize)
}

/* ------------------------------------------------------------------ */
/* Simplex noise (2D + 3D), ported from the module's inline factories  */
/* ------------------------------------------------------------------ */

const GRAD2 = new Float64Array([
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0,
  -1,
])

const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0,
  -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
])

function shuffledPermutation(seed = Math.random) {
  const perm = new Uint8Array(512)
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 0; i < 255; i++) {
    const j = i + ~~(seed() * (256 - i))
    const t = perm[i]
    perm[i] = perm[j]
    perm[j] = t
  }
  for (let i = 256; i < 512; i++) perm[i] = perm[i - 256]
  return perm
}

export function createSimplexNoise2D(seed = Math.random) {
  const perm = shuffledPermutation(seed)
  const gradX = new Float64Array(perm).map((v) => GRAD2[(v % 12) * 2])
  const gradY = new Float64Array(perm).map((v) => GRAD2[(v % 12) * 2 + 1])
  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  return (xin: number, yin: number) => {
    let n0 = 0
    let n1 = 0
    let n2 = 0
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    let i1: number
    let j1: number
    if (x0 > y0) {
      i1 = 1
      j1 = 0
    } else {
      i1 = 0
      j1 = 1
    }
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 >= 0) {
      const gi0 = ii + perm[jj]
      t0 *= t0
      n0 = t0 * t0 * (gradX[gi0] * x0 + gradY[gi0] * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 >= 0) {
      const gi1 = ii + i1 + perm[jj + j1]
      t1 *= t1
      n1 = t1 * t1 * (gradX[gi1] * x1 + gradY[gi1] * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 >= 0) {
      const gi2 = ii + 1 + perm[jj + 1]
      t2 *= t2
      n2 = t2 * t2 * (gradX[gi2] * x2 + gradY[gi2] * y2)
    }
    return 70 * (n0 + n1 + n2)
  }
}

export function createSimplexNoise3D(seed = Math.random) {
  const perm = shuffledPermutation(seed)
  const gradX = new Float64Array(perm).map((v) => GRAD3[(v % 12) * 3])
  const gradY = new Float64Array(perm).map((v) => GRAD3[(v % 12) * 3 + 1])
  const gradZ = new Float64Array(perm).map((v) => GRAD3[(v % 12) * 3 + 2])
  const F3 = 1 / 3
  const G3 = 1 / 6
  return (xin: number, yin: number, zin: number) => {
    let n0 = 0
    let n1 = 0
    let n2 = 0
    let n3 = 0
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const z0 = zin - (k - t)
    let i1: number, j1: number, k1: number
    let i2: number, j2: number, k2: number
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0
      }
    }
    const x1 = x0 - i1 + G3
    const y1 = y0 - j1 + G3
    const z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3
    const y2 = y0 - j2 + 2 * G3
    const z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3
    const y3 = y0 - 1 + 3 * G3
    const z3 = z0 - 1 + 3 * G3
    const ii = i & 255
    const jj = j & 255
    const kk = k & 255
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0
    if (t0 < 0) n0 = 0
    else {
      const gi0 = ii + perm[jj + perm[kk]]
      t0 *= t0
      n0 = t0 * t0 * (gradX[gi0] * x0 + gradY[gi0] * y0 + gradZ[gi0] * z0)
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1
    if (t1 < 0) n1 = 0
    else {
      const gi1 = ii + i1 + perm[jj + j1 + perm[kk + k1]]
      t1 *= t1
      n1 = t1 * t1 * (gradX[gi1] * x1 + gradY[gi1] * y1 + gradZ[gi1] * z1)
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2
    if (t2 < 0) n2 = 0
    else {
      const gi2 = ii + i2 + perm[jj + j2 + perm[kk + k2]]
      t2 *= t2
      n2 = t2 * t2 * (gradX[gi2] * x2 + gradY[gi2] * y2 + gradZ[gi2] * z2)
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3
    if (t3 < 0) n3 = 0
    else {
      const gi3 = ii + 1 + perm[jj + 1 + perm[kk + 1]]
      t3 *= t3
      n3 = t3 * t3 * (gradX[gi3] * x3 + gradY[gi3] * y3 + gradZ[gi3] * z3)
    }
    return 32 * (n0 + n1 + n2 + n3)
  }
}

/* ------------------------------------------------------------------ */
/* Scene contracts                                                     */
/* ------------------------------------------------------------------ */

export interface DataVizScene {
  paused: boolean
  initScene: () => void
  addListeners: () => void
  removeListeners: () => void
  updateAndRender: (now: number, delta: number) => void
  resize: (size: Vector2) => void
  setColorPalette: (palette: GradientPalette, animate: boolean) => void
  getPoints: () => Vector3[]
  reset: () => void
  animateIn: (startPoints: Vector3[], onComplete: () => void) => Animation
  animateOut: (onComplete: () => void) => Animation
  dispose: () => void
}

interface SceneCtorArgs {
  canvas: HTMLCanvasElement
  renderer: WebGLRenderer
  camera: PerspectiveCamera
  circleTexture: CanvasTexture
  colorPalette: GradientPalette
}

/** Shared palette cross-fade behavior (identical in all four scenes). */
abstract class PaletteScene {
  colorPalette: GradientPalette
  colorAnimation: Animation | null = null
  protected abstract updateColorUniforms(palette: GradientPalette): void

  constructor(palette: GradientPalette) {
    this.colorPalette = palette
  }

  setColorPalette(palette: GradientPalette, animate: boolean) {
    if (this.colorAnimation) {
      Animation.manager?.remove(this.colorAnimation)
      this.colorAnimation = null
    }
    if (!animate) {
      this.updateColorUniforms(palette)
      this.colorPalette = palette
      return
    }
    const previous = this.colorPalette
    this.colorPalette = palette
    this.colorAnimation = new Animation(0.5)
    this.colorAnimation.updateFn = (t) => {
      this.updateColorUniforms(GradientPaletteImpl.lerp(previous, palette, t))
    }
    this.colorAnimation.start()
  }
}

/* ------------------------------------------------------------------ */
/* Scene 0 — PaymentMethods (radial constellation)                     */
/* ------------------------------------------------------------------ */

const PM_ORIGIN = new Vector3(0, -2.3, -0.4)

export class PaymentMethodsScene
  extends PaletteScene
  implements DataVizScene
{
  paused = true
  private introStartTime: number | null = null
  private introDuration = 1200
  private isIntroActive = true
  private rotationSpeed = { x: 1e-4, y: 1e-4, z: 0 }
  private enableRotation = false
  private totalLines = 810
  private minLineLength = 2.75
  private maxLineLength = 3.75
  private cullThreshold = 0
  private shimmerSpeed = 2
  private noiseScale = 4
  private noiseSpeed = 0.1
  private noiseStrength = 0.2
  private mouse = new Vector2()
  private mouseInfluenceRadius = 0.8
  private mouseRepulsionStrength = 0.07
  private springStrength = 0.05
  private damping = 0.9
  private radialBlend = 0.15
  private targetFPS = 60
  private lastPhysicsTime: number | null = null
  private originalEndPositions: Vector3[] = []
  private currentEndPositions: Vector3[] = []
  private velocities: Vector3[] = []
  private scene = new Scene()
  private linesGroup = new Group()
  private batchedLines: LineSegments | null = null
  private dots: Points | null = null
  private lineMaterial: ShaderMaterial
  private dotsMaterial: ShaderMaterial
  private canvas: HTMLCanvasElement
  private renderer: WebGLRenderer
  private camera: PerspectiveCamera
  private circleTexture: CanvasTexture
  private _tempVec1 = new Vector3()
  private _tempVec2 = new Vector3()
  private _tempVec3 = new Vector3()
  private _currentWorldPos = new Vector3()
  private _currentNDC = new Vector3()
  private _screenDirection = new Vector3()
  private _radialDirection = new Vector3()
  private _repulsionDirection = new Vector3()
  private _springForce = new Vector3()

  private mousemove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -(((e.clientY - rect.top) / rect.height) * 2) + 1
  }

  private mouseleave = () => {
    this.mouse.set(999, 999)
  }

  private easeOutCubic = (t: number) => 1 - (1 - t) ** 3

  updateAndRender = (now: number) => {
    if (!this.batchedLines || !this.dots) return
    const time = 0.001 * now
    if (this.isIntroActive) {
      if (this.introStartTime === null) this.introStartTime = now
      const t = Math.min((now - this.introStartTime) / this.introDuration, 1)
      const eased = this.easeOutCubic(t)
      this.linesGroup?.scale.setScalar(0.7 + (1 - 0.7) * eased)
      if (t >= 1) this.isIntroActive = false
    }
    if (this.enableRotation && this.linesGroup) {
      this.linesGroup.rotation.x += this.rotationSpeed.x
      this.linesGroup.rotation.y += this.rotationSpeed.y
      this.linesGroup.rotation.z += this.rotationSpeed.z
    }
    this.updatePhysics(now)
    this.lineMaterial.uniforms.time.value = time
    this.dotsMaterial.uniforms.time.value = time
    this.renderer.render(this.scene, this.camera)
  }

  constructor({
    canvas,
    renderer,
    camera,
    circleTexture,
    colorPalette,
  }: SceneCtorArgs) {
    super(colorPalette)
    this.canvas = canvas
    this.renderer = renderer
    this.camera = camera
    this.circleTexture = circleTexture
    this.scene.add(this.linesGroup)
    this.lineMaterial = new ShaderMaterial({
      uniforms: {
        gradientColorTop: { value: this.colorPalette.colorTop },
        gradientColorBottom: { value: this.colorPalette.colorBottom },
        gradientColorStop: { value: this.colorPalette.colorStop },
        opacity: { value: 1 },
        time: { value: 0 },
        shimmerSpeed: { value: this.shimmerSpeed },
        fadeRadius: { value: 3 },
        fadeSharpness: { value: 10.5 },
        noiseStrength: { value: this.noiseStrength },
        noiseScale: { value: this.noiseScale },
        noiseSpeed: { value: this.noiseSpeed },
        origin: { value: PM_ORIGIN },
        animValue: { value: 1 },
        resolution: { value: new Vector2(1, 1) },
      },
      vertexShader: paymentMethodsLinesVertex,
      fragmentShader: paymentMethodsLinesFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
    })
    this.dotsMaterial = new ShaderMaterial({
      uniforms: {
        gradientColorTop: { value: this.colorPalette.colorTop },
        gradientColorBottom: { value: this.colorPalette.colorBottom },
        gradientColorStop: { value: this.colorPalette.colorStop },
        pointTexture: { value: this.circleTexture },
        size: { value: 12 },
        opacity: { value: 0.8 },
        time: { value: 0 },
        shimmerSpeed: { value: this.shimmerSpeed },
        noiseStrength: { value: this.noiseStrength },
        noiseScale: { value: this.noiseScale },
        noiseSpeed: { value: this.noiseSpeed },
        origin: { value: PM_ORIGIN },
        animValue: { value: 1 },
        resolution: { value: new Vector2(1, 1) },
      },
      vertexShader: paymentMethodsDotsVertex,
      fragmentShader: paymentMethodsDotsFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
    })
  }

  initScene() {
    const size = new Vector2()
    this.renderer.getSize(size)
    size.multiplyScalar(this.renderer.getPixelRatio())
    this.dotsMaterial.uniforms.resolution.value = size
    this.lineMaterial.uniforms.resolution.value = size
    this.createRadialLines()
    this.createDots()
    this.updateColorUniforms(this.colorPalette)
    this.isIntroActive = true
  }

  private generateSpherePoints(count: number) {
    const points: Vector3[] = []
    const goldenRatio = (1 + Math.sqrt(5)) / 2
    for (let i = 0; i < count; i += 1) {
      const theta = (2 * Math.PI * i) / goldenRatio
      const phi = Math.acos(1 - (2 * (i + 0.5)) / count)
      const x = Math.sin(phi) * Math.cos(theta)
      const y = Math.sin(phi) * Math.sin(theta)
      const z = Math.cos(phi)
      points.push(new Vector3(x, y, z))
    }
    return points
  }

  private isPointInView(point: Vector3) {
    this.camera.updateMatrixWorld(true)
    this.camera.updateProjectionMatrix()
    const projected = point.clone().project(this.camera)
    const threshold = this.cullThreshold
    return (
      projected.x >= -1 - threshold &&
      projected.x <= 1 + threshold &&
      projected.y >= -1 - threshold &&
      projected.y <= 1 + threshold
    )
  }

  private createRadialLines() {
    const spherePoints = this.generateSpherePoints(this.totalLines)
    const positions: number[] = []
    const lineIds: number[] = []
    let lineId = 0
    spherePoints.forEach((spherePoint) => {
      const length =
        this.minLineLength +
        Math.random() * (this.maxLineLength - this.minLineLength)
      const end = spherePoint.clone().multiplyScalar(length)
      end.add(PM_ORIGIN)
      if (this.isPointInView(end)) {
        this.originalEndPositions.push(end.clone())
        this.currentEndPositions.push(end.clone())
        this.velocities.push(new Vector3(0, 0, 0))
        positions.push(PM_ORIGIN.x, PM_ORIGIN.y, PM_ORIGIN.z)
        positions.push(end.x, end.y, end.z)
        lineIds.push(lineId, lineId)
        lineId += 1
      }
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', numberAttribute(positions, 3))
    geometry.setAttribute('lineId', numberAttribute(lineIds, 1))
    this.batchedLines = new LineSegments(geometry, this.lineMaterial)
    this.linesGroup?.add(this.batchedLines)
  }

  private createDots() {
    const positions: number[] = []
    const positionStarts: number[] = []
    const positionMids: number[] = []
    const distances: number[] = []
    const lineIds: number[] = []
    this.currentEndPositions.forEach((end, index) => {
      positions.push(end.x, end.y, end.z)
      positionStarts.push(end.x, end.y, end.z)
      const mid = FIB_SPHERE_POINTS[index % FIB_SPHERE_POINTS.length]
      positionMids.push(mid.x, mid.y, mid.z)
      distances.push(end.clone().sub(PM_ORIGIN).length())
      lineIds.push(index)
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', numberAttribute(positions, 3))
    geometry.setAttribute('positionStart', numberAttribute(positionStarts, 3))
    geometry.setAttribute('positionMid', numberAttribute(positionMids, 3))
    geometry.setAttribute('distance', numberAttribute(distances, 1))
    geometry.setAttribute('lineId', numberAttribute(lineIds, 1))
    this.dots = new Points(geometry, this.dotsMaterial)
    this.linesGroup?.add(this.dots)
  }

  private updatePhysics(now: number) {
    if (this.lastPhysicsTime === null) {
      this.lastPhysicsTime = now
      return
    }
    const delta = Math.min(now - this.lastPhysicsTime, 100)
    this.lastPhysicsTime = now
    if (delta <= 0) return
    const steps = (delta / 1e3) * this.targetFPS
    const mouseX = this.mouse.x
    const mouseY = this.mouse.y
    const count = this.currentEndPositions.length
    for (let i = 0; i < count; i += 1) {
      const current = this.currentEndPositions[i]
      const original = this.originalEndPositions[i]
      const velocity = this.velocities[i]
      this._currentWorldPos.copy(current)
      this.linesGroup?.localToWorld(this._currentWorldPos)
      this._currentNDC.copy(this._currentWorldPos).project(this.camera)
      const ndcX = this._currentNDC.x
      const ndcY = this._currentNDC.y
      const ndcZ = this._currentNDC.z
      const dx = ndcX - mouseX
      const dy = ndcY - mouseY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const depth = 1 - Math.max(0, Math.min(1, (ndcZ + 1) / 2))
      const influence = this.mouseInfluenceRadius * (0.8 + 0.4 * depth)
      if (dist < influence && dist > 0.001) {
        const dirX = dx / dist
        const dirY = dy / dist
        const depthScale = 0.8 + 0.4 * depth
        let strength =
          (1 - dist / influence) ** 2 * this.mouseRepulsionStrength * depthScale
        strength *= 0.8 + 0.4 * Math.sin(0.1 * i + 0.001 * now)
        this._tempVec1.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
        this._tempVec2.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
        this._screenDirection
          .copy(this._tempVec1)
          .multiplyScalar(dirX)
          .addScaledVector(this._tempVec2, dirY)
          .normalize()
        this._radialDirection.copy(original).sub(PM_ORIGIN).normalize()
        this._repulsionDirection
          .copy(this._screenDirection)
          .multiplyScalar(1 - this.radialBlend)
          .addScaledVector(this._radialDirection, this.radialBlend)
          .normalize()
        this._tempVec3
          .copy(this._repulsionDirection)
          .multiplyScalar(strength * steps)
        velocity.add(this._tempVec3)
      }
      const distance = current.distanceTo(original)
      this._springForce.copy(original).sub(current)
      const springScale = 1 + (distance / 2) ** 1.5
      this._springForce.multiplyScalar(this.springStrength * springScale * steps)
      velocity.add(this._springForce)
      const damping =
        (dist < 1.5 * this.mouseInfluenceRadius
          ? 0.85 * this.damping
          : this.damping) ** steps
      velocity.multiplyScalar(damping)
      this._tempVec3.copy(velocity).multiplyScalar(steps)
      current.add(this._tempVec3)
    }
    if (!this.batchedLines?.geometry || !this.dots?.geometry) return
    const linePositions = this.batchedLines.geometry.getAttribute('position')
    const dotPositions = this.dots.geometry.getAttribute('position')
    for (let i = 0; i < count; i += 1) {
      const current = this.currentEndPositions[i]
      linePositions.setXYZ(2 * i + 1, current.x, current.y, current.z)
      dotPositions.setXYZ(i, current.x, current.y, current.z)
    }
    linePositions.needsUpdate = true
    dotPositions.needsUpdate = true
  }

  cancelIntro() {
    this.isIntroActive = false
    this.linesGroup?.scale.setScalar(1)
  }

  resize = (size: Vector2) => {
    this.camera.aspect = size.width / size.height
    this.camera.updateProjectionMatrix()
    const scaled = new Vector2()
    this.renderer.getSize(scaled)
    scaled.multiplyScalar(this.renderer.getPixelRatio())
    this.dotsMaterial.uniforms.resolution.value = scaled
    this.lineMaterial.uniforms.resolution.value = scaled
  }

  animateIn = (startPoints: Vector3[], onComplete: () => void) => {
    this.setStartPoints(startPoints)
    const dotsUniforms = this.dotsMaterial.uniforms
    const lineUniforms = this.lineMaterial.uniforms
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      lineUniforms.animValue.value = easing.inOutSine(normalize(0.54, 1, t))
      dotsUniforms.animValue.value = t
      dotsUniforms.opacity.value = normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  animateOut = (onComplete: () => void) => {
    this.resetStartPoints()
    const dotsUniforms = this.dotsMaterial.uniforms
    const lineUniforms = this.lineMaterial.uniforms
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      lineUniforms.animValue.value = 1 - easing.outQuad(normalize(0, 0.2, t))
      dotsUniforms.animValue.value = t
      dotsUniforms.opacity.value = 1 - normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  reset() {}

  private resetStartPoints() {
    if (!this.dots) return
    const positions = this.dots.geometry.getAttribute('position').clone()
    this.dots.geometry.setAttribute('positionStart', positions)
    positions.needsUpdate = true
  }

  private setStartPoints(startPoints: Vector3[]) {
    if (!this.dots) return
    const positionStart = this.dots.geometry.getAttribute('positionStart')
    for (let i = 0; i < positionStart.count; i += 1) {
      const point = startPoints[i % (startPoints.length - 1)]
      positionStart.setXYZ(i, point.x, point.y, point.z)
    }
    positionStart.needsUpdate = true
  }

  getPoints = () => {
    if (!this.dots) return []
    const positions = this.dots.geometry.getAttribute('position')
    const points: Vector3[] = []
    for (let i = 0; i < positions.count; i += 1) {
      points.push(
        new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)),
      )
    }
    return points
  }

  protected updateColorUniforms(palette: GradientPalette) {
    const dotsUniforms = this.dotsMaterial.uniforms
    const lineUniforms = this.lineMaterial.uniforms
    dotsUniforms.gradientColorTop.value = palette.colorTop
    dotsUniforms.gradientColorBottom.value = palette.colorBottom
    dotsUniforms.gradientColorStop.value = palette.colorStop
    lineUniforms.gradientColorTop.value = palette.colorTop
    lineUniforms.gradientColorBottom.value = palette.colorBottom
    lineUniforms.gradientColorStop.value = palette.colorStop
  }

  addListeners = () => {
    this.canvas.addEventListener('mousemove', this.mousemove)
    this.canvas.addEventListener('mouseleave', this.mouseleave)
  }

  removeListeners = () => {
    this.canvas.removeEventListener('mousemove', this.mousemove)
    this.canvas.removeEventListener('mouseleave', this.mouseleave)
  }

  dispose = () => {
    this.removeListeners()
    this.batchedLines?.geometry.dispose()
    this.dots?.geometry.dispose()
    this.lineMaterial.dispose()
    this.dotsMaterial.dispose()
  }
}

/* ------------------------------------------------------------------ */
/* Scene 1 — PaymentsVolume (rotating globe of curves)                 */
/* ------------------------------------------------------------------ */

const GLOBE_OFFSET = new Vector3(-0, -2.5, -1.4)
const GLOBE_EULER = new Euler(
  MathUtils.degToRad(40),
  MathUtils.degToRad(24),
  MathUtils.degToRad(24),
)
const SEEDED_RANDOM = createSeededRandom(0.0952847722928798)
const seededRandFloat = SEEDED_RANDOM.randFloat

interface GlobeLineRecord {
  line: Line
  geometry: BufferGeometry
  material: ShaderMaterial
  angleOffset: number
  curveLengthTheta: number
  curveRegion: [number, number]
  curveLengthOffset?: number
  random: number
}

interface AnimationSectionItem {
  shapeIndex: number
  itemIndex: number
}

interface AnimationSection {
  exitAnimationStartAt: number
  enterAnimationStartAt: number
  enterAnimationAngleOffset: number
  currentAnimationItemIndex: number
  currentAnimationItem: AnimationSectionItem
  items: AnimationSectionItem[]
}

/**
 * The curves that wrap around the globe: each "line" is a meridian arc
 * that grows in, holds, and shrinks out, forever.
 */
class GlobeCurves {
  totalTrailingLines = 0
  globePoints: GlobeLineRecord[] = []
  globeRadius = 4
  totalGlobeCurvePoints = 32
  globeAngleOffset = 0
  itemsPerAnimationSection = 2
  animationSections: AnimationSection[] = []
  currentAnimationSectionsOrderIndex = -1
  lineEnterAnimationDuration = 8000
  lineExitAnimationDuration = 3000
  shortLineEnterAnimationDuration = 6200
  shortLineExitAnimationDuration = 2000
  startLineAnimationStaggerRange = 15000
  lineAnimationStaggerRange = 900
  lineFadeThreshold = 0
  maxRingFullProgress = 0.47
  shortMaxRingMultiplier = 0.38
  enterDotScaleThreshold = 0.14
  dotSpawnScaleThreshold = 0.2
  lineFallOff = false
  enableGlobeRotation = true
  globeRotationSpeed = 0.01
  shapesCount = 1
  totalGlobeLines: number
  totalLines: number
  private _curvePointsBuffer: Vector3[]
  private _originPosition = new Vector3()
  private _endPosition = new Vector3()
  private _animationSectionMap = new Map<number, AnimationSection>()
  private currentLineTipsLocal: Vector3[] = []
  private shortRingRangeStartIndex = 140
  private shortRingRangeEndIndex = 216
  private noise2D = createSimplexNoise2D()
  private linesGroup: Group
  private fallOffLineMaterial: ShaderMaterial

  constructor({
    globeLines,
    fallOffLineMaterial,
    linesGroup,
  }: {
    globeLines: number
    fallOffLineMaterial: ShaderMaterial
    linesGroup: Group
  }) {
    this.linesGroup = linesGroup
    this.totalGlobeLines = globeLines
    const extra = globeLines * (this.shapesCount - 1) * 0.5
    this.totalLines = globeLines + extra
    this.fallOffLineMaterial = fallOffLineMaterial
    this._curvePointsBuffer = []
    this.init()
  }

  private init() {
    this._curvePointsBuffer = Array.from(
      { length: this.totalGlobeCurvePoints },
      () => new Vector3(),
    )
    this.createLines()
  }

  private getCurveIndex = (index: number) => {
    if (index < this.totalGlobeLines) {
      return {
        curveIndex: index,
        isFirstShape: true,
        shapeIndex: 0,
        totalShapeLines: this.totalGlobeLines,
      }
    }
    const t = index - this.totalGlobeLines
    return {
      curveIndex: t % (this.totalGlobeLines / 2),
      isFirstShape: false,
      shapeIndex: 1 + Math.floor(t / (this.totalGlobeLines / 2)),
      totalShapeLines: this.totalGlobeLines / 2,
    }
  }

  update({
    dotsGeometry,
    isActive,
    now,
  }: {
    dotsGeometry: BufferGeometry
    isActive: boolean
    now: number
  }) {
    const dotPositions = dotsGeometry.getAttribute('position')
    const dotScales = dotsGeometry.getAttribute('dotScale')
    const dotLineOrigins = dotsGeometry.getAttribute('positionLineOrigin')
    if (this.enableGlobeRotation) {
      this.globeAngleOffset += this.globeRotationSpeed
    }
    this.globePoints.forEach((record, index) => {
      const { line, angleOffset, curveRegion } = record
      const { curveIndex, isFirstShape, shapeIndex, totalShapeLines } =
        this.getCurveIndex(index)
      const angle = (curveIndex / totalShapeLines) * 360 + this.globeAngleOffset
      const normalizedAngle = angle % 360
      const { maxCurveLength } = this.getCurveLengthRange(
        (normalizedAngle / 360) * totalShapeLines,
        isFirstShape,
      )
      const data = this.getPointAnimationData(shapeIndex, curveIndex)
      const { exitAnimationStartAt, enterAnimationStartAt } = data || {}
      let enterProgress = 1
      let exitProgress = 0
      const enterDuration = isFirstShape
        ? this.lineEnterAnimationDuration
        : this.shortLineEnterAnimationDuration
      const exitDuration = isFirstShape
        ? this.lineExitAnimationDuration
        : this.shortLineExitAnimationDuration
      const isExiting =
        exitAnimationStartAt &&
        now > exitAnimationStartAt &&
        now <= exitAnimationStartAt + exitDuration
      const hasExited =
        exitAnimationStartAt && now > exitAnimationStartAt + exitDuration
      const isEntering = enterAnimationStartAt && now > enterAnimationStartAt
      const hasEntered =
        enterAnimationStartAt && now > enterAnimationStartAt + enterDuration
      if (hasExited && !isEntering && data) {
        enterProgress = 0
        if (angleOffset !== data.enterAnimationAngleOffset) {
          record.angleOffset = data.enterAnimationAngleOffset
          record.curveRegion = this.createCurveRegion()
          record.curveLengthOffset = 1
        }
      }
      if (isEntering) {
        const t = now - (enterAnimationStartAt as number)
        enterProgress = easing.inOutSine(Math.min(t / enterDuration, 1))
      }
      if (isExiting) {
        const t = now - (exitAnimationStartAt as number)
        exitProgress = easing.inSine(Math.min(t / exitDuration, 1))
      }
      if (hasEntered && data) this.updateSectionAnimation(data, now)
      const region = curveRegion as [number, number]
      const rangeStart = region[0] * maxCurveLength
      const rangeEnd = region[1] * maxCurveLength
      const fromLength = rangeStart + exitProgress * (rangeEnd - rangeStart)
      const toLength = rangeStart + enterProgress * (rangeEnd - rangeStart)
      const curvePoints = this.getGlobeCurvePoints(angle, fromLength, toLength)
      const positions = line.geometry.getAttribute('position')
      const opacities = line.geometry.getAttribute('opacity')
      const percents = line.geometry.getAttribute('percent')
      const originPositions = line.geometry.getAttribute('originPosition')
      const endPositions = line.geometry.getAttribute('endPosition')
      let headFraction = 0.01 + 0.1 * record.random
      headFraction = MathUtils.clamp(headFraction, 0, 1)
      this._originPosition
        .copy(curvePoints[0])
        .applyEuler(GLOBE_EULER)
        .add(GLOBE_OFFSET)
      this._endPosition
        .copy(curvePoints[curvePoints.length - 1])
        .applyEuler(GLOBE_EULER)
        .add(GLOBE_OFFSET)
      curvePoints.forEach((point, i) => {
        point.applyEuler(GLOBE_EULER).add(GLOBE_OFFSET)
        positions.setXYZ(i, point.x, point.y, point.z)
        percents.setX(i, i / (curvePoints.length - 1))
        originPositions.setXYZ(
          i,
          this._originPosition.x,
          this._originPosition.y,
          this._originPosition.z,
        )
        endPositions.setXYZ(
          i,
          this._endPosition.x,
          this._endPosition.y,
          this._endPosition.z,
        )
        if (this.lineFallOff) {
          opacities.setX(i, i / (curvePoints.length - 1))
        } else {
          const lengthAt =
            fromLength + (i / (curvePoints.length - 1)) * (toLength - fromLength)
          const opacity = lengthAt <= headFraction ? (lengthAt / headFraction) ** 2 : 1
          opacities.setX(i, opacity)
        }
      })
      line.geometry.setDrawRange(0, curvePoints.length)
      positions.needsUpdate = true
      opacities.needsUpdate = true
      percents.needsUpdate = true
      originPositions.needsUpdate = true
      endPositions.needsUpdate = true
      if (isActive) {
        dotPositions.setXYZ(
          index,
          this._endPosition.x,
          this._endPosition.y,
          this._endPosition.z,
        )
        dotLineOrigins.setXYZ(
          index,
          this._originPosition.x,
          this._originPosition.y,
          this._originPosition.z,
        )
        dotPositions.needsUpdate = true
        dotLineOrigins.needsUpdate = true
      }
      this.currentLineTipsLocal[index].copy(
        curvePoints[curvePoints.length - 1],
      )
      let dotScale = 1
      if (toLength < this.enterDotScaleThreshold) {
        dotScale = toLength / this.enterDotScaleThreshold
      }
      if (enterProgress < this.dotSpawnScaleThreshold) {
        dotScale *= enterProgress / this.dotSpawnScaleThreshold
      }
      if (1 - exitProgress < this.dotSpawnScaleThreshold) {
        dotScale *= (1 - exitProgress) / this.dotSpawnScaleThreshold
      }
      dotScales.setX(index, dotScale)
    })
    dotScales.needsUpdate = true
  }

  private getGlobeCurvePoints(angleDeg: number, fromLength: number, toLength = 0) {
    const theta = MathUtils.degToRad(angleDeg)
    const radius = this.globeRadius
    const phiStart = Math.PI * MathUtils.clamp(fromLength, 0, 1)
    const phiEnd = Math.PI * MathUtils.clamp(toLength, 0, 1)
    for (let i = 0; i < this.totalGlobeCurvePoints; i += 1) {
      const t = i / (this.totalGlobeCurvePoints - 1)
      const phi = MathUtils.lerp(phiStart, phiEnd, t)
      const x = radius * Math.sin(phi) * Math.cos(theta)
      const y = radius * Math.cos(phi)
      const z = radius * Math.sin(phi) * Math.sin(theta)
      this._curvePointsBuffer[i].set(x, y, z)
    }
    return this._curvePointsBuffer
  }

  private getPointAnimationData(shapeIndex: number, itemIndex: number) {
    return this._animationSectionMap.get(this._sectionKey(shapeIndex, itemIndex))
  }

  private _sectionKey(shapeIndex: number, itemIndex: number) {
    return 1e4 * shapeIndex + itemIndex
  }

  private _buildAnimationSectionMap() {
    this._animationSectionMap.clear()
    for (const section of this.animationSections) {
      const key = this._sectionKey(
        section.currentAnimationItem.shapeIndex,
        section.currentAnimationItem.itemIndex,
      )
      this._animationSectionMap.set(key, section)
    }
  }

  private updateSectionAnimation(section: AnimationSection, now: number) {
    const key = this._sectionKey(
      section.currentAnimationItem.shapeIndex,
      section.currentAnimationItem.itemIndex,
    )
    const { currentAnimationItemIndex, items } = section
    const nextIndex = (currentAnimationItemIndex + 1) % items.length
    const nextItem = items[nextIndex]
    section.currentAnimationItemIndex = nextIndex
    section.currentAnimationItem = nextItem
    const nextKey = this._sectionKey(
      section.currentAnimationItem.shapeIndex,
      section.currentAnimationItem.itemIndex,
    )
    this._animationSectionMap.delete(key)
    this._animationSectionMap.set(nextKey, section)
    const exitDuration =
      section.currentAnimationItem.shapeIndex === 0
        ? this.lineExitAnimationDuration
        : this.shortLineExitAnimationDuration
    const exitDelay = seededRandFloat(0, 1) * this.lineAnimationStaggerRange
    const enterDelay = seededRandFloat(0, 1) * this.lineAnimationStaggerRange
    const exitStartAt = now + exitDelay
    const enterStartAt = exitStartAt + exitDuration + enterDelay
    section.exitAnimationStartAt = exitStartAt
    section.enterAnimationStartAt = enterStartAt
    section.enterAnimationAngleOffset = 2 * seededRandFloat(0, 1)
  }

  private getCurveLengthRange(progress: number, isFirstShape: boolean) {
    let maxRing = this.maxRingFullProgress
    const startIdx = isFirstShape
      ? this.shortRingRangeStartIndex
      : Math.floor(this.shortRingRangeStartIndex / 2)
    const endIdx = isFirstShape
      ? this.shortRingRangeEndIndex
      : Math.floor(this.shortRingRangeEndIndex / 2)
    const total = isFirstShape ? this.totalGlobeLines : this.totalGlobeLines / 2
    const range = isFirstShape ? 40 : 20
    const lower = startIdx - range - 1
    if (progress >= lower && progress < startIdx) {
      maxRing *= MathUtils.lerp(
        1,
        this.shortMaxRingMultiplier,
        Math.min((progress - lower) / range, 1),
      )
    }
    if (progress >= startIdx && progress <= endIdx) {
      maxRing *= this.shortMaxRingMultiplier
    }
    if (progress > endIdx) {
      maxRing *= MathUtils.lerp(
        this.shortMaxRingMultiplier,
        1,
        Math.min((progress - endIdx) / (total - (isFirstShape ? 4 : 2) - endIdx), 1),
      )
    }
    if (!isFirstShape) maxRing *= 0.9
    return { minCurveLength: 0.7 * maxRing, maxCurveLength: maxRing }
  }

  private createCurveRegion(): [number, number] {
    let region: [number, number] = [
      seededRandFloat(0, 0.75),
      seededRandFloat(0.25, 1),
    ]
    let attempts = 0
    for (; 0.3 > Math.abs(region[1] - region[0]); ) {
      region = [seededRandFloat(0, 0.75), seededRandFloat(0.25, 1)]
      attempts += 1
      if (attempts > 20) {
        region[1] = region[0] < 0.5 ? region[0] + 0.3 : region[0] - 0.3
        break
      }
    }
    return region
  }

  private createLines() {
    this.currentLineTipsLocal = Array.from(
      { length: this.totalLines },
      () => new Vector3(),
    )
    for (let i = 0; i < this.totalLines; i += 1) {
      const geometry = new BufferGeometry()
      const pointCount = this.totalGlobeCurvePoints
      geometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(3 * pointCount), 3),
      )
      geometry.setAttribute(
        'opacity',
        new BufferAttribute(new Float32Array(pointCount), 1),
      )
      geometry.setAttribute(
        'percent',
        new BufferAttribute(new Float32Array(pointCount), 1),
      )
      geometry.setAttribute(
        'originPosition',
        new BufferAttribute(new Float32Array(3 * pointCount), 3),
      )
      geometry.setAttribute(
        'endPosition',
        new BufferAttribute(new Float32Array(3 * pointCount), 3),
      )
      const line = new Line(geometry, this.fallOffLineMaterial)
      this.linesGroup.add(line)
      const noiseInput = 0.5 * i
      const noiseValue = this.noise2D(noiseInput, 0)
      const curveLengthTheta = mapRange(-1, 1, 0, 1, noiseValue)
      this.globePoints.push({
        line,
        geometry,
        material: this.fallOffLineMaterial,
        angleOffset: 0,
        curveLengthTheta,
        curveRegion: this.createCurveRegion(),
        random: seededRandFloat(0, 1),
      })
    }
    const groups: AnimationSectionItem[][] = []
    for (let i = 0; i < this.totalLines; i += 1) {
      const { curveIndex, shapeIndex } = this.getCurveIndex(i)
      const groupIndex = Math.floor(i / this.itemsPerAnimationSection)
      if (!groups[groupIndex]) groups[groupIndex] = []
      groups[groupIndex].push({ shapeIndex, itemIndex: curveIndex })
    }
    groups.forEach((group) => {
      group?.sort(() => seededRandFloat(0, 1) - 0.5)
    })
    const sections: AnimationSection[] = []
    groups.forEach((group) => {
      const first = group[0]
      const exitDuration =
        first.shapeIndex === 0
          ? this.lineExitAnimationDuration
          : this.shortLineExitAnimationDuration
      const startAt = -5e3 + seededRandFloat(0, 1) * this.startLineAnimationStaggerRange
      const stagger = seededRandFloat(0, 1) * this.lineAnimationStaggerRange
      sections.push({
        exitAnimationStartAt: startAt,
        enterAnimationStartAt: startAt + exitDuration + stagger,
        enterAnimationAngleOffset: 0,
        currentAnimationItemIndex: 0,
        currentAnimationItem: first,
        items: group,
      })
    })
    this.animationSections = sections
    this._buildAnimationSectionMap()
  }

  dispose() {
    this.globePoints.forEach((record) => {
      record.line.geometry.dispose()
    })
  }
}

export class PaymentsVolumeScene
  extends PaletteScene
  implements DataVizScene
{
  paused = true
  private hasInitialized = false
  private origin = new Vector3(0, 0, 0)
  private globeLines = 258
  private totalDots = 0
  private globeRadius = 4
  private timeMultiplier = 4e-4
  private globeViz: GlobeCurves | null = null
  private mousePower = 0
  private targetMousePosition = new Vector2()
  private currentMousePosition = new Vector2()
  private raycaster = new Raycaster()
  private scene = new Scene()
  private canvas: HTMLCanvasElement
  private renderer: WebGLRenderer
  private circleTexture: CanvasTexture
  private rect = new DOMRect()
  private camera: PerspectiveCamera
  private dotsMaterial: ShaderMaterial
  private fallOffLineMaterial: ShaderMaterial
  private curvesGroup = new Group()
  private dotsGeometry: BufferGeometry | null = null
  private dotsObject: Points | null = null

  private mousemove = (e: MouseEvent) => {
    const x =
      ((e.clientX - (this.rect.left - window.scrollX)) / this.rect.width) * 2 -
      1
    const y =
      (-(e.clientY - (this.rect.top - window.scrollY)) / this.rect.height) * 2 +
      1
    this.mousePower += 0.05
    this.mousePower = MathUtils.clamp(this.mousePower, 0, 1)
    this.targetMousePosition.x = x
    this.targetMousePosition.y = y
  }

  updateAndRender = (now: number, delta: number) => {
    if (!this.globeViz || !this.dotsGeometry) return
    this.globeViz.update({
      dotsGeometry: this.dotsGeometry,
      isActive: true,
      now,
    })
    const positions = this.dotsGeometry.getAttribute('position')
    const scales = this.dotsGeometry.getAttribute('dotScale')
    this.updateCameraUniforms()
    this.updateMousePhysics(delta)
    this.dotsMaterial.uniforms.time.value = now * this.timeMultiplier
    positions.needsUpdate = true
    scales.needsUpdate = true
    this.renderer.render(this.scene, this.camera)
  }

  constructor({
    canvas,
    renderer,
    camera,
    circleTexture,
    colorPalette,
  }: SceneCtorArgs) {
    super(colorPalette)
    this.scene = new Scene()
    this.canvas = canvas
    this.renderer = renderer
    this.circleTexture = circleTexture
    this.rect = new DOMRect()
    this.camera = camera
    this.camera.updateProjectionMatrix()
    this.dotsMaterial = this.createDepthBasedDotsMaterial()
    this.fallOffLineMaterial = this.createFallOffLineMaterial()
    this.curvesGroup = new Group()
    this.scene.add(this.curvesGroup)
    const ambient = new AmbientLight(0xffffff, 0.5)
    this.scene.add(ambient)
  }

  private updateCameraUniforms() {
    this.dotsMaterial.uniforms.customCameraPosition.value.copy(
      this.camera.position,
    )
    this.globeViz?.globePoints.forEach((record) => {
      const uniforms = record.material.uniforms
      if (
        record.material &&
        uniforms &&
        uniforms.customCameraPosition
      ) {
        uniforms.customCameraPosition.value.copy(this.camera.position)
      }
    })
  }

  initScene() {
    if (this.hasInitialized) return
    const size = new Vector2()
    this.renderer.getSize(size)
    size.multiplyScalar(this.renderer.getPixelRatio())
    this.fallOffLineMaterial.uniforms.resolution.value = size
    this.dotsMaterial.uniforms.resolution.value = size
    this.globeViz = new GlobeCurves({
      globeLines: this.globeLines,
      fallOffLineMaterial: this.fallOffLineMaterial,
      linesGroup: this.curvesGroup,
    })
    this.totalDots = this.globeViz.totalLines
    this.initDots()
    this.hasInitialized = true
  }

  addListeners = () => {
    this.canvas.addEventListener('mousemove', this.mousemove)
  }

  removeListeners = () => {
    this.canvas.removeEventListener('mousemove', this.mousemove)
  }

  private updateMousePhysics(delta: number) {
    const t = 1 - 0.9 ** (delta / 16.67)
    this.currentMousePosition.lerp(this.targetMousePosition, t)
    this.raycaster.setFromCamera(this.currentMousePosition, this.camera)
    const { ray } = this.raycaster
    this.dotsMaterial.uniforms.mouseRayDirection.value = ray.direction
    this.dotsMaterial.uniforms.mouseRayOrigin.value = ray.origin
    this.dotsMaterial.uniforms.mousePower.value = this.mousePower
    this.fallOffLineMaterial.uniforms.mouseRayDirection.value = ray.direction
    this.fallOffLineMaterial.uniforms.mouseRayOrigin.value = ray.origin
    this.fallOffLineMaterial.uniforms.mousePower.value = this.mousePower
    this.mousePower *= 1 - 0.25 * t
  }

  private createFallOffLineMaterial() {
    return new ShaderMaterial({
      uniforms: {
        gradientColorTop: { value: this.colorPalette.colorTop },
        gradientColorBottom: { value: this.colorPalette.colorBottom },
        gradientColorStop: { value: this.colorPalette.colorStop },
        customCameraPosition: { value: this.camera.position },
        sphereRadius: { value: this.globeRadius },
        minOpacity: { value: 0 },
        maxOpacity: { value: 1 },
        zOrigin: { value: 0 },
        animValue: { value: 1 },
        resolution: { value: new Vector2(1, 1) },
        mouseRayDirection: { value: new Vector3() },
        mouseRayOrigin: { value: new Vector3() },
        mousePower: { value: 0 },
      },
      vertexShader: falloffLineVertex,
      fragmentShader: falloffLineFragment,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
  }

  private createDepthBasedDotsMaterial() {
    return new ShaderMaterial({
      uniforms: {
        gradientColorTop: { value: this.colorPalette.colorTop },
        gradientColorBottom: { value: this.colorPalette.colorBottom },
        gradientColorStop: { value: this.colorPalette.colorStop },
        pointTexture: { value: this.circleTexture },
        size: { value: 12 },
        minOpacity: { value: 0.05 },
        maxOpacity: { value: 1 },
        customCameraPosition: { value: this.camera.position },
        sphereRadius: { value: this.globeRadius },
        zOrigin: { value: 0 },
        time: { value: 0 },
        animValue: { value: 1 },
        opacity: { value: 1 },
        resolution: { value: new Vector2(1, 1) },
        mouseRayDirection: { value: new Vector3() },
        mouseRayOrigin: { value: new Vector3() },
        mousePower: { value: 0 },
      },
      vertexShader: depthBasedDotsVertex,
      fragmentShader: depthBasedDotsFragment,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      alphaTest: 0.1,
    })
  }

  private initDots() {
    const positions = new Float32Array(
      Array(this.totalDots)
        .fill([this.origin.x, this.origin.y, this.origin.z])
        .flat(),
    )
    const dotIds = new Float32Array(
      Array.from({ length: this.totalDots }, () =>
        Math.floor(1e3 * Math.random()),
      ),
    )
    const dotScales = new Float32Array(Array.from({ length: this.totalDots }, () => 0))
    const positionStarts = new Float32Array(
      Array(this.totalDots)
        .fill([this.origin.x, this.origin.y, this.origin.z])
        .flat(),
    )
    const positionLineOrigins = new Float32Array(
      Array(this.totalDots)
        .fill([this.origin.x, this.origin.y, this.origin.z])
        .flat(),
    )
    const positionMids: number[] = []
    for (let i = 0; i < this.totalDots; i += 1) {
      const mid = FIB_SPHERE_POINTS[i % FIB_SPHERE_POINTS.length]
      positionMids.push(mid.x, mid.y, mid.z)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', numberAttribute(positions, 3))
    geometry.setAttribute('positionStart', numberAttribute(positionStarts, 3))
    geometry.setAttribute('positionMid', numberAttribute(positionMids, 3))
    geometry.setAttribute(
      'positionLineOrigin',
      numberAttribute(positionLineOrigins, 3),
    )
    geometry.setAttribute('dotId', numberAttribute(dotIds, 1))
    geometry.setAttribute('dotScale', numberAttribute(dotScales, 1))
    this.dotsGeometry = geometry
    this.dotsObject = new Points(geometry, this.dotsMaterial)
    this.dotsObject.frustumCulled = false
    this.curvesGroup.add(this.dotsObject)
  }

  resize = (size: Vector2) => {
    this.rect = getDomRect(this.canvas)
    this.camera.aspect = size.width / size.height
    this.camera.updateProjectionMatrix()
    this.fallOffLineMaterial.uniforms.resolution.value = size
  }

  animateIn = (startPoints: Vector3[], onComplete: () => void) => {
    this.setStartPoints(startPoints)
    const dotsUniforms = this.dotsMaterial.uniforms
    const falloffUniforms = this.fallOffLineMaterial.uniforms
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      falloffUniforms.animValue.value = easing.inOutQuad(normalize(0.6, 1, t))
      dotsUniforms.animValue.value = t
      dotsUniforms.opacity.value = normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  animateOut = (onComplete: () => void) => {
    this.resetStartPoints()
    const dotsUniforms = this.dotsMaterial.uniforms
    const falloffUniforms = this.fallOffLineMaterial.uniforms
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      falloffUniforms.animValue.value = 1 - easing.outQuad(normalize(0, 0.15, t))
      dotsUniforms.animValue.value = t
      dotsUniforms.opacity.value = 1 - normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  reset() {}

  private setStartPoints(startPoints: Vector3[]) {
    if (!this.dotsGeometry) return
    const positionStart = this.dotsGeometry.getAttribute('positionStart')
    for (let i = 0; i < positionStart.count; i += 1) {
      const point = startPoints[i % (startPoints.length - 1)]
      positionStart.setXYZ(i, point.x, point.y, point.z)
    }
    positionStart.needsUpdate = true
  }

  private resetStartPoints() {
    if (!this.dotsGeometry) return
    const positions = this.dotsGeometry.getAttribute('position').clone()
    this.dotsGeometry.setAttribute('positionStart', positions)
    positions.needsUpdate = true
  }

  getPoints = () => {
    if (!this.dotsGeometry) return []
    const positions = this.dotsGeometry.getAttribute('position')
    const points: Vector3[] = []
    for (let i = 0; i < positions.count; i += 1) {
      points.push(
        new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)),
      )
    }
    return points
  }

  protected updateColorUniforms(palette: GradientPalette) {
    if (!this.dotsMaterial) return
    const dotsUniforms = this.dotsMaterial.uniforms
    const falloffUniforms = this.fallOffLineMaterial.uniforms
    dotsUniforms.gradientColorTop.value = palette.colorTop
    dotsUniforms.gradientColorBottom.value = palette.colorBottom
    dotsUniforms.gradientColorStop.value = palette.colorStop
    falloffUniforms.gradientColorTop.value = palette.colorTop
    falloffUniforms.gradientColorBottom.value = palette.colorBottom
    falloffUniforms.gradientColorStop.value = palette.colorStop
  }

  dispose = () => {
    this.removeListeners()
    this.globeViz?.dispose()
    this.dotsGeometry?.dispose()
    this.dotsMaterial.dispose()
  }
}

/* ------------------------------------------------------------------ */
/* Scene 3 — Subscriptions (flowing spline rivers)                     */
/* ------------------------------------------------------------------ */

const SPLINE_ORIGIN = new Vector3(0, -0.75, 0.165)

function createSubscriptionsPointUniforms(circleTexture: CanvasTexture) {
  return {
    opacity: { value: 1 },
    frame: { value: 0 },
    mouseRayDirection: { value: new Vector3() },
    mouseRayOrigin: { value: new Vector3() },
    mousePower: { value: 0 },
    pointSize: { value: 12 },
    circleTexture: { value: circleTexture },
    resolution: { value: new Vector2(1, 1) },
    heartbeatSpeed: { value: 1.5 },
    heartbeatFrequency: { value: 9e3 },
    lineOpacity: { value: 1 },
    floatSpeed: { value: 1e-4 },
    floatPower: { value: 2 },
    floatAmount: { value: 0.05 },
    gradientColorTop: { value: new Color('#3395DF') },
    gradientColorBottom: { value: new Color('#1318C1') },
    gradientColorStop: { value: new Vector2(0, 0.75) },
    animValue: { value: 1 },
  }
}

function createSubscriptionsLineUniforms() {
  return {
    frame: { value: 0 },
    mouseRayDirection: { value: new Vector3() },
    mouseRayOrigin: { value: new Vector3() },
    mousePower: { value: 0 },
    resolution: { value: new Vector2(1, 1) },
    heartbeatSpeed: { value: 1.5 },
    heartbeatFrequency: { value: 9e3 },
    lineOpacity: { value: 1 },
    floatSpeed: { value: 1e-4 },
    floatPower: { value: 2 },
    floatAmount: { value: 0.05 },
    gradientColorTop: { value: new Color('#3395DF') },
    gradientColorBottom: { value: new Color('#1318C1') },
    gradientColorStop: { value: new Vector2(0, 0.75) },
    animValue: { value: 1 },
  }
}

class SplineFlows {
  private tension = 0.4
  lineMeshes: Line[]
  pointMesh: Points

  constructor(lineMaterial: ShaderMaterial, pointMaterial: ShaderMaterial) {
    const generated = this.generateSplineMeshes(lineMaterial, pointMaterial)
    this.lineMeshes = generated.lineMeshes
    this.pointMesh = generated.pointMesh
  }

  dispose() {
    this.lineMeshes.forEach((mesh) => {
      mesh.geometry.dispose()
    })
    this.pointMesh.geometry.dispose()
  }

  private generateSplinePoints(t: number, endPoint: Vector3) {
    const midY = mapRange(0, 1, -0.7, 0.7, t)
    const startY = mapRange(0, 1, -2.2, 2.4, t)
    const points: Vector3[] = []
    const start = new Vector3(MathUtils.randFloat(-3.45, -3.5), startY, 0)
    const center = new Vector3(0, MathUtils.randFloat(-0.008, 0.008), 0)
    const mid = start
      .clone()
      .lerp(center, 0.5)
      .add(new Vector3(0, midY, 0))
    const control = endPoint
      .clone()
      .lerp(center, 0.5)
      .multiply(new Vector3(1, 1.75, 1))
    start.add(SPLINE_ORIGIN)
    mid.add(SPLINE_ORIGIN)
    center.add(SPLINE_ORIGIN)
    control.add(SPLINE_ORIGIN)
    endPoint.add(SPLINE_ORIGIN)
    points.push(start, mid, center, control, endPoint)
    return points
  }

  private generatePoints(
    startPoints: Vector3[],
    endPoints: Vector3[],
    cycles: number[],
  ) {
    const positions: number[] = []
    const positionStarts: number[] = []
    const positionMids: number[] = []
    const randomness: number[] = []
    const cycleValues: number[] = []
    const types: number[] = []
    const pointUvs: number[] = []
    const mouseStartPoints: number[] = []
    const mouseEndPoints: number[] = []
    const geometry = new BufferGeometry()
    const total = 2 * startPoints.length
    startPoints.forEach((start, i) => {
      const startPosition = new Vector3(start.x, start.y, start.z)
      const endPosition = new Vector3(endPoints[i].x, endPoints[i].y, endPoints[i].z)
      const mid = FIB_SPHERE_POINTS[MathUtils.randInt(0, FIB_SPHERE_POINTS.length - 1)]
      positions.push(startPosition.x, startPosition.y, startPosition.z)
      positionStarts.push(startPosition.x, startPosition.y, startPosition.z)
      positionMids.push(mid.x, mid.y, mid.z)
      randomness.push(Math.random())
      cycleValues.push(cycles[i])
      types.push(0)
      pointUvs.push(i / total, i / total)
      mouseStartPoints.push(startPosition.x, startPosition.y, startPosition.z)
      mouseEndPoints.push(endPosition.x, endPosition.y, endPosition.z)
    })
    endPoints.forEach((end, i) => {
      const startPosition = new Vector3(startPoints[i].x, startPoints[i].y, startPoints[i].z)
      const endPosition = new Vector3(end.x, end.y, end.z)
      const mid =
        FIB_SPHERE_POINTS[(i + startPoints.length) % FIB_SPHERE_POINTS.length]
      positions.push(endPosition.x, endPosition.y, endPosition.z)
      positionStarts.push(endPosition.x, endPosition.y, endPosition.z)
      positionMids.push(mid.x, mid.y, mid.z)
      randomness.push(Math.random())
      cycleValues.push(cycles[i])
      types.push(1)
      pointUvs.push(i / total, i / total)
      mouseStartPoints.push(startPosition.x, startPosition.y, startPosition.z)
      mouseEndPoints.push(endPosition.x, endPosition.y, endPosition.z)
    })
    geometry.setAttribute('position', numberAttribute(positions, 3))
    geometry.setAttribute('positionStart', numberAttribute(positionStarts, 3))
    geometry.setAttribute('positionMid', numberAttribute(positionMids, 3))
    geometry.setAttribute('pointUv', numberAttribute(pointUvs, 2))
    geometry.setAttribute('randomness', numberAttribute(randomness, 1))
    geometry.setAttribute('cycle', numberAttribute(cycleValues, 1))
    geometry.setAttribute('type', numberAttribute(types, 1))
    geometry.setAttribute('mouseStartPoint', numberAttribute(mouseStartPoints, 3))
    geometry.setAttribute('mouseEndPoint', numberAttribute(mouseEndPoints, 3))
    return geometry
  }

  private generateSplineMeshes(lineMaterial: ShaderMaterial, pointMaterial: ShaderMaterial) {
    const lineMeshes: Line[] = []
    const startPoints: Vector3[] = []
    const lastPositions: Vector3[] = []
    const cycles: number[] = []
    const pool: Vector3[] = []
    const poolCycles: number[] = []
    for (let i = 0; i < 98 / 3; i += 1) {
      const t = i / (98 / 3)
      const radius = MathUtils.randFloat(3.4, 3.6)
      const y = mapRange(0, 1, -1.55, 1.8, t)
      pool.push(new Vector3(radius, y, 0))
    }
    pool.forEach((_, i) => {
      poolCycles.push(1 - i / pool.length)
    })
    // Fisher-Yates shuffle
    for (let i = poolCycles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[poolCycles[i], poolCycles[j]] = [poolCycles[j], poolCycles[i]]
    }
    for (let i = 0; i < 98; i += 1) {
      let poolIndex = Math.floor(i / 3)
      poolIndex %= pool.length
      const endPoint = pool[poolIndex].clone()
      let cycle = poolCycles[poolIndex]
      poolCycles[poolIndex] += 0.4
      const t = i / 97
      const controlPoints = this.generateSplinePoints(t, endPoint)
      const { geometry, lastPosition } = this.generateSplineGeometry(
        controlPoints,
        cycle,
        true,
      )
      lineMeshes.push(new Line(geometry, lineMaterial))
      startPoints.push(controlPoints[0])
      lastPositions.push(lastPosition)
      cycles.push(cycle)
    }
    const pointsGeometry = this.generatePoints(startPoints, lastPositions, cycles)
    return {
      lineMeshes,
      pointMesh: new Points(pointsGeometry, pointMaterial),
    }
  }

  private generateSplineGeometry(
    controlPoints: Vector3[],
    cycle = 0,
    primary = false,
  ) {
    const curve = new CatmullRomCurve3(
      controlPoints,
      false,
      'centripetal',
      this.tension,
    )
    const positions: number[] = []
    const percents: number[] = []
    const cycleValues: number[] = []
    const primaries: number[] = []
    const startPoints: number[] = []
    const endPoints: number[] = []
    const startPoint = new Vector3()
    const endPoint = new Vector3()
    const point = new Vector3()
    curve.getPoint(0, startPoint)
    curve.getPoint(1, endPoint)
    for (let i = 0; i < 128; i += 1) {
      const t = i / 127
      curve.getPoint(t, point)
      positions.push(point.x, point.y, point.z)
      percents.push(t)
      cycleValues.push(cycle)
      primaries.push(Number(primary))
      startPoints.push(startPoint.x, startPoint.y, startPoint.z)
      endPoints.push(endPoint.x, endPoint.y, endPoint.z)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', numberAttribute(positions, 3))
    geometry.setAttribute('percent', numberAttribute(percents, 1))
    geometry.setAttribute('cycle', numberAttribute(cycleValues, 1))
    geometry.setAttribute('primary', numberAttribute(primaries, 1))
    geometry.setAttribute('startPoint', numberAttribute(startPoints, 3))
    geometry.setAttribute('endPoint', numberAttribute(endPoints, 3))
    return {
      geometry,
      lastPosition: new Vector3(
        positions[positions.length - 3],
        positions[positions.length - 2],
        positions[positions.length - 1],
      ),
    }
  }

  getPoints() {
    const positions = this.pointMesh.geometry.getAttribute('position')
    const points: Vector3[] = []
    for (let i = 0; i < positions.count; i += 1) {
      points.push(
        new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)),
      )
    }
    return points
  }

  resetStartPoints() {
    const positions = this.pointMesh.geometry.getAttribute('position').clone()
    this.pointMesh.geometry.setAttribute('positionStart', positions)
    positions.needsUpdate = true
  }

  setStartPoints(startPoints: Vector3[]) {
    const positionStart = this.pointMesh.geometry.getAttribute('positionStart')
    for (let i = 0; i < positionStart.count; i += 1) {
      const point = startPoints[i % (startPoints.length - 1)]
      positionStart.setXYZ(i, point.x, point.y, point.z)
    }
    positionStart.needsUpdate = true
  }
}

export class SubscriptionsScene
  extends PaletteScene
  implements DataVizScene
{
  paused = true
  private lines: SplineFlows | null = null
  private mousePower = 0
  private mousemove = (e: MouseEvent) => {
    if (this.paused) return
    const x =
      ((e.clientX - (this.rect.left - window.scrollX)) / this.rect.width) * 2 -
      1
    const y =
      (-(e.clientY - (this.rect.top - window.scrollY)) / this.rect.height) * 2 +
      1
    this.mousePower += 0.05
    this.mousePower = MathUtils.clamp(this.mousePower, 0, 1)
    this.targetMousePosition.x = x
    this.targetMousePosition.y = y
  }
  private targetMousePosition = new Vector2()
  private currentMousePosition = new Vector2()
  private raycaster = new Raycaster()
  private canvas: HTMLCanvasElement
  private renderer: WebGLRenderer
  private camera: PerspectiveCamera
  private scene = new Scene()
  private rect = new DOMRect()
  private lineMaterial: ShaderMaterial
  private pointMaterial: ShaderMaterial

  updateAndRender = (now: number, delta: number) => {
    if (!this.lines) return
    this.lineMaterial.uniforms.frame.value = now
    this.pointMaterial.uniforms.frame.value = now
    this.updateMousePhysics(delta)
    this.renderer.render(this.scene, this.camera)
  }

  constructor({
    canvas,
    renderer,
    camera,
    circleTexture,
    colorPalette,
  }: SceneCtorArgs) {
    super(colorPalette)
    this.canvas = canvas
    this.renderer = renderer
    this.camera = camera
    this.scene = new Scene()
    this.rect = new DOMRect()
    const size = new Vector2()
    this.renderer.getSize(size)
    size.multiplyScalar(this.renderer.getPixelRatio())
    this.lineMaterial = new ShaderMaterial({
      uniforms: createSubscriptionsLineUniforms(),
      vertexShader: subscriptionsLinesVertex,
      fragmentShader: subscriptionsLinesFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    this.lineMaterial.uniforms.resolution.value = size
    this.pointMaterial = new ShaderMaterial({
      uniforms: createSubscriptionsPointUniforms(circleTexture),
      vertexShader: subscriptionsPointsVertex,
      fragmentShader: subscriptionsPointsFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.pointMaterial.uniforms.resolution.value = size
    this.updateColorUniforms(colorPalette)
  }

  initScene() {
    this.lines = new SplineFlows(this.lineMaterial, this.pointMaterial)
    this.scene.add(this.lines.pointMesh, ...this.lines.lineMeshes)
  }

  addListeners = () => {
    this.canvas.addEventListener('mousemove', this.mousemove)
  }

  removeListeners = () => {
    this.canvas.removeEventListener('mousemove', this.mousemove)
  }

  private updateMousePhysics(delta: number) {
    const t = 1 - 0.9 ** (delta / 16.67)
    this.currentMousePosition.lerp(this.targetMousePosition, t)
    this.raycaster.setFromCamera(this.currentMousePosition, this.camera)
    const { ray } = this.raycaster
    this.pointMaterial.uniforms.mouseRayDirection.value = ray.direction
    this.pointMaterial.uniforms.mouseRayOrigin.value = ray.origin
    this.pointMaterial.uniforms.mousePower.value = this.mousePower
    this.lineMaterial.uniforms.mouseRayDirection.value = ray.direction
    this.lineMaterial.uniforms.mouseRayOrigin.value = ray.origin
    this.lineMaterial.uniforms.mousePower.value = this.mousePower
    this.mousePower *= 1 - 0.25 * t
  }

  resize = (size: Vector2) => {
    this.rect = getDomRect(this.canvas)
    this.camera.aspect = size.width / size.height
    this.camera.updateProjectionMatrix()
    this.lineMaterial.uniforms.resolution.value = size
    this.pointMaterial.uniforms.resolution.value = size
  }

  dispose = () => {
    this.removeListeners()
    this.lines?.dispose()
    this.lineMaterial.dispose()
    this.pointMaterial.dispose()
  }

  getPoints = () => {
    return this.lines ? this.lines.getPoints() : []
  }

  reset() {
    if (!this.lines) return
    this.lineMaterial.uniforms.animValue.value = 1
    this.pointMaterial.uniforms.animValue.value = 1
    this.pointMaterial.uniforms.opacity.value = 1
  }

  animateIn = (startPoints: Vector3[], onComplete: () => void) => {
    if (!this.lines) return new Animation(1.25)
    this.lines.setStartPoints(startPoints)
    const pointUniforms = this.pointMaterial.uniforms
    const lineUniforms = this.lineMaterial.uniforms
    lineUniforms.animValue.value = 0
    pointUniforms.animValue.value = 0
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      const t2 = normalize(0.54, 1, t)
      lineUniforms.animValue.value = easing.inOutQuad(t2)
      pointUniforms.animValue.value = t
      pointUniforms.opacity.value = normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  animateOut = (onComplete: () => void) => {
    if (!this.lines) return new Animation(1.25)
    this.lines.resetStartPoints()
    const pointUniforms = this.pointMaterial.uniforms
    const lineUniforms = this.lineMaterial.uniforms
    lineUniforms.animValue.value = 1
    pointUniforms.animValue.value = 1
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      const s = normalize(0, 0.2, t)
      lineUniforms.animValue.value = 1 - easing.outSine(s)
      pointUniforms.animValue.value = t
      pointUniforms.opacity.value = 1 - normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  protected updateColorUniforms(palette: GradientPalette) {
    const pointUniforms = this.pointMaterial.uniforms
    const lineUniforms = this.lineMaterial.uniforms
    pointUniforms.gradientColorTop.value = palette.colorTop
    pointUniforms.gradientColorBottom.value = palette.colorBottom
    pointUniforms.gradientColorStop.value = palette.colorStop
    lineUniforms.gradientColorTop.value = palette.colorTop
    lineUniforms.gradientColorBottom.value = palette.colorBottom
    lineUniforms.gradientColorStop.value = palette.colorStop
  }
}

/* ------------------------------------------------------------------ */
/* Scene 2 — Uptime (wave field with pulse waves)                      */
/* ------------------------------------------------------------------ */

const UPTIME_ORIGIN = new Vector3(-1.6, 0, -9)

interface CurvePoint {
  t: number
  x: number
  y: number
  z: number
  distance: number
}

interface DistributedPoint {
  t: number
  x: number
  y: number
  z: number
}

interface Slot {
  t: number
  center: Vector3
  bottom: Vector3
  top: Vector3
}

export class UptimeScene extends PaletteScene implements DataVizScene {
  paused = true
  private pathWidth = 17.5
  private pathHeight = 6
  private numOscillations = 4
  private oscillationSharpness = 1e-5
  private oscillationRoundness = 1.7
  private oscillationPhaseOffset = -0.05
  private numLines = 600
  private depthFadeStart = 0
  private depthFadeEnd = 0.7
  private depthFadeIntensity = 1
  private lineDensityBase = 1
  private lineDensityAtTurns = 0.6
  private yStartOffset = -4.9
  private yRiseAmount = 15
  private linesMesh: LineSegments | null = null
  private linesGeometry: BufferGeometry | null = null
  private dots: Points | null = null
  private _reusablePlane = new Plane(new Vector3(0, 0, 1), 0)
  private _reusableMouseWorld = new Vector3()
  private _reusableSpringForce = new Vector3()
  private mouse = new Vector2(1, 1)
  private raycaster = new Raycaster()
  private mouseInfluenceRadius = 2.2
  private mouseRepulsionStrength = 0.2
  private springStrength = 0.075
  private damping = 0.825
  private targetFPS = 50
  private originalPositions: [Vector3, Vector3][] = []
  private currentPositions: [Vector3, Vector3][] = []
  private velocities: [Vector3, Vector3][] = []
  private pathWidthStart = 0.9
  private pathWidthEnd = 0.9
  private pathXStart = 0
  private pathXEnd = 6
  private lineFadeBottom = 0
  private lineFadeTop = 1
  private zDepthRange = 20
  private zDepthOffset = 0
  private hiddenPreSlots = 1
  private hiddenPreSlotSpacing = 1
  private totalLinesCount = 0
  private slotTs: number[] = []
  private slotLinePositions: [Vector3, Vector3][] = []
  private lineToSlotIndex: number[] = []
  private lineFadeAlphas: number[] = []
  private noiseScale = 10
  private noiseSpeed = 0.08
  private noiseIntensity = 0.3
  private noiseOffset = 0
  private noiseWidth = 0.07
  private animation = {
    isAnimating: false,
    startTime: 0,
    duration: 1900,
    progress: 0,
  }
  private pulseEnabled = true
  private pulseInterval = 2800
  private pulseSpeed = 0.1
  private pulseAcceleration = 0.1
  private pulseAccelStartPos = 0.2
  private pulseFirstDelay = 0
  private pulseLastTriggerTime = 0
  private pulseFirstTriggered = false
  private activePulses: { pos: number; speed: number; lastFrameTime: number }[] =
    []
  private pulseWaveHalfWidth = 0.04
  private pulseSizeBoost = 0.5
  private pulseDisplacementMax = 0.5
  private pulseDisplacementFalloffEnd = 0.07
  private pulseColor = new Vector3(0.7, 0.85, 1)
  private pulseColorWidth = 0.08
  private pulseColorOffset = -0.01
  private pulseActiveThreshold = 0.16
  private pulseWaveFrequency = 2
  private pulseOpacityBoost = 0.5
  private pulseLineOpacityBoost = 0.9
  private pulseColorBrightness = new Vector3(0.35, 0.3, 0.25)
  private pulseLineColorBrightness = new Vector3(0.3, 0.25, 0.2)
  private pulseColorMode = 1
  private pulseSaturationBoost = -0.3
  private pulseLightnessBoost = -0.15
  private pulseLineYOffset = 0.12
  private pulseOpacityFalloffEnd = 0.15
  private mousemove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -(((e.clientY - rect.top) / rect.height) * 2) + 1
  }
  private mouseleave = () => {
    this.mouse.set(999, 999)
  }
  private updateAndRenderImpl = (now: number, delta: number) => {
    if (this.animation.isAnimating) this.updateAnimation(now)
    this.updateShaderUniforms(0.001 * now)
    this.updatePulseWave(now)
    this.applyLinePositions()
    this.updatePhysics(delta)
    this.updateNoiseValuesAsPulse(0.001 * now)
    this.updateGeometries()
    this.renderer.render(this.scene, this.camera)
  }
  private canvas: HTMLCanvasElement
  private renderer: WebGLRenderer
  private camera: PerspectiveCamera
  private circleTexture: CanvasTexture
  private scene = new Scene()
  private linesGroup = new Group()
  private lineMaterial: ShaderMaterial
  private dotsMaterial: ShaderMaterial

  constructor({
    canvas,
    renderer,
    camera,
    circleTexture,
    colorPalette,
  }: SceneCtorArgs) {
    super(colorPalette)
    this.canvas = canvas
    this.renderer = renderer
    this.camera = camera
    this.circleTexture = circleTexture
    this.scene = new Scene()
    this.linesGroup = new Group()
    this.scene.add(this.linesGroup)
    this.lineMaterial = new ShaderMaterial({
      uniforms: {
        gradientColorTop: { value: this.colorPalette.colorTop },
        gradientColorBottom: { value: this.colorPalette.colorBottom },
        gradientColorStop: { value: this.colorPalette.colorStop },
        pulseColor: { value: this.pulseColor },
        pulseColorBrightness: { value: this.pulseLineColorBrightness },
        pulseOpacityBoost: { value: this.pulseLineOpacityBoost },
        pulseColorMode: { value: this.pulseColorMode },
        pulseSaturationBoost: { value: this.pulseSaturationBoost },
        pulseLightnessBoost: { value: this.pulseLightnessBoost },
        pulseLineYOffset: { value: this.pulseLineYOffset },
        pulseSizeBoost: { value: this.pulseSizeBoost },
        pulseOpacityFalloffEnd: { value: this.pulseOpacityFalloffEnd },
        opacity: { value: 1 },
        time: { value: 0 },
        animValue: { value: 1 },
        lineFadeBottom: { value: this.lineFadeBottom },
        lineFadeTop: { value: this.lineFadeTop },
        noiseIntensity: { value: this.noiseIntensity },
        resolution: { value: new Vector2(1, 1) },
      },
      vertexShader: uptimeLinesVertex,
      fragmentShader: uptimeLinesFragment,
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      depthTest: false,
    })
    this.dotsMaterial = new ShaderMaterial({
      uniforms: {
        gradientColorTop: { value: this.colorPalette.colorTop },
        gradientColorBottom: { value: this.colorPalette.colorBottom },
        gradientColorStop: { value: this.colorPalette.colorStop },
        pulseColor: { value: this.pulseColor },
        pulseColorBrightness: { value: this.pulseColorBrightness },
        pulseOpacityBoost: { value: this.pulseOpacityBoost },
        pulseColorMode: { value: this.pulseColorMode },
        pulseSaturationBoost: { value: this.pulseSaturationBoost },
        pulseLightnessBoost: { value: this.pulseLightnessBoost },
        pulseSizeBoost: { value: this.pulseSizeBoost },
        pulseOpacityFalloffEnd: { value: this.pulseOpacityFalloffEnd },
        pointTexture: { value: this.circleTexture },
        opacity: { value: 1 },
        time: { value: 0 },
        animValue: { value: 1 },
        noiseIntensity: { value: this.noiseIntensity },
        resolution: { value: new Vector2(1, 1) },
        size: { value: 12 },
      },
      vertexShader: uptimeDotsVertex,
      fragmentShader: uptimeDotsFragment,
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      depthTest: false,
    })
  }

  get updateAndRender() {
    return this.updateAndRenderImpl
  }

  initScene() {
    const size = new Vector2()
    this.renderer.getSize(size)
    size.multiplyScalar(this.renderer.getPixelRatio())
    this.lineMaterial.uniforms.resolution.value = size
    this.dotsMaterial.uniforms.resolution.value = size
    this.createHelixPath()
    this.createDots()
    this.updateColorUniforms(this.colorPalette)
  }

  private createHelixPath() {
    this.clearLineData()
    const curve = this.generateCurve()
    const distributed = this.distributeLines(curve)
    const slots = this.setupSlots(distributed)
    this.createLines(slots)
  }

  private clearLineData() {
    this.originalPositions = []
    this.velocities = []
    this.lineToSlotIndex = []
    this.lineFadeAlphas = []
    this.slotLinePositions = []
    this.slotTs = []
  }

  private generateCurve() {
    const count = 2 * this.numLines
    const points: CurvePoint[] = []
    let distance = 0
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1)
      const point = this.calculatePointOnCurve(t)
      if (i > 0) {
        const prev = points[i - 1]
        distance += this.calculateDistance(prev, point)
      }
      points.push({ t, x: point.x, y: point.y, z: point.z, distance })
    }
    return { points, totalDistance: distance }
  }

  private calculatePointOnCurve(t: number) {
    const angle =
      (t + this.oscillationPhaseOffset) * Math.PI * 2 * this.numOscillations
    const wave = this.calculateWaveform(angle)
    const widthScale =
      this.pathWidthStart + (this.pathWidthEnd - this.pathWidthStart) * t
    const offsetX = (this.pathWidth / 2) * wave * widthScale
    return {
      x: this.pathXStart + (this.pathXEnd - this.pathXStart) * t + offsetX,
      y: this.yStartOffset + t * this.yRiseAmount,
      z: this.zDepthOffset - t * this.zDepthRange,
    }
  }

  private calculateWaveform(t: number) {
    const scaled = t / this.oscillationRoundness
    const sine = Math.sin(scaled) * this.oscillationRoundness
    const triangle =
      ((2 * Math.asin(Math.sin(scaled))) / Math.PI) * this.oscillationRoundness
    const sharpness = this.oscillationSharpness || 0.7
    return sine * (1 - sharpness) + triangle * sharpness
  }

  private distributeLines(curve: {
    points: CurvePoint[]
    totalDistance: number
  }) {
    const points: DistributedPoint[] = []
    let distance = 0
    for (let i = 0; i < this.numLines; i += 1) {
      const t = i / (this.numLines - 1)
      const density = this.calculateDensityFactor(t)
      distance += curve.totalDistance / this.numLines / density
      const point = this.interpolateOnCurve(curve.points, distance)
      point.x += UPTIME_ORIGIN.x
      point.y += UPTIME_ORIGIN.y
      point.z += UPTIME_ORIGIN.z
      points.push(point)
    }
    return points
  }

  private calculateDensityFactor(t: number) {
    const angle =
      (t + this.oscillationPhaseOffset) * Math.PI * 2 * this.numOscillations
    return (
      this.lineDensityAtTurns +
      (this.lineDensityBase - this.lineDensityAtTurns) *
        Math.abs(Math.cos(angle))
    )
  }

  private interpolateOnCurve(points: CurvePoint[], distance: number): DistributedPoint {
    let index = 0
    for (; index < points.length - 1 && points[index].distance < distance; )
      index += 1
    if (index === 0) {
      const p = points[0]
      return { t: p.t, x: p.x, y: p.y, z: p.z }
    }
    if (index >= points.length) {
      const p = points[points.length - 1]
      return { t: p.t, x: p.x, y: p.y, z: p.z }
    }
    const prev = points[index - 1]
    const next = points[index]
    const t = (distance - prev.distance) / (next.distance - prev.distance)
    return {
      t: prev.t + (next.t - prev.t) * t,
      x: prev.x + (next.x - prev.x) * t,
      y: prev.y + (next.y - prev.y) * t,
      z: prev.z + (next.z - prev.z) * t,
    }
  }

  private setupSlots(points: DistributedPoint[]) {
    const slots: Slot[] = []
    for (let i = 0; i < this.hiddenPreSlots; i += 1) {
      const t = -(i + 1) * (this.hiddenPreSlotSpacing || 1)
      slots.push(this.extrapolateSlot(points, t))
    }
    for (const point of points) {
      slots.push({
        t: point.t,
        center: new Vector3(point.x, point.y, point.z - 10),
        bottom: new Vector3(point.x, point.y - this.pathHeight / 2, point.z),
        top: new Vector3(point.x, point.y + this.pathHeight / 2, point.z),
      })
    }
    return slots
  }

  private extrapolateSlot(points: DistributedPoint[], t: number): Slot {
    if (points.length < 2) {
      const p = points[0] || { t: 0, x: 0, y: 0, z: 0 }
      return {
        t: Math.max(0, p.t + 0.001 * t),
        center: new Vector3(p.x, p.y, p.z),
        bottom: new Vector3(p.x, p.y - this.pathHeight / 2, p.z),
        top: new Vector3(p.x, p.y + this.pathHeight / 2, p.z),
      }
    }
    const a = points[0]
    const b = points[1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const x = a.x + dx * t
    const y = a.y + dy * t
    const z = a.z + dz * t
    return {
      t: Math.max(0, a.t + (b.t - a.t) * t),
      center: new Vector3(x, y, z),
      bottom: new Vector3(x, y - this.pathHeight / 2, z),
      top: new Vector3(x, y + this.pathHeight / 2, z),
    }
  }

  private createLines(slots: Slot[]) {
    this.totalLinesCount = slots.length
    this.slotLinePositions = slots.map((slot) => [
      slot.bottom.clone(),
      slot.top.clone(),
    ])
    this.slotTs = slots.map((slot) => slot.t)
    const positions: number[] = []
    const linePositions: number[] = []
    const lineIds: number[] = []
    const linePercents: number[] = []
    const lineCounts: number[] = []
    const noiseValues: number[] = []
    const lineOpacities: number[] = []
    for (let i = 0; i < this.totalLinesCount; i += 1) {
      const slot = slots[i]
      const isHidden = i < this.hiddenPreSlots
      const t = i / (this.totalLinesCount - 1)
      positions.push(
        slot.bottom.x,
        slot.bottom.y,
        slot.bottom.z,
        slot.top.x,
        slot.top.y,
        slot.top.z,
      )
      linePositions.push(0, 1)
      lineIds.push(i, i)
      linePercents.push(t, t)
      lineCounts.push(this.totalLinesCount, this.totalLinesCount)
      noiseValues.push(0, 0)
      lineOpacities.push(isHidden ? 0 : 1, isHidden ? 0 : 1)
      this.originalPositions.push([slot.bottom.clone(), slot.top.clone()])
      this.currentPositions.push([slot.bottom.clone(), slot.top.clone()])
      this.velocities.push([new Vector3(), new Vector3()])
      this.lineToSlotIndex.push(i)
      this.lineFadeAlphas.push(isHidden ? 0 : 1)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', numberAttribute(positions, 3))
    geometry.setAttribute('linePosition', numberAttribute(linePositions, 1))
    geometry.setAttribute('lineId', numberAttribute(lineIds, 1))
    geometry.setAttribute('linePercent', numberAttribute(linePercents, 1))
    geometry.setAttribute('lineCount', numberAttribute(lineCounts, 1))
    geometry.setAttribute('noiseValue', numberAttribute(noiseValues, 1))
    geometry.setAttribute('lineOpacity', numberAttribute(lineOpacities, 1))
    geometry.setAttribute(
      'pulseIntensity',
      new BufferAttribute(new Float32Array(2 * this.totalLinesCount), 1),
    )
    geometry.setAttribute(
      'pulseDisplacement',
      new BufferAttribute(new Float32Array(2 * this.totalLinesCount), 1),
    )
    this.linesGeometry = geometry
    this.linesMesh = new LineSegments(geometry, this.lineMaterial)
    this.linesMesh.frustumCulled = false
    this.linesGroup.add(this.linesMesh)
  }

  private calculateDistance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  private createDots() {
    const positions: number[] = []
    const positionStarts: number[] = []
    const positionMids: number[] = []
    const lineIds: number[] = []
    const normalizedYs: number[] = []
    const depthOpacities: number[] = []
    const noiseValues: number[] = []
    const linePercents: number[] = []
    this.currentPositions.forEach((current, index) => {
      const slotIndex = this.lineToSlotIndex[index]
      const top = current[1]
      const mid = FIB_SPHERE_POINTS[MathUtils.randInt(0, FIB_SPHERE_POINTS.length - 1)]
      positions.push(top.x, top.y, top.z)
      positionStarts.push(top.x, top.y, top.z)
      positionMids.push(mid.x, mid.y, mid.z)
      lineIds.push(index)
      normalizedYs.push((top.y + 6) / 12)
      const slotT = this.slotTs[slotIndex] ?? 0
      const depthFade = this.calculateDepthFade(slotT)
      depthOpacities.push(depthFade * (this.lineFadeAlphas[index] ?? 1))
      noiseValues.push(Math.random())
      linePercents.push(index / (this.totalLinesCount - 1))
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', numberAttribute(positions, 3))
    geometry.setAttribute('positionStart', numberAttribute(positionStarts, 3))
    geometry.setAttribute('positionMid', numberAttribute(positionMids, 3))
    geometry.setAttribute('lineId', numberAttribute(lineIds, 1))
    geometry.setAttribute('linePercent', numberAttribute(linePercents, 1))
    geometry.setAttribute('normalizedY', numberAttribute(normalizedYs, 1))
    geometry.setAttribute('depthOpacity', numberAttribute(depthOpacities, 1))
    geometry.setAttribute('noiseValue', numberAttribute(noiseValues, 1))
    geometry.setAttribute(
      'pulseIntensity',
      new BufferAttribute(new Float32Array(this.totalLinesCount), 1),
    )
    geometry.setAttribute(
      'pulseDisplacement',
      new BufferAttribute(new Float32Array(this.totalLinesCount), 1),
    )
    this.dots = new Points(geometry, this.dotsMaterial)
    const renderOrder =
      this.totalLinesCount || this.numLines + this.hiddenPreSlots || positions.length
    this.dots.renderOrder = renderOrder + 1
    this.linesGroup.add(this.dots)
  }

  private updateNoiseValuesAsPulse(time: number) {
    this.noiseOffset = (time * this.noiseSpeed) % 1
    const pulseCount = Math.floor(this.noiseScale)
    if (this.linesGeometry) {
      const attr = this.linesGeometry.getAttribute('noiseValue')
      if (attr) {
        for (let i = 0; i < this.totalLinesCount; i += 1) {
          const slotIndex = this.lineToSlotIndex[i]
          const slotT = this.slotTs[slotIndex] ?? 0
          let intensity = 0
          for (let p = 0; p < pulseCount; p += 1) {
            const pulsePos = (this.noiseOffset + p / pulseCount) % 1
            const dist = Math.min(
              Math.abs(slotT - pulsePos),
              Math.abs(slotT - pulsePos + 1),
              Math.abs(slotT - pulsePos - 1),
            )
            if (dist < this.noiseWidth) {
              intensity = Math.max(
                intensity,
                (1 + Math.cos((Math.PI * dist) / this.noiseWidth)) * 0.5,
              )
            }
          }
          const attrIndex = 2 * i
          attr.setX(attrIndex, intensity)
          attr.setX(attrIndex + 1, intensity)
        }
        attr.needsUpdate = true
      }
      this.lineMaterial.uniforms.noiseIntensity.value = this.noiseIntensity
    }
    if (this.dots) {
      const attr = this.dots.geometry.getAttribute('noiseValue')
      if (!attr) return
      for (let i = 0; i < this.totalLinesCount; i += 1) {
        const slotIndex = this.lineToSlotIndex[i]
        const slotT = this.slotTs[slotIndex] ?? 0
        let intensity = 0
        for (let p = 0; p < pulseCount; p += 1) {
          const pulsePos = (this.noiseOffset + p / pulseCount) % 1
          const dist = Math.min(
            Math.abs(slotT - pulsePos),
            Math.abs(slotT - pulsePos + 1),
            Math.abs(slotT - pulsePos - 1),
          )
          if (dist < this.noiseWidth) {
            intensity = Math.max(
              intensity,
              (1 + Math.cos((Math.PI * dist) / this.noiseWidth)) * 0.5,
            )
          }
        }
        attr.setX(i, intensity)
      }
      attr.needsUpdate = true
      this.dotsMaterial.uniforms.noiseIntensity.value = this.noiseIntensity
    }
  }

  addListeners = () => {
    this.canvas.addEventListener('mousemove', this.mousemove)
    this.canvas.addEventListener('mouseleave', this.mouseleave)
  }

  removeListeners = () => {
    this.canvas.removeEventListener('mousemove', this.mousemove)
    this.canvas.removeEventListener('mouseleave', this.mouseleave)
  }

  private updatePhysics(delta: number) {
    if (!this.dots || !this.linesGeometry) return
    const steps = Math.min(delta / 1e3, 0.033) * this.targetFPS
    const dampingFactor = this.damping ** steps
    const springFactor = this.springStrength * steps
    const wallTime = 0.001 * performance.now()
    this.raycaster.setFromCamera(this.mouse, this.camera)
    const positions = this.linesGeometry.getAttribute('position')
    for (let i = 0; i < this.totalLinesCount; i += 1) {
      const current = this.currentPositions[i]
      const original = this.originalPositions[i]
      const velocity = this.velocities[i]
      current[0].copy(original[0])
      const top = current[1]
      const topOriginal = original[1]
      const topVelocity = velocity[1]
      this._reusablePlane.constant = -top.z
      this.raycaster.ray.intersectPlane(
        this._reusablePlane,
        this._reusableMouseWorld,
      )
      const dx = top.x - this._reusableMouseWorld.x
      const dy = top.y - this._reusableMouseWorld.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < this.mouseInfluenceRadius) {
        const strength =
          (1 - dist / this.mouseInfluenceRadius) * this.mouseRepulsionStrength
        const inv = 1 / dist
        topVelocity.x += dx * inv * strength * 0.3 * steps
        topVelocity.y += dy * inv * strength * steps
        topVelocity.z += Math.sin(0.1 * delta + wallTime) * strength * 0.05 * steps
      }
      this._reusableSpringForce
        .copy(topOriginal)
        .sub(top)
        .multiplyScalar(springFactor)
      topVelocity.add(this._reusableSpringForce)
      topVelocity.multiplyScalar(dampingFactor)
      top.x += topVelocity.x * steps
      top.y += topVelocity.y * steps
      top.z += topVelocity.z * steps
      const attrIndex = 2 * i
      positions.setXYZ(attrIndex, current[0].x, current[0].y, current[0].z)
      positions.setXYZ(attrIndex + 1, top.x, top.y, top.z)
    }
    positions.needsUpdate = true
    const dotPositions = this.dots.geometry.getAttribute('position')
    const dotDepthOpacities = this.dots.geometry.getAttribute('depthOpacity')
    const dotNormalizedYs = this.dots.geometry.getAttribute('normalizedY')
    for (let i = 0; i < this.totalLinesCount; i += 1) {
      const top = this.currentPositions[i][1]
      const slotIndex = this.lineToSlotIndex[i]
      dotPositions.setXYZ(i, top.x, top.y, top.z)
      dotNormalizedYs.setX(i, (top.y + 6) / 12)
      const slotT = this.slotTs[slotIndex] ?? 0
      const depthFade = this.calculateDepthFade(slotT)
      const fade = this.lineFadeAlphas[i] ?? 1
      dotDepthOpacities.setX(i, depthFade * fade)
    }
    dotPositions.needsUpdate = true
    dotDepthOpacities.needsUpdate = true
    dotNormalizedYs.needsUpdate = true
  }

  private updatePulseWave(now: number) {
    if (!this.linesGeometry || !this.dots) return
    if (!this.pulseEnabled) {
      if (this.activePulses.length > 0) {
        this.activePulses = []
        this.clearPulseAttributes()
      }
      return
    }
    const interval = this.pulseFirstTriggered
      ? this.pulseInterval
      : this.pulseFirstDelay
    if (now - this.pulseLastTriggerTime >= interval) {
      this.activePulses.push({
        pos: 0,
        speed: this.pulseSpeed,
        lastFrameTime: now,
      })
      this.pulseLastTriggerTime = now
      this.pulseFirstTriggered = true
    }
    const expired: number[] = []
    for (let i = 0; i < this.activePulses.length; i += 1) {
      const pulse = this.activePulses[i]
      const dt = (now - pulse.lastFrameTime) / 1e3
      pulse.lastFrameTime = now
      if (pulse.pos > this.pulseAccelStartPos) {
        const t =
          (pulse.pos - this.pulseAccelStartPos) / (1 - this.pulseAccelStartPos)
        const acceleration = t * t
        pulse.speed = this.pulseSpeed + this.pulseAcceleration * acceleration
      }
      pulse.pos += pulse.speed * dt
      if (pulse.pos >= 1) expired.push(i)
    }
    for (let i = expired.length - 1; i >= 0; i -= 1) {
      this.activePulses.splice(expired[i], 1)
    }
    if (this.activePulses.length === 0) {
      this.clearPulseAttributes()
      return
    }
    const pulsePositions = this.activePulses.map((pulse) => pulse.pos)
    this.updatePulseEffects(pulsePositions)
  }

  private updatePulseEffects(pulsePositions: number[]) {
    if (!this.linesGeometry || !this.dots) return
    const lineIntensities = this.linesGeometry.getAttribute('pulseIntensity')
    const lineDisplacements = this.linesGeometry.getAttribute('pulseDisplacement')
    const dotIntensities = this.dots.geometry.getAttribute('pulseIntensity')
    const dotDisplacements = this.dots.geometry.getAttribute('pulseDisplacement')
    const halfWidth = this.pulseWaveHalfWidth
    const colorWidth = this.pulseColorWidth
    for (let i = 0; i < this.totalLinesCount; i += 1) {
      const slotIndex = this.lineToSlotIndex[i]
      const slotT = this.slotTs[slotIndex] ?? 0
      let intensity = 0
      let displacement = 0
      for (const pulsePos of pulsePositions) {
        const colorStart = pulsePos - this.pulseActiveThreshold
        const colorDist = colorStart - this.pulseColorOffset - slotT
        if (colorDist >= 0 && colorDist < colorWidth) {
          intensity += Math.sin((colorDist / colorWidth) * Math.PI)
        }
        const waveDist = colorStart - slotT
        if (
          waveDist >= 0 &&
          waveDist < halfWidth &&
          slotT < this.pulseDisplacementFalloffEnd
        ) {
          const t = waveDist / halfWidth
          const falloff =
            ((this.pulseDisplacementFalloffEnd - slotT) /
              this.pulseDisplacementFalloffEnd) ** 1
          const wave = Math.sin(t * Math.PI)
          displacement +=
            Math.sin(t * Math.PI * this.pulseWaveFrequency) *
            this.pulseDisplacementMax *
            falloff *
            wave
        }
      }
      const clampedIntensity = Math.min(1, intensity)
      const attrIndex = 2 * i
      lineIntensities.setX(attrIndex, clampedIntensity)
      lineIntensities.setX(attrIndex + 1, clampedIntensity)
      lineDisplacements.setX(attrIndex, displacement)
      lineDisplacements.setX(attrIndex + 1, displacement)
      dotIntensities.setX(i, clampedIntensity)
      dotDisplacements.setX(i, displacement)
    }
    lineIntensities.needsUpdate = true
    lineDisplacements.needsUpdate = true
    dotIntensities.needsUpdate = true
    dotDisplacements.needsUpdate = true
  }

  private clearPulseAttributes() {
    if (!this.linesGeometry || !this.dots) return
    const lineIntensities = this.linesGeometry.getAttribute('pulseIntensity')
    const lineDisplacements = this.linesGeometry.getAttribute('pulseDisplacement')
    const dotIntensities = this.dots.geometry.getAttribute('pulseIntensity')
    const dotDisplacements = this.dots.geometry.getAttribute('pulseDisplacement')
    for (let i = 0; i < this.totalLinesCount; i += 1) {
      const attrIndex = 2 * i
      lineIntensities.setX(attrIndex, 0)
      lineIntensities.setX(attrIndex + 1, 0)
      lineDisplacements.setX(attrIndex, 0)
      lineDisplacements.setX(attrIndex + 1, 0)
      dotIntensities.setX(i, 0)
      dotDisplacements.setX(i, 0)
    }
    lineIntensities.needsUpdate = true
    lineDisplacements.needsUpdate = true
    dotIntensities.needsUpdate = true
    dotDisplacements.needsUpdate = true
  }

  private calculateDepthFade(t: number) {
    if (t < this.depthFadeStart) return 1
    if (t > this.depthFadeEnd) return 1 - this.depthFadeIntensity
    const range = this.depthFadeEnd - this.depthFadeStart
    return 1 - ((t - this.depthFadeStart) / range) * this.depthFadeIntensity
  }

  private applyLinePositions() {
    for (let i = 0; i < this.totalLinesCount; i += 1) {
      const original = this.originalPositions[i]
      this.applyStaticPosition(i, original)
      this.updateLineOpacity(i)
    }
  }

  private applyStaticPosition(index: number, original: [Vector3, Vector3]) {
    const slotIndex = this.lineToSlotIndex[index]
    const slotPositions = this.slotLinePositions[slotIndex]
    for (let i = 0; i < 2; i += 1) original[i].copy(slotPositions[i])
  }

  private updateLineOpacity(index: number) {
    if (!this.linesGeometry) return
    const attr = this.linesGeometry.getAttribute('lineOpacity')
    if (!attr) return
    const slotIndex = this.lineToSlotIndex[index]
    const slotT = this.slotTs[slotIndex] ?? 0
    const opacity =
      0.8 * this.calculateDepthFade(slotT) * (this.lineFadeAlphas[index] ?? 1)
    const attrIndex = 2 * index
    attr.setX(attrIndex, opacity)
    attr.setX(attrIndex + 1, opacity)
  }

  private updateGeometries() {
    if (this.linesGeometry) {
      const attr = this.linesGeometry.getAttribute('lineOpacity')
      if (attr) attr.needsUpdate = true
      this.lineMaterial.uniforms.lineFadeBottom.value = this.lineFadeBottom
      this.lineMaterial.uniforms.lineFadeTop.value = this.lineFadeTop
    }
    this.updateDots()
  }

  private updateDots() {
    if (!this.dots) return
    const positions = this.dots.geometry.getAttribute('position')
    const depthOpacities = this.dots.geometry.getAttribute('depthOpacity')
    const normalizedYs = this.dots.geometry.getAttribute('normalizedY')
    this.currentPositions.forEach((current, index) => {
      const top = current[1]
      const slotIndex = this.lineToSlotIndex[index]
      const slotT = this.slotTs[slotIndex] ?? 0
      const depthFade = this.calculateDepthFade(slotT)
      const fade = this.lineFadeAlphas[index] ?? 1
      positions.setXYZ(index, top.x, top.y, top.z)
      normalizedYs.setX(index, (top.y + 6) / 12)
      depthOpacities.setX(index, depthFade * fade)
    })
    positions.needsUpdate = true
    depthOpacities.needsUpdate = true
    normalizedYs.needsUpdate = true
  }

  private updateShaderUniforms(time: number) {
    this.lineMaterial.uniforms.time.value = time
    this.dotsMaterial.uniforms.time.value = time
  }

  private updateAnimation(now: number) {
    // The JS-driven slot cycle is dormant in the current implementation;
    // animation state stays inactive.
    this.animation.progress = Math.min(
      1,
      (now - this.animation.startTime) / this.animation.duration,
    )
  }

  resize = (size: Vector2) => {
    this.camera.aspect = size.width / size.height
    this.camera.updateProjectionMatrix()
  }

  getPoints = () => {
    if (!this.dots) return []
    const positions = this.dots.geometry.getAttribute('position')
    const depthOpacities = this.dots.geometry.getAttribute('depthOpacity')
    const points: Vector3[] = []
    for (let i = 0; i < positions.count; i += 1) {
      if (depthOpacities.getX(i) < 0.01) continue
      points.push(
        new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)),
      )
    }
    return points
  }

  reset() {
    this.lineMaterial.uniforms.animValue.value = 1
    if (this.dots) {
      const uniforms = (this.dots.material as ShaderMaterial).uniforms
      uniforms.animValue.value = 1
      uniforms.opacity.value = 1
    }
  }

  animateIn = (startPoints: Vector3[], onComplete: () => void) => {
    if (!this.dots) return new Animation(1.25)
    this.setStartPoints(startPoints)
    const dotsMaterial = this.dots.material as ShaderMaterial
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      this.lineMaterial.uniforms.animValue.value = easing.inOutQuad(
        normalize(0.3, 1, t),
      )
      dotsMaterial.uniforms.animValue.value = t
      dotsMaterial.uniforms.opacity.value = normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  animateOut = (onComplete: () => void) => {
    if (!this.dots) return new Animation(1.25)
    this.resetStartPoints()
    const dotsMaterial = this.dots.material as ShaderMaterial
    const animation = new Animation(1.25)
    animation.updateFn = (t) => {
      this.lineMaterial.uniforms.animValue.value =
        1 - easing.outQuad(normalize(0, 0.2, t))
      dotsMaterial.uniforms.animValue.value = t
      dotsMaterial.uniforms.opacity.value = 1 - normalize(0, 0.5, t)
    }
    animation.completeFn = onComplete
    return animation
  }

  private setStartPoints(startPoints: Vector3[]) {
    if (!this.dots) return
    const positionStart = this.dots.geometry.getAttribute('positionStart')
    for (let i = 0; i < positionStart.count; i += 1) {
      const point = startPoints[i % (startPoints.length - 1)]
      positionStart.setXYZ(i, point.x, point.y, point.z)
    }
    positionStart.needsUpdate = true
  }

  private resetStartPoints() {
    if (!this.dots) return
    const positions = this.dots.geometry.getAttribute('position').clone()
    this.dots.geometry.setAttribute('positionStart', positions)
    positions.needsUpdate = true
  }

  protected updateColorUniforms(palette: GradientPalette) {
    if (!this.dots) return
    const dotsUniforms = (this.dots.material as ShaderMaterial).uniforms
    dotsUniforms.gradientColorTop.value = palette.colorTop
    dotsUniforms.gradientColorBottom.value = palette.colorBottom
    dotsUniforms.gradientColorStop.value = palette.colorStop
    this.lineMaterial.uniforms.gradientColorTop.value = palette.colorTop
    this.lineMaterial.uniforms.gradientColorBottom.value = palette.colorBottom
    this.lineMaterial.uniforms.gradientColorStop.value = palette.colorStop
  }

  setColorPalette(palette: GradientPalette, animate: boolean) {
    // Uptime scene guards updateColorUniforms for pre-init palette calls.
    if (!this.dots) {
      this.colorPalette = palette
      return
    }
    super.setColorPalette(palette, animate)
  }

  dispose = () => {
    this.removeListeners()
    this.linesGeometry?.dispose()
    this.dots?.geometry.dispose()
    this.lineMaterial.dispose()
    this.dotsMaterial.dispose()
  }
}
