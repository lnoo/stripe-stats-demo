/**
 * The time-of-day selector from the stripe.com stats section, ported from
 * webpack module 62080 (TimeOfDaySelect). The trigger morphs between a sun
 * and a moon; the menu lists the six times of day.
 */
import { useEffect, useRef, useState } from 'react'

import type { TimeOfDay } from './dataviz/animation'

/* ------------------------------------------------------------------ */
/* Icons (verbatim from the original bundle)                           */
/* ------------------------------------------------------------------ */

const OPTION_ICONS: Record<TimeOfDay, React.ReactNode> = {
  'pre-dawn': (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="4.25" stroke="currentColor" stroke-width="1.5"></circle><path d="M10 3.5c3.5899 0 6.5 2.91015 6.5 6.5H18c0-4.41828-3.5817-8-8-8-4.41828 0-8 3.58172-8 8h1.5c0-3.58985 2.91015-6.5 6.5-6.5" fill="currentColor"></path></svg>
  ),
  sunrise: (
    <svg width='20' height='20' viewBox='0 0 20 20' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <circle cx='10' cy='10' r='4.25' stroke='currentColor' strokeWidth='1.5' />
      <path
        d='M10 3.5c2.052 0 3.8815.94941 5.0752 2.43848L16.2451 5C14.779 3.17115 12.5263 2 10 2 7.47367 2 5.22101 3.17115 3.75488 5l1.16992.93848C6.11848 4.44941 7.94799 3.5 10 3.5M3.5 9.25v1.5H1v-1.5zm15.5 0v1.5h-2.5v-1.5zm-2.1058 6.5832-1.0606 1.0607-1.7678-1.7678 1.0607-1.0607zM9.25 16.5h1.5V19h-1.5zm-4.37676-2.4343 1.06066 1.0607-1.76777 1.7678-1.06066-1.0607z'
        fill='currentColor'
      />
    </svg>
  ),
  daytime: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="4.25" stroke="currentColor" stroke-width="1.5"></circle><path d="M3.5 9.25V10.75H1V9.25H3.5Z" fill="currentColor"></path><path d="M19 9.25V10.75H16.5V9.25H19Z" fill="currentColor"></path><path d="M5.93427 4.87324L4.87361 5.9339L3.10584 4.16613L4.1665 3.10547L5.93427 4.87324Z" fill="currentColor"></path><path d="M16.8942 15.8332L15.8336 16.8939L14.0658 15.1261L15.1265 14.0654L16.8942 15.8332Z" fill="currentColor"></path><path d="M9.25 16.5H10.75V19H9.25V16.5Z" fill="currentColor"></path><path d="M9.25 1H10.75V3.5H9.25V1Z" fill="currentColor"></path><path d="M4.87324 14.0657L5.9339 15.1264L4.16613 16.8942L3.10547 15.8335L4.87324 14.0657Z" fill="currentColor"></path><path d="M15.8332 3.10577L16.8939 4.16643L15.1261 5.9342L14.0654 4.87354L15.8332 3.10577Z" fill="currentColor"></path></svg>
  ),
  dusk: (
    <svg width='20' height='20' viewBox='0 0 20 20' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <circle cx='5' cy='5' r='4.25' transform='matrix(1 0 0 -1 5 15)' stroke='currentColor' strokeWidth='1.5' />
      <path
        d='M10 16.5C12.052 16.5 13.8815 15.5506 15.0752 14.0615L16.2451 15C14.779 16.8289 12.5263 18 10 18C7.47367 18 5.22101 16.8289 3.75488 15L4.9248 14.0615C6.11848 15.5506 7.94799 16.5 10 16.5Z'
        fill='currentColor'
      />
      <path d='M3.5 10.75V9.25H1V10.75H3.5Z' fill='currentColor' />
      <path d='M19 10.75V9.25H16.5V10.75H19Z' fill='currentColor' />
      <path d='M16.8942 4.1668L15.8336 3.10614L14.0658 4.87391L15.1265 5.93457L16.8942 4.1668Z' fill='currentColor' />
      <path d='M9.25 3.5H10.75V1L9.25 1V3.5Z' fill='currentColor' />
      <path d='M4.87324 5.93427L5.9339 4.87361L4.16613 3.10584L3.10547 4.1665L4.87324 5.93427Z' fill='currentColor' />
    </svg>
  ),
  sunset: (
    <svg width='20' height='20' viewBox='0 0 20 20' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <circle cx='5' cy='5' r='4.25' transform='matrix(1 0 0 -1 5 15)' stroke='currentColor' strokeWidth='1.5' />
      <path
        d='M10 16.5c3.5899 0 6.5-2.9101 6.5-6.5H18c0 4.4183-3.5817 8-8 8-4.41828 0-8-3.5817-8-8h1.5c0 3.5899 2.91015 6.5 6.5 6.5m6.8942-12.3332-1.0606-1.06066-1.7678 1.76777 1.0607 1.06066zM9.25 3.5h1.5V1h-1.5zM4.87324 5.93427 5.9339 4.87361 4.16613 3.10584 3.10547 4.1665z'
        fill='currentColor'
      />
    </svg>
  ),
  night: (
    <svg width='20' height='20' viewBox='0 0 20 20' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M8.84473 4.19678c-.4299 1.3744-.82326 3.88572 1.125 5.83402 1.94787 1.9474 4.45747 1.5528 5.83207 1.123-.5365 2.7149-2.9294 4.7625-5.8018 4.7627-3.26758 0-5.91682-2.6485-5.91699-5.916 0-2.87217 2.04727-5.26684 4.76172-5.80372Z'
        stroke='currentColor'
        strokeWidth='1.5'
      />
    </svg>
  ),
}

