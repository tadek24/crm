import assert from 'node:assert/strict'
import { createServer as createNetServer } from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { nextOccurrence, todayInTimeZone } from '../server/recurrence.mjs'

const APP_ROOT = new URL('../', import.meta.url)
const PASSWORD = 'Test-password-2026'

function passwordHash(value) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`
}

function isoDate(value) {
  return value.toISOString().slice(0, 10)
}

function dateFromToday(days) {
  const value = new Date()
  value.setUTCHours(12, 0, 0, 0)
  value.setUTCDate(value.getUTCDate() + days)
  return isoDate(value)
}

async function freePort() {
  const listener = createNetServer()
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const address = listener.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return port
}

function createLegacyDatabase(directory) {
  const db = new DatabaseSync(join(directory, 'crm.sqlite'))
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE sessions(
      token TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      expires INTEGER NOT NULL
    );
    CREATE TABLE companies(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      owner_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'Aktywna'
    );
    CREATE TABLE tasks(
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Do zrobienia'
    );
    CREATE TABLE activity(
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      actor TEXT NOT NULL,
      message TEXT NOT NULL,
      created TEXT NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE leaves(
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Oczekuje',
      reviewer_id INTEGER REFERENCES users(id)
    );
    CREATE TABLE events(
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id)
    );
  `)

  const insertUser = db.prepare(
    'INSERT INTO users(id, name, email, password, role, active) VALUES(?, ?, ?, ?, ?, 1)',
  )
  insertUser.run(1, 'Test Admin', 'admin@test.pl', passwordHash(PASSWORD), 'admin')
  insertUser.run(2, 'Test Dyrektor', 'director@test.pl', passwordHash(PASSWORD), 'director')
  insertUser.run(3, 'Test Pracownik', 'employee@test.pl', passwordHash(PASSWORD), 'employee')
  db.prepare(`
    INSERT INTO companies(id, name, owner_id, status)
    VALUES(1, 'Firma migracyjna', 3, 'Aktywna')
  `).run()
  db.prepare(`
    INSERT INTO tasks(id, company_id, title, due, priority, status)
    VALUES(1, 1, 'Stare zadanie', ?, 'Normalny', 'Do zrobienia')
  `).run(dateFromToday(20))
  db.prepare(`
    INSERT INTO leaves(id, user_id, start, end, note, status)
    VALUES(1, 3, ?, ?, 'Stary wniosek', 'Odrzucony')
  `).run(dateFromToday(-20), dateFromToday(-19))
  db.close()
}

async function startApplication(directory) {
  const port = await freePort()
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      CRM_DATA_DIR: directory,
      CRM_HOST: '127.0.0.1',
      PORT: String(port),
      PORT_PORT: '',
      CRM_SECURE_COOKIE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Serwer nie wystartował. ${stderr}`)), 10_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Serwer zakończył pracę kodem ${code}. ${stderr}`))
    })
    child.stdout.once('data', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
    },
  }
}

async function request(baseUrl, path, { method = 'GET', data, cookie = '' } = {}) {
  const headers = {}
  if (cookie) headers.Cookie = cookie
  if (method !== 'GET') headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const result = await response.json()
  return {
    status: response.status,
    data: result,
    cookie: response.headers.get('set-cookie')?.split(';', 1)[0] || '',
  }
}

async function login(baseUrl, email) {
  const response = await request(baseUrl, '/auth/login', {
    method: 'POST',
    data: { email, password: PASSWORD },
  })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  assert.match(response.cookie, /^crm_session=/)
  return response.cookie
}

let directory
let application
let baseUrl
let adminCookie
let directorCookie
let employeeCookie

test.before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'eprom-crm-test-'))
  createLegacyDatabase(directory)
  application = await startApplication(directory)
  baseUrl = application.baseUrl
  adminCookie = await login(baseUrl, 'admin@test.pl')
  directorCookie = await login(baseUrl, 'director@test.pl')
  employeeCookie = await login(baseUrl, 'employee@test.pl')
})

