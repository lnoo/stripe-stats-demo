/**
 * The stripe.com "The backbone of global commerce" stats section,
 * replicated 1:1 including the WebGL data-viz canvas.
 *
 * Behavior source: webpack module 40428 (`ih` in the homepage bundle).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'

import './stripe-stats.css'

import {
  TIME_OF_DAY_VALUES,
  getTimeOfDayFromDate,
  type TimeOfDay,
} from './dataviz/animation'
import { DataViz, DataVizFallback } from './dataviz/data-viz'
import { getWebGlSupport } from './dataviz/manager'
import { TimeOfDaySelect } from './time-of-day-select'
import { useIsIntersecting, useMediaQuery } from './dataviz/data-viz'

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

const subscribeNoop = () => () => { }
function getWebGlSnapshot(): boolean {
  return getWebGlSupport().supported
}
function getWebGlServerSnapshot(): boolean | null {
  return null
}

/** null until measured, mirroring Stripe's WebGL support hook. */
function useWebGLSupport(): boolean | null {
  return useSyncExternalStore(
    subscribeNoop,
    getWebGlSnapshot,
    getWebGlServerSnapshot,
  )
}

function useElementHeight(ref: React.RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return height
}

function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

interface StatItem {
  key: string
  value: string
  description: string
  isUptime?: boolean
}

const STATS: StatItem[] = [
  {
    key: 'stat-payment-methods',
    value: '135+',
    description: 'currencies and payment methods supported',
  },
  {
    key: 'stat-payments-volume',
    value: '$1.9T',
    description: 'in payments volume processed in 2025',
  },
  {
    key: 'stat-historical-uptime',
    value: '99.999%',
    description: 'historical uptime for Stripe services',
    isUptime: true,
  },
  {
    key: 'stat-active-subscriptions',
    value: '200M+',
    description: 'active subscriptions managed on Stripe Billing',
  },
]

