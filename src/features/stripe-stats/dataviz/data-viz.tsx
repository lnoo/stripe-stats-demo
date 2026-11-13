/**
 * React wrappers around DataVizManager, ported from webpack module 40428
 * (`eI` DataVizInner, `eL` DataVizFallback, `ez` DataViz).
 */
import {
  Component,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import { TIME_OF_DAY_PALETTES, type TimeOfDay } from './animation'
import { DataVizManager, isMobileDevice } from './manager'

const FALLBACK_IMAGES = [
  'https://images.stripeassets.com/fzn2n1nzq965/7iwVhEHuNr5enwnkdi5vF0/221ef0ed4b2645423151dc17202ce4e4/dataviz-fallback_2x.png',
  'https://images.stripeassets.com/fzn2n1nzq965/64K1iZhe99ADmiTzeY5TeI/47cfb0a595bbe98513df60c751aad398/volume-fallback_2x.png',
  'https://images.stripeassets.com/fzn2n1nzq965/3SSo3PvsWE5lIEvc8xdMxs/df73b1b2269139f7466517ee14967847/uptime-fallback_2x.png',
  'https://images.stripeassets.com/fzn2n1nzq965/6qa6IWCkNVnR0GhesY6Vzx/350d2ff12acb6b9677def4bf98b8251c/subscriptions-fallback_2x.png',
]

export function useIsIntersecting(
  ref: RefObject<HTMLElement | null>,
  options: {
    threshold?: number
    rootMargin?: string
    freezeOnceVisible?: boolean
  } = {},
) {
  const {
    threshold = 0,
    rootMargin = '0px',
    freezeOnceVisible = false,
  } = options
  const [isIntersecting, setIsIntersecting] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (freezeOnceVisible && entry.isIntersecting) {
          setIsIntersecting(true)
          observer.disconnect()
        } else {
          setIsIntersecting(entry.isIntersecting)
        }
      },
      { threshold, rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, threshold, rootMargin, freezeOnceVisible])
  return isIntersecting
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const onChange = () => setMatches(mediaQuery.matches)
    onChange()
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [query])
  return matches
}

function debounce<T extends (...args: never[]) => void>(fn: T, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      timeout = null
      fn(...args)
    }, wait)
  }
  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout)
    timeout = null
  }
  return debounced
}

interface DataVizInnerProps {
  activeIndex: number
  timeOfDay: TimeOfDay
  isPlayingAmbientMotion: boolean
}

export interface DataVizHandle {
  setColorPalette: (timeOfDay: TimeOfDay, animate: boolean) => void
}

const DataVizInner = forwardRef<DataVizHandle, DataVizInnerProps>(
  ({ activeIndex, timeOfDay, isPlayingAmbientMotion }, forwardedRef) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const managerRef = useRef<DataVizManager | null>(null)
    const isIntersecting = useIsIntersecting(canvasRef, { threshold: 0.1 })
    const isDesktop = useMediaQuery('(min-width: 940px)')
    const debouncedResize = useRef(
      debounce(() => {
        managerRef.current?.resize()
      }, 300),
    ).current

    useEffect(() => {
      const observer = new ResizeObserver(() => {
        debouncedResize()
      })
      observer.observe(document.body)
      return () => {
        observer.disconnect()
        debouncedResize.cancel()
      }
    }, [debouncedResize])

    useImperativeHandle(
      forwardedRef,
      () => ({
        setColorPalette: (timeOfDayValue: TimeOfDay, animate: boolean) => {
          const palette = TIME_OF_DAY_PALETTES[timeOfDayValue]
          if (palette) {
            managerRef.current?.setColorPalette(
              palette,
              animate && isIntersecting,
            )
          }
        },
      }),
      [isIntersecting],
    )

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const manager = new DataVizManager(canvas)
      managerRef.current = manager
      const palette = TIME_OF_DAY_PALETTES[timeOfDay]
      if (palette) manager.setColorPalette(palette, false)
      return () => {
        managerRef.current?.dispose()
        managerRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
      if (!managerRef.current) return
      const palette = TIME_OF_DAY_PALETTES[timeOfDay]
      if (palette) {
        managerRef.current.setColorPalette(palette, isPlayingAmbientMotion)
      }
    }, [timeOfDay, isPlayingAmbientMotion])

    useEffect(() => {
      const manager = managerRef.current
      if (!manager) return
      if (isIntersecting && isDesktop) {
        manager.initScene()
        manager.paused = !isPlayingAmbientMotion
        manager.setAnimationIndex(activeIndex, isPlayingAmbientMotion)
        if (!isPlayingAmbientMotion) {
          manager.paymentMethodsAnimation.cancelIntro()
          manager.renderActive()
        }
      } else {
        manager.paused = true
      }
    }, [isPlayingAmbientMotion, isIntersecting, isDesktop, activeIndex])

    return (
      <div className='data-viz'>
        <canvas
          className='data-viz__canvas'
          ref={canvasRef}
          aria-hidden='true'
        />
      </div>
    )
  },
)
DataVizInner.displayName = 'DataVizInner'

export function DataVizFallback({ activeIndex }: { activeIndex: number }) {
  return (
    <div className='data-viz'>
      <div className='data-viz__static'>
        {FALLBACK_IMAGES.map((src, index) => (
          <img
            key={src}
            src={src}
            width={2468}
            height={1038}
            sizes='(min-width: 1266px) 1266px, (min-width: 940px) 100vw, 150vw'
            alt=''
            hidden={activeIndex !== index}
          />
        ))}
      </div>
    </div>
  )
}

interface ErrorBoundaryProps {
  uuid: string
  fallback: ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Mirrors Stripe's per-uuid error boundary: any error while mounting or
 * rendering the canvas swaps in the static fallback.
 */
class DataVizErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch() {
    /* swallow — the fallback image takes over */
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

export function DataViz({
  activeIndex,
  timeOfDay,
  isPlayingAmbientMotion,
}: DataVizInnerProps) {
  const fallback = <DataVizFallback activeIndex={activeIndex} />
  if (isMobileDevice) {
    return fallback
  }
  return (
    <DataVizErrorBoundary uuid='DTE5GW9138' fallback={fallback}>
      <DataVizInner
        activeIndex={activeIndex}
        timeOfDay={timeOfDay}
        isPlayingAmbientMotion={isPlayingAmbientMotion}
      />
    </DataVizErrorBoundary>
  )
}
DataViz.displayName = 'DataViz'