test.after(async () => {
  if (application) await application.stop()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

test('migracja zachowuje rekordy starej bazy i uzupełnia nowy schemat', async () => {
  const state = await request(baseUrl, '/state', { cookie: adminCookie })
  assert.equal(state.status, 200)
  assert.equal(state.data.companies.some((company) => company.name === 'Firma migracyjna'), true)
  const legacyTask = state.data.tasks.find((task) => task.title === 'Stare zadanie')
  assert.ok(legacyTask)
  assert.equal(legacyTask.assignee_id, 3)
  assert.equal(legacyTask.source, 'assigned')
  assert.match(legacyTask.created_at, /^\d{4}-\d{2}-\d{2}T/)
  const legacyLeave = state.data.leaves.find((leave) => leave.note === 'Stary wniosek')
  assert.ok(legacyLeave)
  assert.equal(legacyLeave.leave_type, 'Wypoczynkowy')

  const db = new DatabaseSync(join(directory, 'crm.sqlite'), { readOnly: true })
  try {
    assert.deepEqual(
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(({ version }) => version),
      [1, 2, 3, 4, 5],
    )
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_series'").get())
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_plan_items'").get())
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_threads'").get())
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_messages'").get())
  } finally {
    db.close()
  }
})

test('uprawnienia urlopowe: admin może własny, dyrektor tylko cudzy, pracownik nie akceptuje', async () => {
  const adminStart = dateFromToday(60)
  const adminEnd = dateFromToday(61)
  assert.equal((await request(baseUrl, '/leaves', {
    method: 'POST', cookie: adminCookie,
    data: { start: adminStart, end: adminEnd, leave_type: 'Wypoczynkowy', note: 'Urlop administratora' },
  })).status, 200)
  let state = (await request(baseUrl, '/state', { cookie: adminCookie })).data
  const adminLeave = state.leaves.find((leave) => leave.start === adminStart && leave.user_id === 1)
  assert.ok(adminLeave)
  assert.equal((await request(baseUrl, `/leaves/${adminLeave.id}`, {
    method: 'PATCH', cookie: adminCookie,
    data: { status: 'Zaakceptowany', decision_note: 'Akceptacja właścicielska' },
  })).status, 200)

  const employeeStart = dateFromToday(70)
  const employeeEnd = dateFromToday(71)
  assert.equal((await request(baseUrl, '/leaves', {
    method: 'POST', cookie: employeeCookie,
    data: { start: employeeStart, end: employeeEnd, leave_type: 'Na żądanie' },
  })).status, 200)
  state = (await request(baseUrl, '/state', { cookie: directorCookie })).data
  const employeeLeave = state.leaves.find((leave) => leave.start === employeeStart && leave.user_id === 3)
  assert.ok(employeeLeave)
  assert.equal((await request(baseUrl, `/leaves/${employeeLeave.id}`, {
    method: 'PATCH', cookie: directorCookie, data: { status: 'Zaakceptowany' },
  })).status, 200)

  const directorStart = dateFromToday(80)
  const directorEnd = dateFromToday(81)
  assert.equal((await request(baseUrl, '/leaves', {
    method: 'POST', cookie: directorCookie,
    data: { start: directorStart, end: directorEnd, leave_type: 'Okolicznościowy' },
  })).status, 200)
  state = (await request(baseUrl, '/state', { cookie: directorCookie })).data
  const directorLeave = state.leaves.find((leave) => leave.start === directorStart && leave.user_id === 2)
  assert.ok(directorLeave)
  assert.equal((await request(baseUrl, `/leaves/${directorLeave.id}`, {
    method: 'PATCH', cookie: directorCookie, data: { status: 'Zaakceptowany' },
  })).status, 403)
  assert.equal((await request(baseUrl, `/leaves/${directorLeave.id}`, {
    method: 'PATCH', cookie: employeeCookie, data: { status: 'Zaakceptowany' },
  })).status, 403)
})

test('rodzaj urlopu jest wymagany, walidowany i zwracany w stanie', async () => {
  const start = dateFromToday(90)
  const end = dateFromToday(91)
  assert.equal((await request(baseUrl, '/leaves', {
    method: 'POST', cookie: employeeCookie,
    data: { start, end, leave_type: 'Bezpłatny', note: 'Test typu' },
  })).status, 200)
  const state = (await request(baseUrl, '/state', { cookie: employeeCookie })).data
  const leave = state.leaves.find((item) => item.start === start)
  assert.equal(leave.leave_type, 'Bezpłatny')
  assert.equal(state.leaveTypes.includes('Bezpłatny'), true)

  const invalid = await request(baseUrl, '/leaves', {
    method: 'POST', cookie: employeeCookie,
    data: { start: dateFromToday(100), end: dateFromToday(101), leave_type: 'Nieistniejący typ' },
  })
  assert.equal(invalid.status, 400)
})

test('seria cykliczna materializuje wystąpienia tylko raz', async () => {
  const firstDue = dateFromToday(2)
  const endsOn = dateFromToday(4)
  const created = await request(baseUrl, '/tasks', {
    method: 'POST', cookie: adminCookie,
    data: {
      company_id: 1,
      assignee_id: 3,
      title: 'Codzienny raport',
      description: 'Uzupełnić stan prac.',
      priority: 'Wysoki',
      due: firstDue,
      recurring: true,
      cadence: 'daily',
      interval_n: 1,
      ends_on: endsOn,
    },
  })
  assert.equal(created.status, 200, JSON.stringify(created.data))

  const firstState = (await request(baseUrl, '/state', { cookie: adminCookie })).data
  const series = firstState.series.find((item) => item.title === 'Codzienny raport')
  assert.ok(series)
  const firstOccurrences = firstState.tasks.filter((task) => task.series_id === series.id)
  assert.deepEqual(firstOccurrences.map((task) => task.occurrence_on), [
    dateFromToday(2), dateFromToday(3), dateFromToday(4),
  ])

  const secondState = (await request(baseUrl, '/state', { cookie: adminCookie })).data
  const secondOccurrences = secondState.tasks.filter((task) => task.series_id === series.id)
  assert.equal(secondOccurrences.length, firstOccurrences.length)
  assert.equal(new Set(secondOccurrences.map((task) => task.occurrence_on)).size, secondOccurrences.length)
})

test('cykl miesięczny zachowuje dzień bazowy, a dzisiejsza data używa strefy Warszawy', () => {
  assert.equal(nextOccurrence('2027-01-31', 'monthly', 1, '2027-01-31'), '2027-02-28')
  assert.equal(nextOccurrence('2027-02-28', 'monthly', 1, '2027-01-31'), '2027-03-31')
  assert.equal(nextOccurrence('2028-02-28', 'yearly', 1, '2024-02-29'), '2029-02-28')
  assert.equal(todayInTimeZone(new Date('2026-09-11T22:30:00Z'), 'Europe/Warsaw'), '2026-09-12')
})

test('pracownik tworzy i zmienia własny plan, a inna osoba nie może go edytować', async () => {
  const planDate = dateFromToday(3)
  const created = await request(baseUrl, '/plans', {
    method: 'POST', cookie: employeeCookie,
    data: {
      plan_date: planDate,
      planned_start: '09:15',
      planned_minutes: 75,
      title: 'Przygotowanie oferty',
      details: 'Analiza wymagań i pierwszy szkic.',
      company_id: 1,
      task_id: 1,
    },
  })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  let state = (await request(baseUrl, '/state', { cookie: employeeCookie })).data
  const plan = state.plans.find((item) => item.plan_date === planDate && item.title === 'Przygotowanie oferty')
  assert.ok(plan)
  assert.equal(plan.user_id, 3)
  assert.equal(plan.task_id, 1)

  assert.equal((await request(baseUrl, `/plans/${plan.id}`, {
    method: 'PATCH', cookie: employeeCookie,
    data: { status: 'W trakcie', details: 'Oferta jest w przygotowaniu.' },
  })).status, 200)
  state = (await request(baseUrl, '/state', { cookie: employeeCookie })).data
  assert.equal(state.plans.find((item) => item.id === plan.id).status, 'W trakcie')

  const foreignEdit = await request(baseUrl, `/plans/${plan.id}`, {
    method: 'PATCH', cookie: directorCookie, data: { status: 'Zrobione' },
  })
  assert.equal(foreignEdit.status, 403)
  state = (await request(baseUrl, '/state', { cookie: employeeCookie })).data
  assert.equal(state.plans.find((item) => item.id === plan.id).status, 'W trakcie')
})

test('komunikator tworzy rozmowę, dostarcza wiadomość i zapisuje odczyt', async () => {
  const created = await request(baseUrl, '/chat/threads', {
    method: 'POST', cookie: adminCookie, data: { memberId: 3 },
  })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  assert.ok(created.data.threadId)

  const sent = await request(baseUrl, `/chat/threads/${created.data.threadId}/messages`, {
    method: 'POST', cookie: adminCookie, data: { body: 'Wiadomość testowa dla pracownika.' },
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.data))

  let employeeState = (await request(baseUrl, '/state', { cookie: employeeCookie })).data
  const thread = employeeState.chats.find((item) => item.id === created.data.threadId)
  assert.ok(thread)
  assert.equal(thread.unread_count, 1)
  assert.equal(thread.last_message, 'Wiadomość testowa dla pracownika.')

  const messages = await request(baseUrl, `/chat/threads/${created.data.threadId}/messages`, {
    cookie: employeeCookie,
  })
  assert.equal(messages.status, 200)
  assert.equal(messages.data.messages.at(-1).body, 'Wiadomość testowa dla pracownika.')

  assert.equal((await request(baseUrl, `/chat/threads/${created.data.threadId}/read`, {
    method: 'POST', cookie: employeeCookie, data: {},
  })).status, 200)
  employeeState = (await request(baseUrl, '/state', { cookie: employeeCookie })).data
  assert.equal(employeeState.chats.find((item) => item.id === created.data.threadId).unread_count, 0)

  const outsider = await request(baseUrl, `/chat/threads/${created.data.threadId}/messages`, {
    cookie: directorCookie,
  })
  assert.equal(outsider.status, 403)
})