const GLOBE_IMAGE =
  'https://images.stripeassets.com/fzn2n1nzq965/63zO5Z4CABvFl3pLLhnu3l/a9c12c883f820dc29d29fa0b9dcb0814/DatavizStatic3x.png'

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export default function StripeStatsSection() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | null>(null)
  const [disableGradientTransition, setDisableGradientTransition] =
    useState(true)
  const supportsWebGL = useWebGLSupport()
  const prefersReducedMotion = usePrefersReducedMotion()
  const isDesktop = useMediaQuery('(min-width: 940px)')
  const [isPlayingAmbientMotion, setIsPlayingAmbientMotion] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const statsMenuRef = useRef<HTMLDivElement>(null)
  const statsMenuHeight = useElementHeight(statsMenuRef)
  const spacerRef = useRef<HTMLDivElement>(null)
  const isSpacerNearViewport = useIsIntersecting(spacerRef, {
    rootMargin: '800px',
    freezeOnceVisible: true,
  })

  useEffect(() => {
    setTimeOfDay(getTimeOfDayFromDate())
    requestAnimationFrame(() => {
      setDisableGradientTransition(false)
    })
  }, [])

  useEffect(() => {
    setIsPlayingAmbientMotion(!prefersReducedMotion)
  }, [prefersReducedMotion])

  useEffect(() => {
    if (isTransitioning && isPlayingAmbientMotion) {
      const timeout = setTimeout(() => setIsTransitioning(false), 1200)
      return () => clearTimeout(timeout)
    }
  }, [isTransitioning, timeOfDay, isPlayingAmbientMotion])

  const sectionTimeOfDay: TimeOfDay = isDesktop
    ? (timeOfDay ?? 'daytime')
    : 'night'
  const isDark = sectionTimeOfDay === 'night'

  const sectionClassName = [
    'stripe-stats-section',
    'hds-color-mode',
    'stats-section',
    isDark && 'stats-section--dark',
    isTransitioning && 'stats-section--transitioning',
    `stats-section--time-${sectionTimeOfDay}`,
    'section',
    isDark && 'hds-mode--dark',
  ]
    .filter(Boolean)
    .join(' ')

  const handleTimeOfDayChange = useCallback(
    (value: TimeOfDay) => {
      if ((timeOfDay === 'night') !== (value === 'night')) {
        setIsTransitioning(true)
      }
      setTimeOfDay(value)
    },
    [timeOfDay],
  )

  const menuHeightStyle = statsMenuHeight
    ? `${statsMenuHeight}px`
    : undefined

  return (
    <section className={sectionClassName} lang='en'>
      <span
        className='stats-section__border'
        aria-hidden='true'
        style={{ '--stats-menu-height': menuHeightStyle } as React.CSSProperties}
      >
        <span className='stats-section__border-inline-graphic' />
      </span>
      <span
        className='stats-section__active-indicator-container'
        aria-hidden='true'
        style={
          {
            '--stats-menu-height': menuHeightStyle,
            '--active-stat-index': activeIndex,
            '--hover-indicator-index': hoverIndex ?? activeIndex,
          } as React.CSSProperties
        }
      >
        <span className='stats-section__active-indicator-graphic'>
          <span className='stats-section__active-indicator stats-section__active-indicator--top' />
          <span className='stats-section__active-indicator stats-section__active-indicator--bottom' />
        </span>
      </span>
      <div className='section-container stats-section__container'>
        <div
          className='section-row section-row-gap'
          style={
            {
              '--section-row-gap-mb': 'var(--hds-space-core-500)',
              '--section-row-gap-tb': 'var(--hds-space-core-700)',
              '--section-row-gap-dt': 'var(--hds-space-core-1000)',
            } as React.CSSProperties
          }
        >
          <h2 className='hds-heading stats-section__title hds-heading--xxl'>
            The backbone of&nbsp;global commerce
          </h2>
          <div className='stats-section__stats-list'>
            {STATS.map((stat) => (
              <div key={stat.key} className='stats-list__stat'>
                <p className='hds-text stats-list__stat-value hds-text--xxl'>
                  {stat.value}
                </p>
                <p className='hds-text stats-list__stat-description hds-text--md'>
                  {stat.description}
                </p>
              </div>
            ))}
          </div>
          <div ref={statsMenuRef} className='stats-section__stats-menu'>
            {STATS.map((stat, index) => {
              const isActive = activeIndex === index
              return (
                <div
                  key={stat.key}
                  className='stats-menu__stat-wrapper'
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onClick={(event) => {
                    const target = event.target as HTMLElement
                    if (!target.closest('a')) setActiveIndex(index)
                  }}
                >
                  <button
                    type='button'
                    className={[
                      'stats-menu__stat',
                      isActive && 'stats-menu__stat--active',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-labelledby={`${stat.key}-value`}
                    aria-describedby={`${stat.key}-description`}
                  >
                    <p
                      id={`${stat.key}-value`}
                      className='hds-text stats-menu__stat-value hds-text--xxl'
                    >
                      {stat.value}
                    </p>
                  </button>
                  <span
                    id={`${stat.key}-description`}
                    className='hds-text stats-menu__stat-description hds-text--md'
                    aria-hidden={!stat.isUptime || undefined}
                  >
                    {stat.isUptime ? (
                      <>
                        <a
                          className='hds-link stats-menu__stat-description__link hds-link--secondary'
                          href='https://status.stripe.com'
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          historical uptime
                        </a>{' '}
                        for Stripe services
                      </>
                    ) : (
                      stat.description
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div ref={spacerRef} className='stats-section__stats-spacer'>
          {isSpacerNearViewport ? (
            <>
              <div className='stats-section__controls'>
                <TimeOfDaySelect
                  value={timeOfDay ?? 'daytime'}
                  onChange={handleTimeOfDayChange}
                />
              </div>
              {supportsWebGL === null ? null : supportsWebGL ? (
                <DataViz
                  activeIndex={activeIndex}
                  timeOfDay={timeOfDay ?? 'daytime'}
                  isPlayingAmbientMotion={isPlayingAmbientMotion}
                />
              ) : (
                <DataVizFallback activeIndex={activeIndex} />
              )}
            </>
          ) : null}
        </div>
        <div className='stats-section__globe'>
          <picture className='stats-section__globe-picture'>
            <source
              type='image/webp'
              srcSet={`${GLOBE_IMAGE}?w=768&fm=webp&q=90 1x, ${GLOBE_IMAGE}?w=1536&fm=webp&q=90 2x, ${GLOBE_IMAGE}?w=2304&fm=webp&q=90 3x`}
            />
            <img
              loading='lazy'
              width={2304}
              height={900}
              alt=''
              srcSet={`${GLOBE_IMAGE}?w=768&q=90 1x, ${GLOBE_IMAGE}?w=1536&q=90 2x, ${GLOBE_IMAGE}?w=2304&q=90 3x`}
              src={`${GLOBE_IMAGE}?w=768&q=90`}
            />
          </picture>
        </div>
      </div>
      <div className='section-background' aria-hidden='true'>
        <div
          className={[
            'stats-animation-gradient',
            disableGradientTransition && 'stats-animation-gradient--no-transition',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {TIME_OF_DAY_VALUES.map((value) => (
            <div
              key={value}
              className={[
                'stats-animation-gradient__gradient',
                `stats-animation-gradient__gradient--${value}`,
                sectionTimeOfDay === value &&
                'stats-animation-gradient__gradient--active',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
