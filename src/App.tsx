import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { EntityEditor, TaskDetails, type EditorState } from './forms'
import type { Activity, CalendarEvent, ChatMessage, ChatThread, Company, CrmState, DailyPlan, Leave, Person, Task } from './types'
import { Badge, Empty, Icon, Search, formatDate, formatDateTime, initials, localToday } from './ui'

type Page = 'home' | 'day' | 'companies' | 'tasks' | 'leaves' | 'calendar' | 'team' | 'chat' | 'activity'

const roleNames = {
  admin: 'Administrator',
  director: 'Dyrektor',
  employee: 'Pracownik',
}

const navigation: Array<[Page, string]> = [
  ['home', 'Mój pulpit'],
  ['day', 'Mój dzień'],
  ['companies', 'Firmy'],
  ['tasks', 'Zadania'],
  ['leaves', 'Planer urlopów'],
  ['calendar', 'Kalendarz'],
  ['team', 'Zespół'],
]

const pageDescriptions: Record<Page, string> = {
  home: 'Najważniejsze sprawy w Twojej przestrzeni pracy.',
  day: 'Zaplanuj dzień przed rozpoczęciem pracy i odhaczaj kolejne punkty.',
  companies: 'Informacje o klientach, zakres współpracy i odpowiedzialne osoby.',
  tasks: 'Zadania jednorazowe i cykliczne od pierwszego kroku do zakończenia.',
  leaves: 'Wnioski, rodzaje nieobecności i decyzje przełożonych.',
  calendar: 'Wydarzenia, terminy zadań i zaakceptowane urlopy.',
  team: 'Rangi, odpowiedzialność i dostęp do firmowej przestrzeni.',
  chat: 'Rozmowy indywidualne i grupowe całego zespołu.',
  activity: 'Zmiany wymagające Twojej uwagi.',
}

function chatTitle(thread: ChatThread, userId: number) {
  if (thread.kind === 'group') return thread.name
  return thread.participants.filter((person) => person.id !== userId).map((person) => person.name).join(', ') || 'Rozmowa'
}

