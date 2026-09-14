const isoDate = (date) => date.toISOString().slice(0, 10)

export function todayInTimeZone(date = new Date(), timeZone = process.env.CRM_TIMEZONE || 'Europe/Warsaw') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return isoDate(date)
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

export function nextOccurrence(current, cadence, interval, startsOn) {
  if (cadence === 'daily') return addDays(current, interval)
  if (cadence === 'weekly') return addDays(current, interval * 7)

  const currentDate = new Date(`${current}T12:00:00Z`)
  const anchor = new Date(`${startsOn}T12:00:00Z`)
  const months = cadence === 'yearly' ? interval * 12 : interval
  const targetMonth = currentDate.getUTCMonth() + months
  const year = currentDate.getUTCFullYear() + Math.floor(targetMonth / 12)
  const month = ((targetMonth % 12) + 12) % 12
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month))
  return isoDate(new Date(Date.UTC(year, month, day, 12)))
}

export function materializeRecurringTasks(db, notify) {
  const today = todayInTimeZone()
  const horizon = addDays(today, 45)
  const notifyUntil = addDays(today, 7)
  const series = db.prepare(`
    SELECT * FROM task_series
    WHERE active = 1 AND next_occurrence_on <= ?
    ORDER BY next_occurrence_on
  `).all(horizon)

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tasks(
      company_id, title, due, priority, status, assignee_id, description,
      series_id, occurrence_on, source, created_by, created_at, updated_at, archived
    ) VALUES(?, ?, ?, ?, 'Do zrobienia', ?, ?, ?, ?, 'recurring', ?, ?, ?, 0)
  `)
  const updateNext = db.prepare(`
    UPDATE task_series SET next_occurrence_on = ?, active = ?, updated_at = ? WHERE id = ?
  `)

  for (const item of series) {
    let occurrence = item.next_occurrence_on
    let generated = 0

    while (occurrence <= horizon && (!item.ends_on || occurrence <= item.ends_on)) {
      const timestamp = new Date().toISOString()
      const result = insert.run(
        item.company_id,
        item.title,
        occurrence,
        item.priority,
        item.assignee_id,
        item.description,
        item.id,
        occurrence,
        item.created_by,
        timestamp,
        timestamp,
      )

      if (Number(result.changes) === 1 && occurrence <= notifyUntil) {
        notify({
          recipientId: item.assignee_id,
          actor: 'Plan cykliczny',
          message: `Nowe zadanie cykliczne: „${item.title}” na ${occurrence}.`,
          kind: 'task',
          importance: occurrence <= today ? 'high' : 'normal',
          targetPath: 'tasks',
          dedupeKey: `series:${item.id}:${occurrence}`,
        })
      }

      occurrence = nextOccurrence(occurrence, item.cadence, item.interval_n, item.starts_on)
      generated += 1
      if (generated > 200) throw new Error(`Seria ${item.id} przekroczyła limit generowania.`)
    }

    const active = item.ends_on && occurrence > item.ends_on ? 0 : 1
    updateNext.run(occurrence, active, new Date().toISOString(), item.id)
  }
}
