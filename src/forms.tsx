import { useMemo, useState, type FormEvent } from 'react'
import type { CalendarEvent, Company, CrmState, Leave, Task } from './types'
import { Badge, Dialog, Icon, formatDate, initials, localToday } from './ui'

export type EditorKind = 'company' | 'task' | 'person' | 'leave' | 'event'
export type EditorState = {
  kind: EditorKind
  item?: Company | Task | Leave | CalendarEvent
  companyId?: number
}

type Save = (path: string, method: string, data: unknown) => Promise<boolean>

export function EntityEditor({
  modal,
  state,
  busy,
  error,
  close,
  save,
}: {
  modal: EditorState
  state: CrmState
  busy: boolean
  error: string
  close: () => void
  save: Save
}) {
  const item = modal.item as unknown as Record<string, string | number | null> | undefined
  const [recurring, setRecurring] = useState(false)
  const firstCompany = modal.companyId || Number(item?.company_id) || state.companies[0]?.id || 0
  const [companyId, setCompanyId] = useState(firstCompany)
  const defaultOwner = state.companies.find((company) => company.id === companyId)?.owner_id
  const [assigneeId, setAssigneeId] = useState(Number(item?.assignee_id) || defaultOwner || state.user.id)
  const title = item
    ? `Edytuj ${modal.kind === 'company' ? 'firmę' : modal.kind === 'task' ? 'zadanie' : 'wpis'}`
    : ({
        company: 'Nowa firma',
        task: 'Nowe zadanie',
        person: 'Dodaj pracownika',
        leave: 'Zaplanuj urlop',
        event: 'Nowe wydarzenie',
      } as Record<EditorKind, string>)[modal.kind]

  const activePeople = state.users.filter((person) => person.active)

  const field = (
    label: string,
    name: string,
    type = 'text',
    required = true,
    value?: string | number,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={value ?? item?.[name] ?? (type === 'date' ? localToday() : '')}
        maxLength={type === 'password' ? 128 : 200}
        minLength={type === 'password' ? 12 : undefined}
      />
    </label>
  )

  const select = (
    label: string,
    name: string,
    options: Array<[string | number, string]>,
    value?: string | number,
  ) => (
    <label>
      {label}
      <select name={name} required defaultValue={value ?? item?.[name] ?? options[0]?.[0]}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const data: Record<string, FormDataEntryValue | boolean> = Object.fromEntries(form)
    if (modal.kind === 'task') data.recurring = form.has('recurring')
    const basePaths: Record<EditorKind, string> = {
      company: '/companies',
      task: '/tasks',
      person: '/users',
      leave: '/leaves',
      event: '/events',
    }
    const ok = await save(`${basePaths[modal.kind]}${item ? `/${item.id}` : ''}`, item ? 'PATCH' : 'POST', data)
    if (ok) close()
  }

  return (
    <Dialog close={() => !busy && close()} wide={modal.kind === 'task'}>
      <form className="editor-form" onSubmit={submit}>
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">EPROM / WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Zamknij" disabled={busy} onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        {modal.kind === 'company' && (
          <>
            {field('Nazwa firmy', 'name')}
            {select('Opiekun firmy', 'owner_id', activePeople.map((person) => [person.id, person.name]))}
            <div className="form-pair">
              {field('Osoba kontaktowa', 'contact', 'text', false)}
              {field('Telefon', 'phone', 'tel', false)}
            </div>
            {field('E-mail kontaktowy', 'email', 'email', false)}
            {select('Status relacji', 'status', ['Aktywna', 'Potencjalna', 'Wstrzymana'].map((value) => [value, value]))}
            <label>
              Informacje, zakres współpracy i stałe obowiązki
              <textarea name="notes" rows={7} maxLength={5000} defaultValue={String(item?.notes || '')} />
            </label>
          </>
        )}

        {modal.kind === 'task' && (
          <>
            <div className="form-pair">
              {field('Nazwa zadania', 'title')}
              <label>
                Firma
                <select
                  name="company_id"
                  required
                  value={companyId}
                  disabled={Boolean(item)}
                  onChange={(event) => {
                    const nextCompanyId = Number(event.target.value)
                    setCompanyId(nextCompanyId)
                    setAssigneeId(state.companies.find((company) => company.id === nextCompanyId)?.owner_id || state.user.id)
                  }}
                >
                  {state.companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
                </select>
              </label>
            </div>
            <label>
              Dokładny opis i oczekiwany efekt
              <textarea
                name="description"
                rows={7}
                maxLength={5000}
                defaultValue={String(item?.description || '')}
                placeholder="Co trzeba wykonać, jakie są materiały i po czym poznamy, że zadanie jest gotowe?"
              />
            </label>
            <div className="form-triple">
              {field('Termin / pierwszy termin', 'due', 'date')}
              {select('Priorytet', 'priority', ['Normalny', 'Wysoki', 'Pilny'].map((value) => [value, value]))}
              <label>
                Przypisany pracownik
                <select name="assignee_id" value={assigneeId} onChange={(event) => setAssigneeId(Number(event.target.value))}>
                  {activePeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
                </select>
              </label>
            </div>
            {item && select('Status', 'status', ['Do zrobienia', 'W trakcie', 'Gotowe'].map((value) => [value, value]))}
            {!item && (
              <div className="recurrence-box">
                <label className="check-label">
                  <input
                    type="checkbox"
                    name="recurring"
                    checked={recurring}
                    onChange={(event) => setRecurring(event.target.checked)}
                  />
                  <span><Icon name="repeat" /></span>
                  <div>
                    <strong>Zadanie cykliczne</strong>
                    <small>CRM sam utworzy kolejne wystąpienia. Cykl może ustawić tylko administrator.</small>
                  </div>
                </label>
                {recurring && (
                  <div className="recurrence-fields">
                    {select('Powtarzaj', 'cadence', [
                      ['daily', 'Co określoną liczbę dni'],
                      ['weekly', 'Co określoną liczbę tygodni'],
                      ['monthly', 'Co określoną liczbę miesięcy'],
                      ['yearly', 'Co określoną liczbę lat'],
                    ])}
                    {field('Co ile', 'interval_n', 'number', true, 1)}
                    {field('Koniec cyklu (opcjonalnie)', 'ends_on', 'date', false, '')}
                  </div>
                )}
              </div>
            )}
            {item?.series_id && (
              <p className="form-hint">
                To pojedyncze wystąpienie zadania cyklicznego. Zmiana nie modyfikuje całej serii.
              </p>
            )}
            {!state.companies.length && <p className="error">Najpierw dodaj firmę.</p>}
          </>
        )}

        {modal.kind === 'person' && (
          <>
            {field('Imię i nazwisko', 'name')}
            {field('E-mail do logowania', 'email', 'email')}
            {select('Ranga', 'role', [
              ['employee', 'Pracownik'],
              ['director', 'Dyrektor'],
              ['admin', 'Administrator'],
            ], 'employee')}
            {field('Hasło początkowe (minimum 12 znaków)', 'password', 'password')}
            <p className="form-hint">Przekaż hasło pracownikowi bezpiecznym kanałem. Konto należy wyłącznie do CRM.</p>
          </>
        )}

        {modal.kind === 'leave' && (
          <>
            {select('Rodzaj nieobecności', 'leave_type', state.leaveTypes.map((value) => [value, value]))}
            <div className="form-pair">
              {field('Od', 'start', 'date')}
              {field('Do', 'end', 'date')}
            </div>
            <label>
              Wiadomość do osoby zatwierdzającej
              <textarea name="note" rows={5} maxLength={2000} placeholder="Opcjonalna informacja organizacyjna" />
            </label>
            <p className="form-hint">
              Administrator może zatwierdzić każdy wniosek, również własny. Dyrektor zatwierdza wnioski innych osób.
            </p>
          </>
        )}

        {modal.kind === 'event' && (
          <>
            {field('Nazwa wydarzenia', 'title')}
            <div className="form-pair">
              {field('Data', 'date', 'date')}
              {field('Godzina (opcjonalnie)', 'time', 'time', false, '')}
            </div>
            <label>
              Szczegóły
              <textarea name="description" rows={5} maxLength={2000} />
            </label>
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          {item && ['company', 'task'].includes(modal.kind) && (
            <button
              type="button"
              className="text-button danger"
              disabled={busy}
              onClick={async () => {
                const label = modal.kind === 'company' ? 'firmę i jej zadania' : 'zadanie'
                if (window.confirm(`Zarchiwizować ${label}?`)) {
                  const path = modal.kind === 'company' ? '/companies' : '/tasks'
                  if (await save(`${path}/${item.id}`, 'DELETE', {})) close()
                }
              }}
            >
              Zarchiwizuj
            </button>
          )}
          <span className="grow" />
          <button type="button" className="secondary" disabled={busy} onClick={close}>Anuluj</button>
          <button
            className="primary"
            disabled={busy || (modal.kind === 'task' && !state.companies.length)}
          >
            {busy ? 'Zapisywanie…' : modal.kind === 'leave' ? 'Wyślij wniosek' : 'Zapisz'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function TaskDetails({
  task,
  state,
  close,
  edit,
  openDay,
}: {
  task: Task
  state: CrmState
  close: () => void
  edit: () => void
  openDay: () => void
}) {
  const company = state.companies.find((entry) => entry.id === task.company_id)
  const assignee = state.users.find((entry) => entry.id === task.assignee_id)
  const linkedPlans = useMemo(
    () => state.plans.filter((plan) => plan.task_id === task.id),
    [state.plans, task.id],
  )

  return (
    <Dialog close={close} wide>
      <article className="task-details">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">SZCZEGÓŁY ZADANIA</span>
            <h2>{task.title}</h2>
          </div>
          <button className="icon-button" aria-label="Zamknij" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="task-detail-grid">
          <div className="task-description">
            <h3>Opis zadania</h3>
            {task.description
              ? <p>{task.description}</p>
              : <p className="muted">Administrator nie dodał jeszcze dokładnego opisu.</p>}
            <h3>Plan wykonania pracownika</h3>
            {linkedPlans.length ? (
              <div className="linked-plans">
                {linkedPlans.map((plan) => (
                  <div key={plan.id}>
                    <span>{formatDate(plan.plan_date, true)}{plan.planned_start ? ` · ${plan.planned_start}` : ''}</span>
                    <strong>{plan.title}</strong>
                    {plan.details && <p>{plan.details}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">To zadanie nie zostało jeszcze dodane do planu dnia.</p>
            )}
          </div>
          <aside className="task-facts">
            <h3>Informacje</h3>
            <dl>
              <div><dt>Firma</dt><dd>{company?.name || '—'}</dd></div>
              <div><dt>Pracownik</dt><dd><span className="avatar tiny">{initials(assignee?.name || '?')}</span>{assignee?.name || '—'}</dd></div>
              <div><dt>Termin</dt><dd>{formatDate(task.due, true)}</dd></div>
              <div><dt>Priorytet</dt><dd><Badge value={task.priority} /></dd></div>
              <div><dt>Status</dt><dd><Badge value={task.status} /></dd></div>
              {task.series_id && <div><dt>Tryb</dt><dd><Badge value="Zadanie cykliczne" /></dd></div>}
            </dl>
            <div className="task-fact-actions">
              {task.assignee_id === state.user.id && (
                <button className="primary" onClick={openDay}><Icon name="day" />Dodaj do planu dnia</button>
              )}
              {state.user.role === 'admin' && (
                <button className="secondary" onClick={edit}>Edytuj zadanie</button>
              )}
            </div>
          </aside>
        </div>
      </article>
    </Dialog>
  )
}