function addMonths(month: string, step: number) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(year, value - 1 + step, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function AuthScreen({
  setup,
  setupTokenRequired,
  busy,
  error,
  submit,
}: {
  setup: boolean | null
  setupTokenRequired: boolean
  busy: boolean
  error: string
  submit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="auth-screen">
      <section className="auth-brand">
        <Brand suffix="workspace" />
        <div>
          <span className="eyebrow">JEDNO MIEJSCE. CAŁY ZESPÓŁ.</span>
          <h1>Dobry dzień<br />zaczyna się<br />od porządku.</h1>
          <p>Firmy, zadania i ludzie.<br />Wspólna przestrzeń do codziennej pracy.</p>
        </div>
        <div className="auth-ambient" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <span className="eyebrow">TWOJA PRZESTRZEŃ PRACY</span>
          <h2>{setup ? 'Zacznijmy od administratora.' : 'Dobrze Cię widzieć.'}</h2>
          <p>{setup ? 'Utwórz pierwsze konto zarządzające CRM.' : 'Zaloguj się do firmowej przestrzeni.'}</p>
          {setup === null ? <p>Łączenie z CRM…</p> : (
            <>
              {setup && <label>Imię i nazwisko<input name="name" required autoComplete="name" /></label>}
              <label>E-mail<input type="email" name="email" required autoComplete="username" /></label>
              <label>Hasło<input type="password" name="password" required minLength={setup ? 12 : 1} maxLength={128} autoComplete={setup ? 'new-password' : 'current-password'} /></label>
              {setup && setupTokenRequired && (
                <label>Kod uruchomieniowy<input type="password" name="setupToken" required autoComplete="off" /></label>
              )}
              {setup && <small>Hasło musi mieć minimum 12 znaków.</small>}
              <button className={`primary full login-button ${busy ? 'loading' : ''}`} disabled={busy}>
                {busy ? <><span className="button-spinner" />Otwieramy CRM…</> : <>{setup ? 'Utwórz przestrzeń' : 'Zaloguj się'}<Icon name="arrow" /></>}
              </button>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </form>
        {busy && (
          <div className="login-progress" role="status" aria-live="polite">
            <span className="login-progress-mark">e</span>
            <div><strong>Otwieramy Twoją przestrzeń</strong><span className="login-progress-dots"><i /><i /><i /></span></div>
          </div>
        )}
      </section>
    </div>
  )
}

function Brand({ suffix = 'CRM' }: { suffix?: string }) {
  return (
    <span className="brand">
      <span className="brand-mark">e</span>
      <span>eprom</span>
      <span className="brand-suffix">{suffix}</span>
    </span>
  )
}

function PageHeading({
  page,
  name,
  action,
}: {
  page: Page
  name: string
  action?: ReactNode
}) {
  const title = page === 'home'
    ? `Cześć, ${name.split(' ')[0]}.`
    : page === 'chat' ? 'Komunikator' : navigation.find(([id]) => id === page)?.[1] || 'Aktualizacje'
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">
          {page === 'home'
            ? new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
            : 'EPROM / WORKSPACE'}
        </span>
        <h1>{title}</h1>
        <p>{pageDescriptions[page]}</p>
      </div>
      {action}
    </div>
  )
}

function TaskRows({
  tasks,
  state,
  busy,
  update,
  open,
}: {
  tasks: Task[]
  state: CrmState
  busy: boolean
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
  open: (task: Task) => void
}) {
  const personName = (id: number) => state.users.find((person) => person.id === id)?.name || '—'
  const companyName = (id: number) => state.companies.find((company) => company.id === id)?.name || '—'
  if (!tasks.length) return <Empty title="Wszystko pod kontrolą" text="Nie ma zadań w tym widoku." />
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <div className={`task-row ${task.status === 'Gotowe' ? 'complete' : ''}`} key={task.id}>
          <button
            className={`task-check ${task.status === 'Gotowe' ? 'done' : ''}`}
            aria-label={task.status === 'Gotowe' ? `Otwórz ponownie: ${task.title}` : `Ukończ: ${task.title}`}
            disabled={busy}
            onClick={() => void update(`/tasks/${task.id}`, 'PATCH', { status: task.status === 'Gotowe' ? 'Do zrobienia' : 'Gotowe' })}
          >
            {task.status === 'Gotowe' && <Icon name="check" size={15} />}
          </button>
          <button className="task-title grow" onClick={() => open(task)}>
            <strong>{task.title}</strong>
            <span>{companyName(task.company_id)} · {personName(task.assignee_id)}</span>
          </button>
          {task.series_id && <Badge value="Cykliczne" />}
          <Badge value={task.priority} />
          <span className={task.due < localToday() && task.status !== 'Gotowe' ? 'late' : 'muted'}>{formatDate(task.due)}</span>
          <select
            aria-label={`Status: ${task.title}`}
            value={task.status}
            disabled={busy}
            onChange={(event) => void update(`/tasks/${task.id}`, 'PATCH', { status: event.target.value })}
          >
            {['Do zrobienia', 'W trakcie', 'Gotowe'].map((status) => <option key={status}>{status}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}

function NotificationBanner({
  notifications,
  open,
  dismiss,
}: {
  notifications: Activity[]
  open: () => void
  dismiss: () => void
}) {
  if (!notifications.length) return null
  return (
    <aside className="notification-banner" aria-live="polite">
      <span className="notification-bell"><Icon name="bell" /></span>
      <div>
        <strong>{notifications.length === 1 ? 'Masz nową aktualizację' : `Masz ${notifications.length} nowych aktualizacji`}</strong>
        <p>{notifications[0].message}</p>
      </div>
      <button className="notification-open" onClick={open}>Zobacz</button>
      <button className="icon-button" aria-label="Oznacz aktualizacje jako przeczytane" onClick={dismiss}><Icon name="close" size={17} /></button>
    </aside>
  )
}

function HomePage({
  state,
  busy,
  go,
  update,
  openTask,
}: {
  state: CrmState
  busy: boolean
  go: (page: Page) => void
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
  openTask: (task: Task) => void
}) {
  const openTasks = state.tasks.filter((task) => task.status !== 'Gotowe')
  const overdue = openTasks.filter((task) => task.due < localToday())
  const pendingLeaves = state.leaves.filter((leave) => leave.status === 'Oczekuje')
  const todayPlans = state.plans.filter((plan) => plan.user_id === state.user.id && plan.plan_date === localToday())
  const upcoming = state.events.filter((event) => event.date >= localToday()).slice(0, 4)
  return (
    <>
      <div className="stats">
        {[
          [state.companies.length, 'Dostępne firmy', 'companies', 'Relacje i zakres współpracy'],
          [openTasks.length, 'Otwarte zadania', 'tasks', 'Jednorazowe i cykliczne'],
          [todayPlans.length, 'Punkty planu na dziś', 'day', 'Twój plan wykonania'],
          [pendingLeaves.length, 'Wnioski oczekujące', 'leaves', 'Decyzje urlopowe'],
        ].map(([value, label, icon, note]) => (
          <button className="stat" key={label} onClick={() => go(icon as Page)}>
            <span>{label}<Icon name={String(icon)} /></span>
            <strong>{value}</strong>
            <small>{note}</small>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <div>
          <section className="panel">
            <div className="panel-heading">
              <div><h2>Najbliższe zadania</h2><p>{overdue.length ? `${overdue.length} po terminie` : 'Terminy są pod kontrolą'}</p></div>
              <button className="text-button" onClick={() => go('tasks')}>Wszystkie <Icon name="arrow" /></button>
            </div>
            <TaskRows tasks={openTasks.slice(0, 6)} state={state} busy={busy} update={update} open={openTask} />
          </section>
          <section className="panel day-preview">
            <div className="panel-heading">
              <div><h2>Twój dzień</h2><p>Zanim rozpoczniesz pracę</p></div>
              <button className="text-button" onClick={() => go('day')}>Otwórz plan <Icon name="arrow" /></button>
            </div>
            {todayPlans.length ? todayPlans.slice(0, 4).map((plan) => (
              <div className="plan-preview-row" key={plan.id}>
                <span>{plan.planned_start || '—:—'}</span>
                <div><strong>{plan.title}</strong><small>{plan.company_name || 'Własny punkt planu'}</small></div>
                <Badge value={plan.status} />
              </div>
            )) : <Empty icon="day" title="Dzień czeka na plan" text="Dodaj kilka konkretnych punktów, zanim zaczniesz pracę." />}
          </section>
        </div>
        <div>
          <section className="focus-card">
            <span className="eyebrow">PLAN NA DZISIAJ</span>
            <h2>Najpierw plan.<br />Potem spokojna praca.</h2>
            <p>Zapisz, czym chcesz się zająć i ile czasu na to przeznaczasz.</p>
            <button onClick={() => go('day')}>Zaplanuj dzień <Icon name="arrow" /></button>
            <span className="focus-number">{new Date().getDate().toString().padStart(2, '0')}</span>
          </section>
          <section className="panel">
            <div className="panel-heading"><h2>Przed nami</h2><Icon name="calendar" /></div>
            {upcoming.map((event) => (
              <div className="event-row" key={event.id}>
                <div className="date-tile"><strong>{event.date.slice(8)}</strong><span>{formatDate(event.date).split(' ')[1]}</span></div>
                <div><strong>{event.title}</strong><span>{event.time || 'Cały dzień'}</span></div>
              </div>
            ))}
            {!upcoming.length && <p className="empty-small">Brak nadchodzących wydarzeń.</p>}
          </section>
        </div>
      </div>
    </>
  )
}

function DayPage({
  state,
  busy,
  update,
  preselectedTask,
  clearPreselection,
}: {
  state: CrmState
  busy: boolean
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
  preselectedTask: number | null
  clearPreselection: () => void
}) {
  const [planDate, setPlanDate] = useState(localToday())
  const [personId, setPersonId] = useState(state.user.id)
  const isManager = state.user.role !== 'employee'
  const ownPlan = personId === state.user.id
  const availableTasks = state.tasks.filter((task) => task.assignee_id === state.user.id && task.status !== 'Gotowe')
  const plans = state.plans.filter((plan) => plan.user_id === personId && plan.plan_date === planDate)
  const person = state.users.find((entry) => entry.id === personId) || state.user
  const plannedMinutes = plans.reduce((sum, item) => sum + item.planned_minutes, 0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    const ok = await update('/plans', 'POST', data, 'Punkt został dodany do planu dnia.')
    if (ok) {
      form.reset()
      clearPreselection()
    }
  }

  return (
    <div className="day-workspace">
      <section className="day-canvas">
        <div className="day-toolbar">
          <div>
            <span className="eyebrow">PLAN PRACY</span>
            <h2>{ownPlan ? 'Mój plan dnia' : `Plan: ${person.name}`}</h2>
          </div>
          <div className="day-controls">
            {isManager && (
              <select value={personId} onChange={(event) => setPersonId(Number(event.target.value))} aria-label="Pracownik">
                {state.users.filter((entry) => entry.active).map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
              </select>
            )}
            <input type="date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} aria-label="Dzień planu" />
          </div>
        </div>
        <div className="day-summary">
          <span><strong>{plans.length}</strong> punktów</span>
          <span><strong>{Math.floor(plannedMinutes / 60)} h {plannedMinutes % 60 || ''}</strong> zaplanowane</span>
          <span><strong>{plans.filter((plan) => plan.status === 'Zrobione').length}</strong> ukończone</span>
        </div>
        {plans.length ? (
          <div className="plan-timeline">
            {plans.map((plan) => (
              <article className={`plan-card ${plan.status === 'Zrobione' ? 'done' : ''}`} key={plan.id}>
                <div className="plan-time">
                  <strong>{plan.planned_start || '—:—'}</strong>
                  <span>{plan.planned_minutes} min</span>
                </div>
                <div className="plan-message">
                  <div className="plan-author"><span className="avatar tiny">{initials(plan.name)}</span><strong>{plan.name}</strong><Badge value={plan.status} /></div>
                  <h3>{plan.title}</h3>
                  {plan.details && <p>{plan.details}</p>}
                  {(plan.company_name || plan.task_title) && <small>{[plan.company_name, plan.task_title].filter(Boolean).join(' · ')}</small>}
                  {ownPlan && (
                    <div className="plan-actions">
                      {plan.status !== 'Zrobione' && (
                        <button className="text-button" disabled={busy} onClick={() => void update(`/plans/${plan.id}`, 'PATCH', { status: plan.status === 'Zaplanowane' ? 'W trakcie' : 'Zrobione' })}>
                          {plan.status === 'Zaplanowane' ? 'Rozpocznij' : 'Oznacz jako zrobione'}
                        </button>
                      )}
                      <button className="text-button danger" disabled={busy} onClick={() => window.confirm('Usunąć ten punkt z planu?') && void update(`/plans/${plan.id}`, 'DELETE', {})}>Usuń</button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty icon="day" title="Ten dzień nie ma jeszcze planu" text={ownPlan ? 'Po prawej dodaj pierwszą rzecz, którą chcesz wykonać.' : 'Pracownik nie zaplanował jeszcze tego dnia.'} />
        )}
      </section>
      <aside className="plan-composer">
        {ownPlan ? (
          <form onSubmit={submit}>
            <span className="eyebrow">DODAJ DO PLANU</span>
            <h2>Co chcesz zrobić?</h2>
            <p>Zapisz konkretny zamiar. Zadanie szefa pozostaje bez zmian.</p>
            <input type="hidden" name="plan_date" value={planDate} />
            <label>Krótka nazwa<input name="title" required maxLength={200} placeholder="Np. przygotuję szkic kampanii" /></label>
            <label>
              Szczegóły
              <textarea name="details" rows={5} maxLength={3000} placeholder="Co mniej więcej chcesz wykonać i jaki ma być rezultat?" />
            </label>
            <div className="form-pair">
              <label>Start<input type="time" name="planned_start" /></label>
              <label>Planowany czas
                <select name="planned_minutes" defaultValue="60">
                  {[30, 45, 60, 90, 120, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
                </select>
              </label>
            </div>
            <label>
              Powiązane zadanie (opcjonalnie)
              <select name="task_id" defaultValue={preselectedTask || ''}>
                <option value="">Bez powiązania</option>
                {availableTasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}
              </select>
            </label>
            <label>
              Firma (opcjonalnie)
              <select name="company_id" defaultValue="">
                <option value="">Bez firmy</option>
                {state.companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
            </label>
            <button className="primary full" disabled={busy}><Icon name="plus" />Dodaj do dnia</button>
          </form>
        ) : (
          <div className="manager-plan-note">
            <Icon name="team" size={28} />
            <h2>Podgląd planu</h2>
            <p>Możesz zobaczyć plan pracownika, ale tylko on może go układać i zmieniać.</p>
          </div>
        )}
      </aside>
    </div>
  )
}

function CompaniesPage({
  state,
  query,
  setQuery,
  selected,
  setSelected,
  edit,
  newTask,
  busy,
  update,
  openTask,
}: {
  state: CrmState
  query: string
  setQuery: (value: string) => void
  selected: number | null
  setSelected: (value: number | null) => void
  edit: (company: Company) => void
  newTask: (companyId: number) => void
  busy: boolean
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
  openTask: (task: Task) => void
}) {
  const company = state.companies.find((entry) => entry.id === selected)
  const personName = (id: number) => state.users.find((person) => person.id === id)?.name || '—'
  const matches = (value: string) => value.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))
  if (company) {
    const companyTasks = state.tasks.filter((task) => task.company_id === company.id)
    return (
      <>
        <button className="text-button back" onClick={() => setSelected(null)}>← Wszystkie firmy</button>
        <section className="panel company-detail">
          <div className="panel-heading">
            <div><Badge value={company.status} /><h2>{company.name}</h2><p>Opiekun: {personName(company.owner_id)}</p></div>
            {state.user.role === 'admin' && <button className="secondary" onClick={() => edit(company)}>Edytuj firmę</button>}
          </div>
          <div className="contact-grid">
            <div><span>Osoba kontaktowa</span><strong>{company.contact || 'Nie podano'}</strong></div>
            <div><span>E-mail</span><strong>{company.email || 'Nie podano'}</strong></div>
            <div><span>Telefon</span><strong>{company.phone || 'Nie podano'}</strong></div>
          </div>
          <div className="company-notes"><h3>Zakres współpracy i informacje</h3><p>{company.notes || 'Brak dodatkowych informacji.'}</p></div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div><h2>Zadania i obowiązki</h2><p>{companyTasks.filter((task) => task.status !== 'Gotowe').length} otwartych</p></div>
            {state.user.role === 'admin' && <button className="secondary" onClick={() => newTask(company.id)}><Icon name="plus" />Dodaj zadanie</button>}
          </div>
          <TaskRows tasks={companyTasks} state={state} busy={busy} update={update} open={openTask} />
        </section>
      </>
    )
  }
  const companies = state.companies.filter((entry) => matches(`${entry.name} ${entry.contact} ${personName(entry.owner_id)}`))
  return (
    <>
      <Search value={query} onChange={setQuery} placeholder="Szukaj firmy, kontaktu lub opiekuna…" />
      <div className="company-grid">
        {companies.map((entry) => (
          <button className="company-card" key={entry.id} onClick={() => setSelected(entry.id)}>
            <div className="company-card-top"><span className="company-logo">{initials(entry.name)}</span><Badge value={entry.status} /></div>
            <h2>{entry.name}</h2>
            <p>{entry.contact || 'Brak osoby kontaktowej'}</p>
            <div className="company-card-bottom">
              <span><span className="avatar tiny">{initials(personName(entry.owner_id))}</span>{personName(entry.owner_id)}</span>
              <strong>{state.tasks.filter((task) => task.company_id === entry.id && task.status !== 'Gotowe').length} zadań</strong>
            </div>
          </button>
        ))}
      </div>
      {!companies.length && <Empty icon="companies" title="Brak firm" text={state.user.role === 'admin' ? 'Dodaj pierwszą firmę i wybierz jej opiekuna.' : 'Administrator przypisze Ci firmy lub zadania.'} />}
    </>
  )
}

function TasksPage({
  state,
  query,
  setQuery,
  filter,
  setFilter,
  busy,
  update,
  openTask,
}: {
  state: CrmState
  query: string
  setQuery: (value: string) => void
  filter: string
  setFilter: (value: string) => void
  busy: boolean
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
  openTask: (task: Task) => void
}) {
  const companyName = (id: number) => state.companies.find((company) => company.id === id)?.name || ''
  const tasks = state.tasks.filter((task) => {
    const statusMatches = filter === 'Wszystkie' || filter === 'Cykliczne' ? (filter !== 'Cykliczne' || task.series_id) : task.status === filter
    const searchMatches = `${task.title} ${task.description} ${companyName(task.company_id)}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))
    return statusMatches && searchMatches
  })
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {['Wszystkie', 'Do zrobienia', 'W trakcie', 'Gotowe', 'Cykliczne'].map((value) => (
            <button className={filter === value ? 'chosen' : ''} key={value} onClick={() => setFilter(value)}>{value}</button>
          ))}
        </div>
        <Search value={query} onChange={setQuery} placeholder="Szukaj zadania…" />
      </div>
      <section className="panel"><TaskRows tasks={tasks} state={state} busy={busy} update={update} open={openTask} /></section>
      {state.user.role === 'admin' && state.series.length > 0 && (
        <section className="panel series-panel">
          <div className="panel-heading"><div><h2>Serie zadań</h2><p>Szef zarządza automatycznym tworzeniem kolejnych terminów</p></div></div>
          {state.series.map((series) => (
            <div className="series-row" key={series.id}>
              <span className="series-icon"><Icon name="repeat" /></span>
              <div className="grow"><strong>{series.title}</strong><span>{formatCadence(series.cadence, series.interval_n)} · następne {formatDate(series.next_occurrence_on, true)}</span></div>
              <Badge value={series.active ? 'Aktywna' : 'Wstrzymana'} />
              <button className="secondary" disabled={busy} onClick={() => void update(`/task-series/${series.id}`, 'PATCH', { active: !series.active })}>{series.active ? 'Wstrzymaj' : 'Wznów'}</button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

function formatCadence(cadence: string, interval: number) {
  const names: Record<string, [string, string]> = {
    daily: ['dzień', 'dni'],
    weekly: ['tydzień', 'tygodnie'],
    monthly: ['miesiąc', 'miesiące'],
    yearly: ['rok', 'lata'],
  }
  const [single, plural] = names[cadence] || ['okres', 'okresy']
  return interval === 1 ? `Co ${single}` : `Co ${interval} ${plural}`
}

function MonthControl({ month, setMonth }: { month: string; setMonth: (value: string) => void }) {
  const [year, value] = month.split('-').map(Number)
  const label = new Date(year, value - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
  return (
    <div className="month-control">
      <button aria-label="Poprzedni miesiąc" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
      <strong>{label}</strong>
      <button aria-label="Następny miesiąc" onClick={() => setMonth(addMonths(month, 1))}>›</button>
      <button onClick={() => setMonth(localToday().slice(0, 7))}>Dzisiaj</button>
    </div>
  )
}

function LeavesPage({
  state,
  month,
  setMonth,
  busy,
  update,
}: {
  state: CrmState
  month: string
  setMonth: (value: string) => void
  busy: boolean
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
}) {
  const [year, value] = month.split('-').map(Number)
  const days = new Date(year, value, 0).getDate()
  const isAdmin = state.user.role === 'admin'
  const isManager = state.user.role !== 'employee'
  const pending = state.leaves.filter((leave) => leave.status === 'Oczekuje')
  return (
    <>
      <div className={`permission-strip ${isManager ? 'manager' : ''}`}>
        <Icon name={isManager ? 'check' : 'alert'} />
        <div>
          <strong>Twoja ranga: {roleNames[state.user.role]}</strong>
          <p>{isAdmin ? 'Możesz zatwierdzać wszystkie wnioski, również własny.' : state.user.role === 'director' ? 'Możesz zatwierdzać wnioski innych osób. Twój zatwierdza administrator lub inny dyrektor.' : 'Wnioski zatwierdza administrator lub dyrektor. Jako pracownik możesz składać i anulować własne oczekujące wnioski.'}</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading"><div><h2>Nieobecności zespołu</h2><p>Typ urlopu jest widoczny tylko dla uprawnionych osób i właściciela wniosku</p></div><MonthControl month={month} setMonth={setMonth} /></div>
        <div className="planner-scroll">
          <div className="planner" style={{ gridTemplateColumns: `190px repeat(${days}, minmax(31px, 1fr))` }}>
            <div className="planner-person header">Pracownik</div>
            {Array.from({ length: days }, (_, index) => <div className="planner-day" key={index}>{index + 1}</div>)}
            {state.users.filter((person) => person.active).map((person) => (
              <div className="planner-track" key={person.id}>
                <div className="planner-person"><span className="avatar tiny">{initials(person.name)}</span>{person.name}</div>
                {Array.from({ length: days }, (_, index) => {
                  const date = `${month}-${String(index + 1).padStart(2, '0')}`
                  const leave = state.leaves.find((entry) => entry.user_id === person.id && entry.start <= date && entry.end >= date && ['Oczekuje', 'Zaakceptowany'].includes(entry.status))
                  const weekend = [0, 6].includes(new Date(`${date}T12:00:00`).getDay())
                  return <div className={`planner-cell ${weekend ? 'weekend ' : ''}${leave ? leave.status === 'Zaakceptowany' ? 'approved' : 'pending' : ''}`} title={`${person.name}, ${formatDate(date, true)}${leave ? `: ${leave.leave_type} — ${leave.status}` : ''}`} key={date}>{leave ? '•' : ''}</div>
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="legend"><span><i className="approved" />Zaakceptowany</span><span><i className="pending" />Oczekuje</span><span>Szare tło: weekend</span></div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Wnioski urlopowe</h2><p>{pending.length} oczekujących</p></div></div>
        {state.leaves.length ? state.leaves.slice().reverse().map((leave) => (
          <div className={`leave-row ${leave.status === 'Oczekuje' ? 'attention' : ''}`} key={leave.id}>
            <span className="avatar">{initials(leave.name)}</span>
            <div className="grow">
              <strong>{leave.name}</strong>
              <span>{leave.leave_type} · {formatDate(leave.start, true)} – {formatDate(leave.end, true)}</span>
              {leave.note && <p>{leave.note}</p>}
              {leave.reviewer_name && <small>Decyzja: {leave.reviewer_name}</small>}
            </div>
            <Badge value={leave.status} />
            {leave.status === 'Oczekuje' && leave.user_id === state.user.id && !isAdmin && (
              <button className="text-button danger" disabled={busy} onClick={() => void update(`/leaves/${leave.id}`, 'PATCH', { status: 'Anulowany' })}>Anuluj</button>
            )}
            {leave.status === 'Oczekuje' && isManager && (leave.user_id !== state.user.id || isAdmin) && (
              <div className="decision-actions">
                <button className="secondary" disabled={busy} onClick={() => void update(`/leaves/${leave.id}`, 'PATCH', { status: 'Odrzucony' })}>Odrzuć</button>
                <button className="primary" disabled={busy} onClick={() => void update(`/leaves/${leave.id}`, 'PATCH', { status: 'Zaakceptowany' })}>Akceptuj</button>
              </div>
            )}
          </div>
        )) : <Empty icon="leaves" title="Brak wniosków" text="Pierwszy wniosek złożysz przyciskiem u góry." />}
      </section>
    </>
  )
}

function CalendarPage({
  state,
  month,
  setMonth,
  busy,
  update,
}: {
  state: CrmState
  month: string
  setMonth: (value: string) => void
  busy: boolean
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
}) {
  const [year, value] = month.split('-').map(Number)
  const days = new Date(year, value, 0).getDate()
  const offset = (new Date(year, value - 1, 1).getDay() + 6) % 7
  const canManage = state.user.role !== 'employee'
  return (
    <section className="panel calendar-panel">
      <div className="panel-heading"><MonthControl month={month} setMonth={setMonth} /><div className="legend compact"><span><i className="event" />Wydarzenie</span><span><i className="task" />Zadanie</span><span><i className="leave" />Urlop</span></div></div>
      <div className="calendar-grid">
        {['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Niedz'].map((day) => <div className="weekday" key={day}>{day}</div>)}
        {Array.from({ length: offset }, (_, index) => <div className="calendar-day outside" key={`outside-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const date = `${month}-${String(index + 1).padStart(2, '0')}`
          return (
            <div className={`calendar-day ${date === localToday() ? 'today' : ''}`} key={date}>
              <span className="day-number">{index + 1}</span>
              {state.events.filter((event) => event.date === date).map((event) => (
                <CalendarEntry key={`event-${event.id}`} event={event} canDelete={canManage && (state.user.role === 'admin' || event.created_by === state.user.id)} busy={busy} remove={() => window.confirm(`Usunąć wydarzenie „${event.title}”?`) && void update(`/events/${event.id}`, 'DELETE', {})} />
              ))}
              {state.tasks.filter((task) => task.due === date && task.status !== 'Gotowe').map((task) => <div className="calendar-entry task" key={`task-${task.id}`}>{task.title}</div>)}
              {state.leaves.filter((leave) => leave.status === 'Zaakceptowany' && leave.start <= date && leave.end >= date).map((leave) => <div className="calendar-entry leave" key={`leave-${leave.id}`}>{leave.leave_type} · {leave.name}</div>)}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CalendarEntry({ event, canDelete, busy, remove }: { event: CalendarEvent; canDelete: boolean; busy: boolean; remove: () => void }) {
  return (
    <div className="calendar-entry event">
      <strong>{event.time} {event.title}</strong>
      {event.description && <span>{event.description}</span>}
      {canDelete && <button disabled={busy} aria-label={`Usuń ${event.title}`} onClick={remove}>×</button>}
    </div>
  )
}

function TeamPage({
  state,
  query,
  setQuery,
  busy,
  update,
}: {
  state: CrmState
  query: string
  setQuery: (value: string) => void
  busy: boolean
  update: (path: string, method: string, data: unknown, success?: string) => Promise<boolean>
}) {
  const people = state.users.filter((person) => `${person.name} ${person.email || ''}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')))
  return (
    <>
      <div className="role-cards">
        <div><strong>Administrator</strong><p>Pełne zarządzanie zespołem, firmami, zadaniami i urlopami.</p></div>
        <div><strong>Dyrektor</strong><p>Akceptuje urlopy innych osób, tworzy wydarzenia i widzi plany zespołu.</p></div>
        <div><strong>Pracownik</strong><p>Realizuje przypisane zadania, układa własny plan i składa wnioski.</p></div>
      </div>
      <Search value={query} onChange={setQuery} placeholder="Szukaj osoby…" />
      <section className="panel">
        {people.map((person) => (
          <div className="team-row" key={person.id}>
            <span className="avatar">{initials(person.name)}</span>
            <div className="grow"><strong>{person.name}{person.id === state.user.id ? ' (Ty)' : ''}</strong><span>{person.email || 'Adres widoczny tylko administratorowi'}</span></div>
            <Badge value={person.active ? roleNames[person.role] : 'Dostęp wyłączony'} />
            {state.user.role === 'admin' && person.active === 0 && <button className="secondary" disabled={busy} onClick={() => void update(`/users/${person.id}`, 'PATCH', { role: person.role, active: true })}>Przywróć dostęp</button>}
            {state.user.role === 'admin' && person.id !== state.user.id && person.active === 1 && (
              <>
                <select value={person.role} disabled={busy} aria-label={`Ranga: ${person.name}`} onChange={(event) => window.confirm(`Zmienić rangę ${person.name} na ${roleNames[event.target.value as keyof typeof roleNames]}? Osoba zostanie wylogowana.`) && void update(`/users/${person.id}`, 'PATCH', { role: event.target.value })}>
                  {Object.entries(roleNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
                <button className="text-button danger" disabled={busy} onClick={() => window.confirm(`Wyłączyć dostęp ${person.name}?`) && void update(`/users/${person.id}`, 'PATCH', { role: person.role, active: false })}>Wyłącz</button>
              </>
            )}
          </div>
        ))}
      </section>
    </>
  )
}

function ChatPage({
  state,
  activeId,
  setActiveId,
  refresh,
}: {
  state: CrmState
  activeId: number | null
  setActiveId: (id: number | null) => void
  refresh: (silent?: boolean) => Promise<void>
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [groupMode, setGroupMode] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedPeople, setSelectedPeople] = useState<number[]>([])
  const [working, setWorking] = useState(false)
  const [chatError, setChatError] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)
  const active = state.chats.find((thread) => thread.id === activeId) || null
  const contacts = state.users.filter((person) => person.active && person.id !== state.user.id)

  useEffect(() => {
    if (!activeId && state.chats[0]) setActiveId(state.chats[0].id)
    if (activeId && !state.chats.some((thread) => thread.id === activeId)) setActiveId(state.chats[0]?.id || null)
  }, [activeId, setActiveId, state.chats])

  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let alive = true
    async function receive() {
      try {
        const result = await api<{ messages: ChatMessage[] }>(`/chat/threads/${activeId}/messages`)
        if (!alive) return
        setMessages(result.messages)
        await api(`/chat/threads/${activeId}/read`, 'POST', {})
        if (alive) await refresh(true)
      } catch (caught) {
        if (alive) setChatError(caught instanceof Error ? caught.message : 'Nie udało się pobrać wiadomości.')
      }
    }
    void receive()
    const timer = window.setInterval(() => void receive(), 4_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  async function createConversation(payload: { memberId?: number; memberIds?: number[]; name?: string }) {
    setWorking(true)
    setChatError('')
    try {
      const result = await api<{ threadId: number }>('/chat/threads', 'POST', payload)
      await refresh()
      setActiveId(result.threadId)
      setCreating(false)
      setSelectedPeople([])
      setGroupName('')
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : 'Nie udało się rozpocząć rozmowy.')
    } finally {
      setWorking(false)
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeId || !draft.trim()) return
    const body = draft
    setDraft('')
    setWorking(true)
    setChatError('')
    try {
      await api(`/chat/threads/${activeId}/messages`, 'POST', { body })
      const result = await api<{ messages: ChatMessage[] }>(`/chat/threads/${activeId}/messages`)
      setMessages(result.messages)
      await refresh(true)
    } catch (caught) {
      setDraft(body)
      setChatError(caught instanceof Error ? caught.message : 'Nie udało się wysłać wiadomości.')
    } finally {
      setWorking(false)
    }
  }

  function enableDeviceNotifications() {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  }

  return (
    <section className="chat-shell">
      <aside className="chat-list">
        <div className="chat-list-heading">
          <div><h2>Rozmowy</h2><p>{state.chats.length ? `${state.chats.length} aktywnych` : 'Zacznij pierwszą rozmowę'}</p></div>
          <button className="chat-new-button" aria-label="Nowa rozmowa" onClick={() => setCreating((value) => !value)}><Icon name={creating ? 'close' : 'plus'} /></button>
        </div>
        {creating && (
          <div className="chat-create">
            <div className="chat-create-tabs">
              <button className={!groupMode ? 'chosen' : ''} onClick={() => setGroupMode(false)}>1:1</button>
              <button className={groupMode ? 'chosen' : ''} onClick={() => setGroupMode(true)}>Grupa</button>
            </div>
            {groupMode ? (
              <>
                <input aria-label="Nazwa grupy" placeholder="Nazwa rozmowy" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
                <div className="chat-contact-list">
                  {contacts.map((person) => (
                    <label className="chat-contact check" key={person.id}>
                      <input type="checkbox" checked={selectedPeople.includes(person.id)} onChange={() => setSelectedPeople((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                      <span className="avatar tiny">{initials(person.name)}</span><strong>{person.name}</strong>
                    </label>
                  ))}
                </div>
                <button className="primary full" disabled={working || !groupName.trim() || !selectedPeople.length} onClick={() => void createConversation({ name: groupName, memberIds: selectedPeople })}>Utwórz grupę</button>
              </>
            ) : (
              <div className="chat-contact-list">
                {contacts.map((person) => (
                  <button className="chat-contact" disabled={working} key={person.id} onClick={() => void createConversation({ memberId: person.id })}>
                    <span className="avatar tiny">{initials(person.name)}</span><span><strong>{person.name}</strong><small>{roleNames[person.role]}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="chat-threads">
          {state.chats.map((thread) => (
            <button className={`chat-thread ${thread.id === activeId ? 'active' : ''}`} key={thread.id} onClick={() => setActiveId(thread.id)}>
              <span className="avatar">{initials(chatTitle(thread, state.user.id))}</span>
              <span className="grow"><strong>{chatTitle(thread, state.user.id)}</strong><small>{thread.last_message || (thread.kind === 'group' ? 'Rozmowa grupowa' : 'Nowa rozmowa')}</small></span>
              <span className="chat-thread-meta"><small>{thread.last_message_at ? new Date(thread.last_message_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : ''}</small>{thread.unread_count > 0 && <i>{thread.unread_count}</i>}</span>
            </button>
          ))}
          {!state.chats.length && !creating && <Empty icon="chat" title="Tu pojawią się rozmowy" text="Kliknij plus, aby napisać do pracownika lub utworzyć grupę." />}
        </div>
      </aside>
      <div className="chat-room">
        {active ? (
          <>
            <header className="chat-room-heading">
              <span className="avatar">{initials(chatTitle(active, state.user.id))}</span>
              <div className="grow"><h2>{chatTitle(active, state.user.id)}</h2><p>{active.kind === 'group' ? `${active.participants.length} osoby` : 'Rozmowa prywatna w CRM'}</p></div>
              {'Notification' in window && Notification.permission !== 'granted' && <button className="secondary device-notifications" onClick={enableDeviceNotifications}><Icon name="bell" />Powiadomienia na urządzeniu</button>}
            </header>
            <div className="chat-messages" aria-live="polite">
              {!messages.length && <Empty icon="chat" title="Napisz pierwszą wiadomość" text="Wiadomości w tej rozmowie są przechowywane wyłącznie w CRM." />}
              {messages.map((message, index) => {
                const mine = message.sender_id === state.user.id
                const showAvatar = !mine && messages[index - 1]?.sender_id !== message.sender_id
                return (
                  <div className={`chat-message-row ${mine ? 'mine' : ''}`} key={message.id}>
                    {!mine && (showAvatar ? <span className="avatar tiny">{initials(message.sender_name)}</span> : <span className="avatar-spacer" />)}
                    <div className="chat-message">
                      {!mine && showAvatar && <strong>{message.sender_name}</strong>}
                      <p>{message.body}</p>
                      <time>{new Date(message.created_at).toLocaleString('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>
            <form className="chat-composer" onSubmit={send}>
              <textarea rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Napisz wiadomość…" maxLength={4000} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
              <button className="primary" disabled={working || !draft.trim()} aria-label="Wyślij wiadomość"><Icon name="arrow" />Wyślij</button>
            </form>
          </>
        ) : <Empty icon="chat" title="Wybierz rozmowę" text="Możesz pisać prywatnie lub utworzyć rozmowę grupową dla zespołu." />}
        {chatError && <p className="error chat-error" role="alert">{chatError}</p>}
      </div>
    </section>
  )
}

function ChatHeads({
  state,
  open,
}: {
  state: CrmState
  open: (id: number | null) => void
}) {
  const unread = state.chats.filter((thread) => thread.unread_count > 0).slice(0, 3)
  return (
    <div className="chat-heads" aria-label="Szybki dostęp do komunikatora">
      {unread.map((thread) => (
        <button className="chat-head unread" key={thread.id} title={`${chatTitle(thread, state.user.id)}: ${thread.last_message || 'Nowa wiadomość'}`} onClick={() => open(thread.id)}>
          <span>{initials(chatTitle(thread, state.user.id))}</span><i>{thread.unread_count}</i>
        </button>
      ))}
      <button className="chat-head launcher" aria-label="Otwórz komunikator" onClick={() => open(null)}><Icon name="chat" />{unread.length > 0 && <i>{unread.reduce((sum, thread) => sum + thread.unread_count, 0)}</i>}</button>
    </div>
  )
}

function ActivityPage({
  state,
  busy,
  open,
  readAll,
}: {
  state: CrmState
  busy: boolean
  open: (activity: Activity) => void
  readAll: () => void
}) {
  const unread = state.activity.filter((entry) => !entry.seen)
  return (
    <section className="panel activity-panel">
      <div className="panel-heading">
        <div><h2>Centrum aktualizacji</h2><p>{unread.length ? `${unread.length} nieprzeczytanych` : 'Wszystko przeczytane'}</p></div>
        <button className="secondary" disabled={busy || !unread.length} onClick={readAll}>Oznacz wszystkie jako przeczytane</button>
      </div>
      {state.activity.length ? state.activity.map((activity) => (
        <button className={`activity-card ${activity.seen ? '' : 'unread'} ${activity.importance === 'high' ? 'important' : ''}`} key={activity.id} onClick={() => open(activity)}>
          <span className={`activity-icon ${activity.kind}`}><Icon name={activity.kind === 'leave' ? 'leaves' : activity.kind === 'task' ? 'tasks' : activity.kind === 'event' ? 'calendar' : activity.kind === 'access' ? 'team' : activity.kind === 'chat' ? 'chat' : 'companies'} /></span>
          <div className="grow"><strong>{activity.message}</strong><span>{activity.actor} · {formatDateTime(activity.created)}</span></div>
          {!activity.seen && <span className="new-label">NOWE</span>}
          <Icon name="arrow" />
        </button>
      )) : <Empty icon="bell" title="Jesteś na bieżąco" text="Ważne zmiany pojawią się tutaj oraz w banerze na górze." />}
    </section>
  )
}

export default function App() {
  const [state, setState] = useState<CrmState | null>(null)
  const [setup, setSetup] = useState<boolean | null>(null)
  const [setupTokenRequired, setSetupTokenRequired] = useState(false)
  const [page, setPage] = useState<Page>('home')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('Wszystkie')
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [preselectedTask, setPreselectedTask] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [month, setMonth] = useState(localToday().slice(0, 7))
  const [activeChatId, setActiveChatId] = useState<number | null>(null)
  const previousUnread = useRef<number | null>(null)
  const previousChatUnread = useRef<number | null>(null)
  const firstLoad = useRef(true)

  async function load(silent = false) {
    try {
      const next = await api<CrmState>('/state')
      const unread = next.activity.filter((entry) => !entry.seen)
      const chatUnread = next.chats.reduce((sum, thread) => sum + thread.unread_count, 0)
      const newestChat = next.chats.find((thread) => thread.unread_count > 0)
      const hasNewChat = silent && previousChatUnread.current !== null && chatUnread > previousChatUnread.current && newestChat
      if (hasNewChat) {
        setToast(`Nowa wiadomość od ${chatTitle(newestChat, next.user.id)}.`)
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`Wiadomość od ${chatTitle(newestChat, next.user.id)}`, { body: newestChat.last_message || 'Masz nową wiadomość w CRM.' })
        }
      } else if (silent && previousUnread.current !== null && unread.length > previousUnread.current && unread[0]) {
        setToast(unread[0].message)
      }
      previousUnread.current = unread.length
      previousChatUnread.current = chatUnread
      setState(next)
      setSetup(false)
      setError('')
      if (firstLoad.current) {
        firstLoad.current = false
        if (next.user.role === 'employee') setPage('day')
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setState(null)
        const status = await api<{ setup: boolean; setupTokenRequired: boolean }>('/auth/status')
        setSetup(status.setup)
        setSetupTokenRequired(status.setupTokenRequired)
      } else if (!silent) {
        setError(caught instanceof Error ? caught.message : 'Nie udało się odświeżyć CRM.')
      }
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const activityUnread = state?.activity.filter((entry) => !entry.seen).length || 0
    const chatUnread = state?.chats.reduce((sum, thread) => sum + thread.unread_count, 0) || 0
    const unread = Math.max(activityUnread, chatUnread)
    document.title = unread ? `(${unread}) eprom — CRM` : 'eprom — CRM'
  }, [state?.activity, state?.chats])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 5_000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function mutate(path: string, method: string, data: unknown, success = 'Zapisano zmiany.') {
    setBusy(true)
    setError('')
    try {
      await api(path, method, data)
      await load()
      setToast(success)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się zapisać zmian.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    try {
      await Promise.all([
        api(setup ? '/auth/setup' : '/auth/login', 'POST', data),
        new Promise((resolve) => window.setTimeout(resolve, 900)),
      ])
      await load()
      setSetup(false)
      setToast('Witaj w CRM.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się zalogować.')
    } finally {
      setBusy(false)
    }
  }

  function go(next: Page) {
    setPage(next)
    setQuery('')
    setFilter('Wszystkie')
    setSelectedCompany(null)
  }

  if (!state) {
    return <AuthScreen setup={setup} setupTokenRequired={setupTokenRequired} busy={busy} error={error} submit={login} />
  }

  const isAdmin = state.user.role === 'admin'
  const isManager = state.user.role !== 'employee'
  const unread = state.activity.filter((entry) => !entry.seen)
  const unreadChats = state.chats.reduce((sum, thread) => sum + thread.unread_count, 0)
  const action: Partial<Record<Page, ReactNode>> = {
    companies: isAdmin && <button className="primary" onClick={() => setEditor({ kind: 'company' })}><Icon name="plus" />Dodaj firmę</button>,
    tasks: isAdmin && <button className="primary" onClick={() => setEditor({ kind: 'task' })}><Icon name="plus" />Nowe zadanie</button>,
    leaves: <button className="primary" onClick={() => setEditor({ kind: 'leave' })}><Icon name="plus" />Zaplanuj urlop</button>,
    calendar: isManager && <button className="primary" onClick={() => setEditor({ kind: 'event' })}><Icon name="plus" />Nowe wydarzenie</button>,
    team: isAdmin && <button className="primary" onClick={() => setEditor({ kind: 'person' })}><Icon name="plus" />Dodaj pracownika</button>,
  }

  async function openActivity(activity: Activity) {
    if (!activity.seen) await mutate(`/activity/${activity.id}/read`, 'POST', {}, '')
    if (navigation.some(([id]) => id === activity.target_path) || ['activity', 'chat'].includes(activity.target_path)) {
      go(activity.target_path as Page)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand-button" onClick={() => go('home')}><Brand /></button>
        <div className="workspace-label"><span>E</span><div><strong>Przestrzeń firmowa</strong><small>Twój zespół w jednym miejscu</small></div></div>
        <div className="sidebar-navigation">
          <span className="nav-caption">PRZESTRZEŃ PRACY</span>
          <nav>
            {navigation.map(([id, label]) => (
              <button className={page === id ? 'active' : ''} key={id} onClick={() => go(id)}>
                <Icon name={id} />
                <span>{label}</span>
                {id === 'tasks' && state.tasks.filter((task) => task.status !== 'Gotowe').length > 0 && <i>{state.tasks.filter((task) => task.status !== 'Gotowe').length}</i>}
              </button>
            ))}
          </nav>
          <div className="nav-divider" />
          <span className="nav-caption">KOMUNIKACJA</span>
          <nav>
            <button className={page === 'chat' ? 'active notifications' : 'notifications'} onClick={() => go('chat')}><Icon name="chat" /><span>Komunikator</span>{unreadChats > 0 && <i className="urgent">{unreadChats}</i>}</button>
            <button className={page === 'activity' ? 'active notifications' : 'notifications'} onClick={() => go('activity')}><Icon name="bell" /><span>Aktualizacje</span>{unread.length > 0 && <i className="urgent">{unread.length}</i>}</button>
          </nav>
        </div>
        <div className="sidebar-account">
          <span className="avatar">{initials(state.user.name)}</span>
          <div><strong>{state.user.name}</strong><small>{roleNames[state.user.role]}</small></div>
          <button className="icon-button" aria-label="Wyloguj się" onClick={() => void mutate('/auth/logout', 'POST', {}, 'Wylogowano.')}><Icon name="logout" /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>Przestrzeń firmowa <b>/</b> <strong>{page === 'chat' ? 'Komunikator' : navigation.find(([id]) => id === page)?.[1] || 'Aktualizacje'}</strong></span>
          <div><button className="top-notification" aria-label={`${unread.length} nowych aktualizacji`} onClick={() => go('activity')}><Icon name="bell" />{unread.length > 0 && <span>{unread.length}</span>}</button><span className="avatar small">{initials(state.user.name)}</span></div>
        </header>
        <main className="content">
          <NotificationBanner notifications={unread} open={() => go('activity')} dismiss={() => void mutate('/activity/read', 'POST', {}, 'Aktualizacje oznaczone jako przeczytane.')} />
          <PageHeading page={page} name={state.user.name} action={action[page]} />
          {error && <div className="error page-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Zamknij">×</button></div>}
          {page === 'home' && <HomePage state={state} busy={busy} go={go} update={mutate} openTask={setSelectedTask} />}
          {page === 'day' && <DayPage state={state} busy={busy} update={mutate} preselectedTask={preselectedTask} clearPreselection={() => setPreselectedTask(null)} />}
          {page === 'companies' && <CompaniesPage state={state} query={query} setQuery={setQuery} selected={selectedCompany} setSelected={setSelectedCompany} edit={(company) => setEditor({ kind: 'company', item: company })} newTask={(companyId) => setEditor({ kind: 'task', companyId })} busy={busy} update={mutate} openTask={setSelectedTask} />}
          {page === 'tasks' && <TasksPage state={state} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} busy={busy} update={mutate} openTask={setSelectedTask} />}
          {page === 'leaves' && <LeavesPage state={state} month={month} setMonth={setMonth} busy={busy} update={mutate} />}
          {page === 'calendar' && <CalendarPage state={state} month={month} setMonth={setMonth} busy={busy} update={mutate} />}
          {page === 'team' && <TeamPage state={state} query={query} setQuery={setQuery} busy={busy} update={mutate} />}
          {page === 'chat' && <ChatPage state={state} activeId={activeChatId} setActiveId={setActiveChatId} refresh={load} />}
          {page === 'activity' && <ActivityPage state={state} busy={busy} open={openActivity} readAll={() => void mutate('/activity/read', 'POST', {}, 'Wszystkie aktualizacje są przeczytane.')} />}
          <footer><span>eprom / workspace</span><span>Porządek w pracy. Przestrzeń dla ludzi.</span></footer>
        </main>
      </div>
      {editor && <EntityEditor modal={editor} state={state} busy={busy} error={error} close={() => { setEditor(null); setError('') }} save={mutate} />}
      {selectedTask && <TaskDetails task={selectedTask} state={state} close={() => setSelectedTask(null)} edit={() => { setEditor({ kind: 'task', item: selectedTask }); setSelectedTask(null) }} openDay={() => { setPreselectedTask(selectedTask.id); setSelectedTask(null); go('day') }} />}
      <ChatHeads state={state} open={(id) => { setActiveChatId(id); go('chat') }} />
      {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
    </div>
  )
}