/** The morphing sun/moon trigger icon. */
function TimeOfDayIcon() {
  return (
    <svg
      width='20'
      height='20'
      viewBox='0 0 20 20'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className='time-of-day-select-icon'
    >
      <g className='time-of-day-select-icon__sun-group'>
        <circle
          cx='5'
          cy='5'
          r='4.25'
          transform='matrix(1 0 0 -1 5 15)'
          stroke='currentColor'
          strokeWidth='1.5'
          className='time-of-day-select-icon__sun-center'
        />
        <path
          d='M10 17.25C14.0041 17.25 17.25 14.0041 17.25 10'
          stroke='currentColor'
          strokeWidth='1.5'
          pathLength='1'
          className='time-of-day-select-icon__sun-path time-of-day-select-icon__sun-bottom-right'
        />
        <path
          d='M10 17.25C5.99594 17.25 2.75 14.0041 2.75 10'
          stroke='currentColor'
          strokeWidth='1.5'
          pathLength='1'
          className='time-of-day-select-icon__sun-path time-of-day-select-icon__sun-bottom-left'
        />
        <path
          d='M10 2.75C5.99594 2.75 2.75 5.99593 2.75 10'
          stroke='currentColor'
          strokeWidth='1.5'
          pathLength='1'
          className='time-of-day-select-icon__sun-path time-of-day-select-icon__sun-top-left'
        />
        <path
          d='M10 2.75C14.0041 2.75 17.25 5.99594 17.25 10'
          stroke='currentColor'
          strokeWidth='1.5'
          pathLength='1'
          className='time-of-day-select-icon__sun-path time-of-day-select-icon__sun-top-right'
        />
        <path d='M16.5 10H19' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-one' />
        <path d='M14.5962 14.5962L16.364 16.364' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-two' />
        <path d='M10 16.5V19' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-three' />
        <path d='M5.404 14.596L3.63623 16.3638' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-four' />
        <path d='M3.5 10H1' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-five' />
        <path d='M5.404 5.404L3.63623 3.63623' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-six' />
        <path d='M10 3.5V1' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-seven' />
        <path d='M16.364 3.63604L14.5962 5.40381' stroke='currentColor' strokeWidth='1.5' pathLength='1' className='time-of-day-select-icon__ray time-of-day-select-icon__ray-eight' />
      </g>
      <path
        d='M8.84473 4.19678C8.41483 5.57119 8.02147 8.0825 9.96973 10.0308C11.9176 11.9782 14.4272 11.5836 15.8018 11.1538C15.2653 13.8687 12.8724 15.9163 10 15.9165C6.73242 15.9165 4.08318 13.268 4.08301 10.0005C4.08301 7.12833 6.13028 4.73366 8.84473 4.19678Z'
        stroke='currentColor'
        strokeWidth='1.5'
        className='time-of-day-select-icon__moon'
      />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

const OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: 'pre-dawn', label: 'Pre-dawn' },
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'daytime', label: 'Daytime' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'night', label: 'Night' },
]

interface TimeOfDaySelectProps {
  value: TimeOfDay
  onChange: (value: TimeOfDay) => void
}

export function TimeOfDaySelect({ value, onChange }: TimeOfDaySelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const selectedLabel =
    OPTIONS.find((option) => option.value === value)?.label ?? ''

  return (
    <span className='time-of-day-select' ref={rootRef}>
      <button
        type='button'
        className='time-of-day-select__trigger'
        data-value={value || undefined}
        aria-expanded={open}
        aria-label={`View stats at ${selectedLabel.toLowerCase()}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <TimeOfDayIcon />
      </button>
      {open ? (
        <div
          role='listbox'
          className={`time-of-day-select__menu stats-section--time-${value}`}
        >
          {OPTIONS.map((option) => (
            <div
              key={option.value}
              role='option'
              aria-selected={option.value === value}
              tabIndex={0}
              className={[
                'time-of-day-select__option',
                option.value === value && 'time-of-day-select__option--selected',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(option.value)
                  setOpen(false)
                }
              }}
            >
              <span className='time-of-day-select__option-icon'>
                {OPTION_ICONS[option.value]}
              </span>
              <span className='time-of-day-select__option-label'>
                {option.label}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  )
}
