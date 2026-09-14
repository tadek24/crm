import { useEffect, useRef, type ReactNode } from 'react'

const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  companies: 'M4 21V3h12v18M16 9h4v12M8 7h4M8 11h4M8 15h4M2 21h20',
  tasks: 'm4 6 2 2 3-4M12 6h8m-16 8 2 2 3-4m3 2h8M4 21h16',
  day: 'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16m-12 4h3m-3 4h8',
  leaves: 'M3 13a9 9 0 0 1 18 0H3Zm9-9v16a2 2 0 0 0 4 0',
  calendar: 'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 11h18',
  team: 'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m18 0v-3a4 4 0 0 0-3-4M13 3a4 4 0 0 1 0 8M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  chat: 'M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0ZM7 10h9m-9 4h6',
  bell: 'M4 17h16l-2-4V9a6 6 0 0 0-12 0v4l-2 4Zm6 4h4',
  search: 'M21 21l-6-6M17 10A7 7 0 1 1 3 10a7 7 0 0 1 14 0',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 4H4v16h5m5-4 4-4-4-4m-6 4h12',
  check: 'm5 12 4 4L19 6',
  repeat: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  alert: 'M12 3 2 21h20L12 3Zm0 6v5m0 3v.01',
  close: 'M6 6l12 12M18 6 6 18',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.home} />
    </svg>
  )
}

export function Badge({ value }: { value: string }) {
  const positive = ['Gotowe', 'Zrobione', 'Zaakceptowany', 'Aktywna'].includes(value)
  const negative = ['Pilny', 'Odrzucony', 'Dostęp wyłączony'].includes(value)
  const warning = ['W trakcie', 'Oczekuje', 'Wysoki', 'Zaplanowane'].includes(value)
  const recurrence = value.toLowerCase().includes('cyklicz')
  const tone = positive ? 'green' : negative ? 'red' : warning ? 'orange' : recurrence ? 'blue' : 'neutral'
  return <span className={`badge ${tone}`}>{recurrence && <Icon name="repeat" size={12} />}{value}</span>
}

export function Empty({ icon = 'check', title, text }: { icon?: string; title: string; text: string }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  )
}

export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="search">
      <Icon name="search" />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

export function Dialog({
  children,
  close,
  wide = false,
}: {
  children: ReactNode
  close: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.showModal()
    return () => {
      ref.current?.close()
      previous?.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === ref.current) close()
      }}
    >
      {children}
    </dialog>
  )
}

export const initials = (name: string) => name
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase()

export const localToday = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const formatDate = (value: string, long = false) => new Date(`${value}T12:00:00`)
  .toLocaleDateString('pl-PL', long
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'short' })

export const formatDateTime = (value: string) => new Date(value).toLocaleString('pl-PL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
