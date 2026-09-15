import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { extname, relative, resolve } from 'node:path'
import { migrate } from './schema.mjs'
import { addDays, materializeRecurringTasks, todayInTimeZone } from './recurrence.mjs'

const storage = resolve(process.env.CRM_DATA_DIR || 'data')
mkdirSync(storage, { recursive: true })

const db = new DatabaseSync(resolve(storage, 'crm.sqlite'))
migrate(db)
db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now())

const LEAVE_TYPES = [
  'Wypoczynkowy',
  'Na żądanie',
  'Bezpłatny',
  'Opieka nad dzieckiem',
  'Okolicznościowy',
  'Chorobowe',
  'Inny',
]
const TASK_STATUSES = ['Do zrobienia', 'W trakcie', 'Gotowe']
const TASK_PRIORITIES = ['Normalny', 'Wysoki', 'Pilny']
const ROLES = ['admin', 'director', 'employee']
const PLAN_STATUSES = ['Zaplanowane', 'W trakcie', 'Zrobione']
const RECURRENCES = ['daily', 'weekly', 'monthly', 'yearly']
const allowedOrigins = new Set(
  (process.env.CRM_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

const all = (sql, ...params) => db.prepare(sql).all(...params)
const one = (sql, ...params) => db.prepare(sql).get(...params)
const run = (sql, ...params) => db.prepare(sql).run(...params)
const timestamp = () => new Date().toISOString()

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status })
}

function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function required(value, label, max = 200) {
  const result = text(value, max)
  if (!result) fail(`Uzupełnij: ${label}.`)
  return result
}

function validEmail(value) {
  const result = required(value, 'e-mail').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Podaj poprawny e-mail.')
  return result
}

function validId(value, optional = false) {
  if (optional && (value === '' || value === null || value === undefined)) return null
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1) fail('Nieprawidłowy identyfikator.')
  return result
}

function validDate(value, optional = false) {
  if (optional && !value) return null
  const result = text(value)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result)
    || !Number.isFinite(Date.parse(`${result}T12:00:00Z`))
    || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result
  ) fail('Nieprawidłowa data.')
  return result
}

function validTime(value) {
  const result = text(value)
  if (result && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) fail('Nieprawidłowa godzina.')
  return result
}

function validChoice(value, values) {
  if (!values.includes(value)) fail('Nieprawidłowa wartość.')
  return value
}

function validInteger(value, minimum, maximum, label) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    fail(`Nieprawidłowa wartość: ${label}.`)
  }
  return result
}

function hashPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    fail('Hasło musi mieć od 12 do 128 znaków.')
  }
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`
}

function verifyPassword(value, stored) {
  try {
    const [salt, key] = stored.split(':')
    if (typeof value !== 'string' || value.length > 128 || !salt || !key) return false
    const expected = Buffer.from(key, 'hex')
    const received = scryptSync(value, salt, 64)
    return expected.length === received.length && timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

const tokenHash = (value) => createHash('sha256').update(value).digest('hex')
const publicUser = (user, includeEmail = true) => ({
  id: user.id,
  name: user.name,
  ...(includeEmail ? { email: user.email } : {}),
  role: user.role,
  active: user.active,
})

function transaction(operation) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function requireAdmin(user) {
  if (user.role !== 'admin') fail('Ta funkcja jest dostępna dla administratora.', 403)
}

function requireManager(user) {
  if (!['admin', 'director'].includes(user.role)) {
    fail('Urlopy akceptuje administrator lub dyrektor.', 403)
  }
}

function activeUser(value) {
  const user = one('SELECT * FROM users WHERE id = ? AND active = 1', validId(value))
  if (!user) fail('Pracownik nie istnieje lub jest nieaktywny.')
  return user
}

function canAccessCompany(user, companyId) {
  if (user.role === 'admin') return true
  return Boolean(one(`
    SELECT c.id
    FROM companies c
    LEFT JOIN tasks t ON t.company_id = c.id AND t.archived = 0
    WHERE c.id = ? AND c.archived = 0 AND (c.owner_id = ? OR t.assignee_id = ?)
    LIMIT 1
  `, companyId, user.id, user.id))
}

function companyForUser(value, user) {
  const companyId = validId(value)
  const company = one('SELECT * FROM companies WHERE id = ? AND archived = 0', companyId)
  if (!company) fail('Nie znaleziono firmy.', 404)
  if (!canAccessCompany(user, companyId)) fail('Nie masz dostępu do tej firmy.', 403)
  return company
}

function taskForUser(value, user) {
  const task = one('SELECT * FROM tasks WHERE id = ? AND archived = 0', validId(value))
  if (!task) fail('Nie znaleziono zadania.', 404)
  if (user.role !== 'admin' && task.assignee_id !== user.id) {
    fail('Nie masz dostępu do tego zadania.', 403)
  }
  return task
}

function notify({
  recipientId,
  actor,
  message,
  kind = 'info',
  importance = 'normal',
  targetPath = '',
  dedupeKey = null,
  seen = 0,
}) {
  return run(`
    INSERT OR IGNORE INTO activity(
      user_id, actor, message, created, seen, kind, importance, target_path, dedupe_key
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, recipientId, actor, message, timestamp(), seen, kind, importance, targetPath, dedupeKey)
}

function notifyPeople(ids, actor, details, actorId = null) {
  for (const recipientId of new Set(ids.filter(Boolean))) {
    notify({
      recipientId,
      actor,
      seen: recipientId === actorId ? 1 : 0,
      ...details,
    })
  }
}

function managerIds(exceptId = null) {
  return all(`
    SELECT id FROM users
    WHERE active = 1 AND role IN ('admin', 'director') AND id <> COALESCE(?, -1)
  `, exceptId).map((user) => user.id)
}

function startSession(response, user) {
  const token = randomBytes(32).toString('hex')
  run('INSERT INTO sessions(token, user_id, expires) VALUES(?, ?, ?)',
    tokenHash(token), user.id, Date.now() + 12 * 60 * 60 * 1000)
  const secure = process.env.CRM_SECURE_COOKIE === 'true' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `crm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`,
  )
  return publicUser(user)
}

async function parseBody(request) {
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (Buffer.byteLength(raw) > 64 * 1024) fail('Zbyt duże żądanie.', 413)
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    fail('Nieprawidłowe dane.')
  }
}

function getClientIp(request) {
  if (process.env.CRM_TRUST_PROXY === 'cloudflare') {
    const candidate = text(request.headers['cf-connecting-ip'], 64)
    if (/^[0-9a-f:.]+$/i.test(candidate)) return candidate
  }
  return request.socket.remoteAddress || 'unknown'
}

function checkOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return
  const host = request.headers.host
  const sameOrigin = origin === `https://${host}` || origin === `http://${host}`
  if (!sameOrigin && !allowedOrigins.has(origin)) fail('Niedozwolone źródło żądania.', 403)
}

const authAttempts = new Map()
const dummyHash = hashPassword(randomBytes(24).toString('hex'))

function enforceLoginRateLimit(request) {
  const ip = getClientIp(request)
  const current = Date.now()
  const recent = (authAttempts.get(ip) || []).filter((entry) => current - entry < 10 * 60 * 1000)
  if (recent.length >= 15) fail('Zbyt wiele prób. Spróbuj za 10 minut.', 429)
  recent.push(current)
  authAttempts.set(ip, recent)
  return ip
}

function currentUser(request) {
  const cookie = (request.headers.cookie || '')
    .split('; ')
    .find((item) => item.startsWith('crm_session='))
  const token = cookie?.slice('crm_session='.length) || ''
  return one(`
    SELECT u.*
    FROM users u
    JOIN sessions s ON s.user_id = u.id
    WHERE s.token = ? AND s.expires > ? AND u.active = 1
  `, tokenHash(token), Date.now())
}

function chatThreadForUser(value, user) {
  const thread = one(`
    SELECT t.*, m.last_read_message_id
    FROM chat_threads t
    JOIN chat_members m ON m.thread_id = t.id
    WHERE t.id = ? AND m.user_id = ?
  `, validId(value), user.id)
  if (!thread) fail('Nie masz dostępu do tej rozmowy.', 403)
  return thread
}

function chatThreadsFor(user) {
  return all(`
    SELECT
      t.id, t.name, t.kind, t.updated_at, m.last_read_message_id,
      (SELECT body FROM chat_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM chat_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*) FROM chat_messages
        WHERE thread_id = t.id AND id > m.last_read_message_id AND sender_id <> ?) AS unread_count
    FROM chat_threads t
    JOIN chat_members m ON m.thread_id = t.id
    WHERE m.user_id = ?
    ORDER BY COALESCE(last_message_at, t.updated_at) DESC, t.id DESC
  `, user.id, user.id).map((thread) => ({
    ...thread,
    participants: all(`
      SELECT u.id, u.name, u.role, u.active
      FROM chat_members member
      JOIN users u ON u.id = member.user_id
      WHERE member.thread_id = ?
      ORDER BY u.name
    `, thread.id),
  }))
}

function stateFor(user) {
  materializeRecurringTasks(db, notify)
  const companies = user.role === 'admin'
    ? all('SELECT * FROM companies WHERE archived = 0 ORDER BY name')
    : all(`
        SELECT DISTINCT c.*
        FROM companies c
        LEFT JOIN tasks t ON t.company_id = c.id AND t.archived = 0
        WHERE c.archived = 0 AND (c.owner_id = ? OR t.assignee_id = ?)
        ORDER BY c.name
      `, user.id, user.id)
  const tasks = user.role === 'admin'
    ? all('SELECT * FROM tasks WHERE archived = 0 ORDER BY due, id')
    : all('SELECT * FROM tasks WHERE archived = 0 AND assignee_id = ? ORDER BY due, id', user.id)
  const series = user.role === 'admin'
    ? all('SELECT * FROM task_series ORDER BY active DESC, next_occurrence_on, id')
    : all('SELECT * FROM task_series WHERE assignee_id = ? AND active = 1 ORDER BY next_occurrence_on', user.id)
  const users = all('SELECT id, name, email, role, active FROM users ORDER BY active DESC, name')
    .map((person) => publicUser(person, user.role === 'admin' || person.id === user.id))
  const leaves = all(`
    SELECT l.*, u.name, reviewer.name AS reviewer_name
    FROM leaves l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN users reviewer ON reviewer.id = l.reviewer_id
    ORDER BY l.start, l.id
  `)
    .filter((leave) => user.role !== 'employee' || leave.user_id === user.id || leave.status === 'Zaakceptowany')
    .map((leave) => user.role === 'employee' && leave.user_id !== user.id
      ? { ...leave, note: '', decision_note: '', leave_type: 'Nieobecność' }
      : leave)
  const today = todayInTimeZone()
  const planStart = addDays(today, -31)
  const planEnd = addDays(today, 120)
  const plans = user.role === 'employee'
    ? all(`
        SELECT p.*, u.name, c.name AS company_name, t.title AS task_title
        FROM daily_plan_items p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN companies c ON c.id = p.company_id
        LEFT JOIN tasks t ON t.id = p.task_id
        WHERE p.user_id = ? AND p.plan_date BETWEEN ? AND ?
        ORDER BY p.plan_date, p.planned_start, p.position, p.id
      `, user.id, planStart, planEnd)
    : all(`
        SELECT p.*, u.name, c.name AS company_name, t.title AS task_title
        FROM daily_plan_items p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN companies c ON c.id = p.company_id
        LEFT JOIN tasks t ON t.id = p.task_id
        WHERE p.plan_date BETWEEN ? AND ?
        ORDER BY p.plan_date, p.planned_start, p.position, p.id
      `, planStart, planEnd)

  return {
    user: publicUser(user),
    users,
    companies,
    tasks,
    series,
    plans,
    leaves,
    leaveTypes: LEAVE_TYPES,
    events: all('SELECT * FROM events ORDER BY date, time, id'),
    activity: all('SELECT * FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 250', user.id),
    chats: chatThreadsFor(user),
  }
}

async function handleApi(request, response, path) {
  const method = request.method || 'GET'
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) fail('Metoda niedostępna.', 405)
  if (method !== 'GET') {
    checkOrigin(request)
    if (!request.headers['content-type']?.startsWith('application/json')) fail('Wymagany JSON.', 415)
  }

  if (path === '/api/health' && method === 'GET') {
    return { ok: true, database: true, version: 5 }
  }
  if (path === '/api/auth/status' && method === 'GET') {
    return {
      setup: !one('SELECT id FROM users LIMIT 1'),
      setupTokenRequired: Boolean(process.env.CRM_SETUP_TOKEN),
    }
  }

  const data = method === 'GET' ? {} : await parseBody(request)

  if (['/api/auth/setup', '/api/auth/login'].includes(path) && method === 'POST') {
    const ip = enforceLoginRateLimit(request)
    if (path.endsWith('/setup')) {
      if (process.env.CRM_SETUP_TOKEN && data.setupToken !== process.env.CRM_SETUP_TOKEN) {
        fail('Nieprawidłowy kod uruchomieniowy.', 403)
      }
      const name = required(data.name, 'imię i nazwisko')
      const email = validEmail(data.email)
      const password = hashPassword(data.password)
      const user = transaction(() => {
        if (one('SELECT id FROM users LIMIT 1')) fail('Administrator został już utworzony.', 409)
        const created = run(
          "INSERT INTO users(name, email, password, role) VALUES(?, ?, ?, 'admin')",
          name,
          email,
          password,
        )
        return one('SELECT * FROM users WHERE id = ?', Number(created.lastInsertRowid))
      })
      authAttempts.delete(ip)
      return { user: startSession(response, user) }
    }

    const user = one('SELECT * FROM users WHERE email = ? AND active = 1', text(data.email).toLowerCase())
    const passwordMatches = verifyPassword(data.password, user?.password || dummyHash)
    if (!user || !passwordMatches) {
      fail('Nieprawidłowy e-mail lub hasło.', 401)
    }
    authAttempts.delete(ip)
    return { user: startSession(response, user) }
  }

  const user = currentUser(request)
  if (!user) fail('Zaloguj się, aby kontynuować.', 401)

  if (path === '/api/auth/logout' && method === 'POST') {
    const cookie = (request.headers.cookie || '')
      .split('; ')
      .find((item) => item.startsWith('crm_session='))
    if (cookie) run('DELETE FROM sessions WHERE token = ?', tokenHash(cookie.slice('crm_session='.length)))
    response.setHeader('Set-Cookie', 'crm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
    return { ok: true }
  }

  if (path === '/api/state' && method === 'GET') return stateFor(user)

  let match

  if (path === '/api/chat/threads' && method === 'POST') {
    const requestedMembers = Array.isArray(data.memberIds) ? data.memberIds : [data.memberId]
    const memberIds = [...new Set(requestedMembers.map((value) => validId(value)))]
      .filter((id) => id !== user.id)
    if (!memberIds.length) fail('Wybierz co najmniej jednego rozmówcę.')
    const participants = memberIds.map((id) => activeUser(id))
    const kind = memberIds.length === 1 && !text(data.name) ? 'direct' : 'group'

    if (kind === 'direct') {
      const existing = one(`
        SELECT t.id
        FROM chat_threads t
        JOIN chat_members first ON first.thread_id = t.id AND first.user_id = ?
        JOIN chat_members second ON second.thread_id = t.id AND second.user_id = ?
        WHERE t.kind = 'direct'
          AND (SELECT COUNT(*) FROM chat_members WHERE thread_id = t.id) = 2
        LIMIT 1
      `, user.id, memberIds[0])
      if (existing) return { ok: true, threadId: existing.id }
    }

    const name = kind === 'group'
      ? required(data.name, 'nazwa rozmowy grupowej', 80)
      : ''
    const createdAt = timestamp()
    const created = transaction(() => {
      const result = run(`
        INSERT INTO chat_threads(name, kind, created_by, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?)
      `, name, kind, user.id, createdAt, createdAt)
      const threadId = Number(result.lastInsertRowid)
      for (const participantId of [user.id, ...participants.map((person) => person.id)]) {
        run(`
          INSERT INTO chat_members(thread_id, user_id, joined_at, last_read_message_id)
          VALUES(?, ?, ?, 0)
        `, threadId, participantId, createdAt)
      }
      return threadId
    })
    return { ok: true, threadId: created }
  }

  if ((match = path.match(/^\/api\/chat\/threads\/(\d+)\/messages$/)) && method === 'GET') {
    const thread = chatThreadForUser(match[1], user)
    return {
      messages: all(`
        SELECT message.id, message.thread_id, message.sender_id, sender.name AS sender_name,
               message.body, message.created_at
        FROM chat_messages message
        JOIN users sender ON sender.id = message.sender_id
        WHERE message.thread_id = ?
        ORDER BY message.id DESC
        LIMIT 300
      `, thread.id).reverse(),
    }
  }

  if ((match = path.match(/^\/api\/chat\/threads\/(\d+)\/messages$/)) && method === 'POST') {
    const thread = chatThreadForUser(match[1], user)
    const body = required(data.body, 'treść wiadomości', 4000)
    const sentAt = timestamp()
    const messageId = transaction(() => {
      const result = run(`
        INSERT INTO chat_messages(thread_id, sender_id, body, created_at)
        VALUES(?, ?, ?, ?)
      `, thread.id, user.id, body, sentAt)
      const id = Number(result.lastInsertRowid)
      run('UPDATE chat_threads SET updated_at = ? WHERE id = ?', sentAt, thread.id)
      run(`
        UPDATE chat_members SET last_read_message_id = ?
        WHERE thread_id = ? AND user_id = ?
      `, id, thread.id, user.id)
      const recipients = all(`
        SELECT user_id FROM chat_members WHERE thread_id = ? AND user_id <> ?
      `, thread.id, user.id).map((member) => member.user_id)
      notifyPeople(recipients, user.name, {
        message: `${user.name}: ${body.slice(0, 140)}`,
        kind: 'chat',
        importance: 'high',
        targetPath: 'chat',
        dedupeKey: `chat:${thread.id}:${id}`,
      }, user.id)
      return id
    })
    return { ok: true, messageId }
  }

  if ((match = path.match(/^\/api\/chat\/threads\/(\d+)\/read$/)) && method === 'POST') {
    const thread = chatThreadForUser(match[1], user)
    const lastMessage = one(
      'SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE thread_id = ?',
      thread.id,
    ).id
    transaction(() => {
      run(`
        UPDATE chat_members SET last_read_message_id = ?
        WHERE thread_id = ? AND user_id = ?
      `, lastMessage, thread.id, user.id)
      run(`
        UPDATE activity SET seen = 1
        WHERE user_id = ? AND kind = 'chat' AND dedupe_key LIKE ?
      `, user.id, `chat:${thread.id}:%`)
    })
    return { ok: true }
  }

  if (path === '/api/users' && method === 'POST') {
    requireAdmin(user)
    const name = required(data.name, 'imię i nazwisko')
    const email = validEmail(data.email)
    const password = hashPassword(data.password)
    const role = validChoice(data.role, ROLES)
    if (one('SELECT id FROM users WHERE email = ?', email)) fail('Ten adres jest już zajęty.', 409)
    run('INSERT INTO users(name, email, password, role) VALUES(?, ?, ?, ?)', name, email, password, role)
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/users\/(\d+)$/)) && method === 'PATCH') {
    requireAdmin(user)
    const target = one('SELECT * FROM users WHERE id = ?', validId(match[1]))
    if (!target) fail('Nie znaleziono pracownika.', 404)
    const role = validChoice(data.role, ROLES)
    const active = data.active === false ? 0 : 1
    if (target.role === 'admin' && (role !== 'admin' || !active)) {
      const admins = one("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").count
      if (admins <= 1) fail('Musi pozostać co najmniej jeden aktywny administrator.')
    }
    transaction(() => {
      run('UPDATE users SET role = ?, active = ? WHERE id = ?', role, active, target.id)
      run('DELETE FROM sessions WHERE user_id = ?', target.id)
      notify({
        recipientId: target.id,
        actor: user.name,
        message: `Twoje uprawnienia zmieniono na: ${role === 'admin' ? 'Administrator' : role === 'director' ? 'Dyrektor' : 'Pracownik'}.`,
        kind: 'access',
        importance: 'high',
        targetPath: 'team',
      })
    })
    return { ok: true }
  }

  if (path === '/api/companies' && method === 'POST') {
    requireAdmin(user)
    const owner = activeUser(data.owner_id)
    const name = required(data.name, 'nazwa firmy')
    transaction(() => {
      run(`
        INSERT INTO companies(name, contact, email, phone, notes, owner_id, status)
        VALUES(?, ?, ?, ?, ?, ?, ?)
      `,
      name,
      text(data.contact),
      text(data.email),
      text(data.phone),
      text(data.notes, 5000),
      owner.id,
      validChoice(data.status || 'Aktywna', ['Aktywna', 'Potencjalna', 'Wstrzymana']),
      )
      notifyPeople([owner.id, user.id], user.name, {
        message: `Przypisano firmę „${name}” do ${owner.name}.`,
        kind: 'company',
        importance: 'high',
        targetPath: 'companies',
      }, user.id)
    })
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/companies\/(\d+)$/)) && ['PATCH', 'DELETE'].includes(method)) {
    requireAdmin(user)
    const company = companyForUser(match[1], user)
    transaction(() => {
      if (method === 'DELETE') {
        run('UPDATE companies SET archived = 1 WHERE id = ?', company.id)
        run('UPDATE tasks SET archived = 1, updated_at = ? WHERE company_id = ?', timestamp(), company.id)
        run('UPDATE task_series SET active = 0, updated_at = ? WHERE company_id = ?', timestamp(), company.id)
        notifyPeople([company.owner_id, user.id], user.name, {
          message: `Zarchiwizowano firmę „${company.name}” wraz z jej zadaniami.`,
          kind: 'company',
          importance: 'high',
          targetPath: 'companies',
        }, user.id)
      } else {
        const owner = activeUser(data.owner_id)
        const name = required(data.name, 'nazwa firmy')
        run(`
          UPDATE companies
          SET name = ?, contact = ?, email = ?, phone = ?, notes = ?, owner_id = ?, status = ?
          WHERE id = ?
        `,
        name,
        text(data.contact),
        text(data.email),
        text(data.phone),
        text(data.notes, 5000),
        owner.id,
        validChoice(data.status, ['Aktywna', 'Potencjalna', 'Wstrzymana']),
        company.id,
        )
        notifyPeople([company.owner_id, owner.id, user.id], user.name, {
          message: `Zmieniono dane firmy „${name}”. Opiekun: ${owner.name}.`,
          kind: 'company',
          importance: company.owner_id === owner.id ? 'normal' : 'high',
          targetPath: 'companies',
        }, user.id)
      }
    })
    return { ok: true }
  }

  if (path === '/api/tasks' && method === 'POST') {
    requireAdmin(user)
    const company = companyForUser(data.company_id, user)
    const assignee = activeUser(data.assignee_id || company.owner_id)
    const title = required(data.title, 'nazwa zadania')
    const description = text(data.description, 5000)
    const priority = validChoice(data.priority, TASK_PRIORITIES)
    const due = validDate(data.due)
    const isRecurring = data.recurring === true || data.recurring === 'true'

    transaction(() => {
      if (isRecurring) {
        const cadence = validChoice(data.cadence, RECURRENCES)
        const interval = validInteger(data.interval_n || 1, 1, 365, 'częstotliwość')
        const endsOn = validDate(data.ends_on, true)
        if (endsOn && endsOn < due) fail('Koniec cyklu nie może być przed pierwszym terminem.')
        const created = run(`
          INSERT INTO task_series(
            company_id, assignee_id, title, description, priority, cadence, interval_n,
            starts_on, ends_on, next_occurrence_on, created_by, created_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        company.id,
        assignee.id,
        title,
        description,
        priority,
        cadence,
        interval,
        due,
        endsOn,
        due,
        user.id,
        timestamp(),
        timestamp(),
        )
        notifyPeople([assignee.id, user.id], user.name, {
          message: `Utworzono zadanie cykliczne „${title}” dla ${assignee.name}.`,
          kind: 'task',
          importance: 'high',
          targetPath: 'tasks',
          dedupeKey: `series-created:${Number(created.lastInsertRowid)}:${assignee.id}`,
        }, user.id)
      } else {
        run(`
          INSERT INTO tasks(
            company_id, title, due, priority, status, assignee_id, description,
            source, created_by, created_at, updated_at, archived
          ) VALUES(?, ?, ?, ?, 'Do zrobienia', ?, ?, 'assigned', ?, ?, ?, 0)
        `, company.id, title, due, priority, assignee.id, description, user.id, timestamp(), timestamp())
        notifyPeople([assignee.id, user.id], user.name, {
          message: `Nowe zadanie „${title}” dla ${assignee.name}, termin ${due}.`,
          kind: 'task',
          importance: priority === 'Pilny' ? 'high' : 'normal',
          targetPath: 'tasks',
        }, user.id)
      }
    })
    materializeRecurringTasks(db, notify)
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/tasks\/(\d+)$/)) && ['PATCH', 'DELETE'].includes(method)) {
    const task = taskForUser(match[1], user)
    const company = one('SELECT * FROM companies WHERE id = ?', task.company_id)
    if (method === 'DELETE') {
      requireAdmin(user)
      run('UPDATE tasks SET archived = 1, updated_at = ? WHERE id = ?', timestamp(), task.id)
      notifyPeople([task.assignee_id, user.id], user.name, {
        message: `Usunięto zadanie „${task.title}” z firmy „${company.name}”.`,
        kind: 'task',
        importance: 'high',
        targetPath: 'tasks',
      }, user.id)
      return { ok: true }
    }

    const status = validChoice(data.status ?? task.status, TASK_STATUSES)
    let title = task.title
    let due = task.due
    let priority = task.priority
    let description = task.description
    let assigneeId = task.assignee_id
    if (user.role === 'admin') {
      title = data.title === undefined ? task.title : required(data.title, 'nazwa zadania')
      due = data.due === undefined ? task.due : validDate(data.due)
      priority = data.priority === undefined ? task.priority : validChoice(data.priority, TASK_PRIORITIES)
      description = data.description === undefined ? task.description : text(data.description, 5000)
      assigneeId = data.assignee_id === undefined ? task.assignee_id : activeUser(data.assignee_id).id
    } else if (['title', 'due', 'priority', 'description', 'assignee_id', 'company_id'].some((key) => key in data)) {
      fail('Możesz zmienić wyłącznie status przypisanego zadania.', 403)
    }
    run(`
      UPDATE tasks
      SET title = ?, due = ?, priority = ?, description = ?, assignee_id = ?, status = ?,
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `,
    title,
    due,
    priority,
    description,
    assigneeId,
    status,
    status === 'Gotowe' ? timestamp() : null,
    timestamp(),
    task.id,
    )
    const supervisors = user.role === 'admin' ? [] : managerIds()
    notifyPeople([task.assignee_id, assigneeId, ...supervisors, user.id], user.name, {
      message: `${company.name}: „${title}” — ${status}.`,
      kind: 'task',
      importance: status === 'Gotowe' ? 'normal' : priority === 'Pilny' ? 'high' : 'normal',
      targetPath: 'tasks',
    }, user.id)
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/task-series\/(\d+)$/)) && method === 'PATCH') {
    requireAdmin(user)
    const series = one('SELECT * FROM task_series WHERE id = ?', validId(match[1]))
    if (!series) fail('Nie znaleziono serii zadań.', 404)
    const active = data.active === true ? 1 : data.active === false ? 0 : series.active
    run('UPDATE task_series SET active = ?, updated_at = ? WHERE id = ?', active, timestamp(), series.id)
    notifyPeople([series.assignee_id, user.id], user.name, {
      message: `${active ? 'Wznowiono' : 'Wstrzymano'} cykl „${series.title}”.`,
      kind: 'task',
      importance: 'high',
      targetPath: 'tasks',
    }, user.id)
    if (active) materializeRecurringTasks(db, notify)
    return { ok: true }
  }

  if (path === '/api/plans' && method === 'POST') {
    const planDate = validDate(data.plan_date)
    const plannedStart = validTime(data.planned_start)
    const plannedMinutes = validInteger(data.planned_minutes || 60, 15, 720, 'czas planu')
    const title = required(data.title, 'punkt planu')
    const details = text(data.details, 3000)
    const taskId = validId(data.task_id, true)
    let companyId = validId(data.company_id, true)
    const linkedTask = taskId ? taskForUser(taskId, user) : null
    if (companyId) companyForUser(companyId, user)
    if (linkedTask && companyId && linkedTask.company_id !== companyId) {
      fail('Wybrane zadanie należy do innej firmy.')
    }
    companyId ||= linkedTask?.company_id || null
    const position = one(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM daily_plan_items WHERE user_id = ? AND plan_date = ?',
      user.id,
      planDate,
    ).next
    run(`
      INSERT INTO daily_plan_items(
        user_id, plan_date, planned_start, planned_minutes, title, details,
        company_id, task_id, position, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    user.id,
    planDate,
    plannedStart,
    plannedMinutes,
    title,
    details,
    companyId,
    taskId,
    position,
    timestamp(),
    timestamp(),
    )
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/plans\/(\d+)$/)) && ['PATCH', 'DELETE'].includes(method)) {
    const plan = one('SELECT * FROM daily_plan_items WHERE id = ?', validId(match[1]))
    if (!plan) fail('Nie znaleziono punktu planu.', 404)
    if (plan.user_id !== user.id) fail('Możesz zmieniać wyłącznie własny plan dnia.', 403)
    if (method === 'DELETE') {
      run('DELETE FROM daily_plan_items WHERE id = ?', plan.id)
      return { ok: true }
    }
    const status = data.status === undefined ? plan.status : validChoice(data.status, PLAN_STATUSES)
    const title = data.title === undefined ? plan.title : required(data.title, 'punkt planu')
    const details = data.details === undefined ? plan.details : text(data.details, 3000)
    const plannedStart = data.planned_start === undefined ? plan.planned_start : validTime(data.planned_start)
    const plannedMinutes = data.planned_minutes === undefined
      ? plan.planned_minutes
      : validInteger(data.planned_minutes, 15, 720, 'czas planu')
    run(`
      UPDATE daily_plan_items
      SET status = ?, title = ?, details = ?, planned_start = ?, planned_minutes = ?, updated_at = ?
      WHERE id = ?
    `, status, title, details, plannedStart, plannedMinutes, timestamp(), plan.id)
    return { ok: true }
  }

  if (path === '/api/leaves' && method === 'POST') {
    const start = validDate(data.start)
    const end = validDate(data.end)
    const leaveType = validChoice(data.leave_type, LEAVE_TYPES)
    if (end < start) fail('Koniec urlopu nie może być przed początkiem.')
    if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > 365) {
      fail('Jeden wniosek może obejmować najwyżej rok.')
    }
    if (one(`
      SELECT id FROM leaves
      WHERE user_id = ? AND status IN ('Oczekuje', 'Zaakceptowany') AND start <= ? AND end >= ?
    `, user.id, end, start)) fail('Masz już wniosek obejmujący ten termin.')
    transaction(() => {
      run(`
        INSERT INTO leaves(user_id, start, end, note, status, leave_type, created_at)
        VALUES(?, ?, ?, ?, 'Oczekuje', ?, ?)
      `, user.id, start, end, text(data.note, 2000), leaveType, timestamp())
      notifyPeople(managerIds(user.id), user.name, {
        message: `Nowy wniosek: ${leaveType}, ${start} – ${end}.`,
        kind: 'leave',
        importance: 'high',
        targetPath: 'leaves',
      }, user.id)
    })
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/leaves\/(\d+)$/)) && method === 'PATCH') {
    const leave = one('SELECT * FROM leaves WHERE id = ?', validId(match[1]))
    if (!leave) fail('Nie znaleziono wniosku.', 404)
    const status = validChoice(data.status, ['Zaakceptowany', 'Odrzucony', 'Anulowany'])
    if (status === 'Anulowany') {
      if (leave.user_id !== user.id) fail('Możesz anulować wyłącznie swój wniosek.', 403)
    } else {
      requireManager(user)
      if (leave.user_id === user.id && user.role !== 'admin') {
        fail('Własny urlop dyrektora zatwierdza administrator lub inny dyrektor.', 403)
      }
    }
    const result = run(`
      UPDATE leaves
      SET status = ?, reviewer_id = ?, decision_note = ?, decided_at = ?
      WHERE id = ? AND status = 'Oczekuje'
    `,
    status,
    user.id,
    text(data.decision_note, 1000),
    timestamp(),
    leave.id,
    )
    if (Number(result.changes) !== 1) fail('Ten wniosek został już rozpatrzony.', 409)
    notifyPeople([leave.user_id, user.id], user.name, {
      message: `${leave.leave_type}: ${leave.start} – ${leave.end} — ${status.toLowerCase()}.`,
      kind: 'leave',
      importance: 'high',
      targetPath: 'leaves',
    }, user.id)
    return { ok: true }
  }

  if (path === '/api/events' && method === 'POST') {
    requireManager(user)
    const title = required(data.title, 'tytuł wydarzenia')
    const eventDate = validDate(data.date)
    const time = validTime(data.time)
    run(`
      INSERT INTO events(title, date, time, description, created_by)
      VALUES(?, ?, ?, ?, ?)
    `, title, eventDate, time, text(data.description, 2000), user.id)
    notifyPeople(all('SELECT id FROM users WHERE active = 1').map((person) => person.id), user.name, {
      message: `Nowe wydarzenie „${title}” — ${eventDate}${time ? `, ${time}` : ''}.`,
      kind: 'event',
      importance: 'normal',
      targetPath: 'calendar',
    }, user.id)
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/events\/(\d+)$/)) && method === 'DELETE') {
    requireManager(user)
    const event = one('SELECT * FROM events WHERE id = ?', validId(match[1]))
    if (!event) fail('Nie znaleziono wydarzenia.', 404)
    if (user.role !== 'admin' && event.created_by !== user.id) {
      fail('Możesz usunąć tylko własne wydarzenie.', 403)
    }
    run('DELETE FROM events WHERE id = ?', event.id)
    notifyPeople(all('SELECT id FROM users WHERE active = 1').map((person) => person.id), user.name, {
      message: `Odwołano wydarzenie „${event.title}”.`,
      kind: 'event',
      importance: 'high',
      targetPath: 'calendar',
    }, user.id)
    return { ok: true }
  }

  if (path === '/api/activity/read' && method === 'POST') {
    run('UPDATE activity SET seen = 1 WHERE user_id = ?', user.id)
    return { ok: true }
  }

  if ((match = path.match(/^\/api\/activity\/(\d+)\/read$/)) && method === 'POST') {
    run('UPDATE activity SET seen = 1 WHERE id = ? AND user_id = ?', validId(match[1]), user.id)
    return { ok: true }
  }

  fail('Nie znaleziono tej funkcji.', 404)
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'same-origin')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  if (process.env.CRM_SECURE_COOKIE === 'true') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  )
}

const server = createServer(async (request, response) => {
  setSecurityHeaders(response)
  try {
    const path = new URL(request.url || '/', 'http://localhost').pathname
    if (path.startsWith('/api/')) {
      response.setHeader('Cache-Control', 'no-store')
      const result = await handleApi(request, response, path)
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(result))
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') fail('Metoda niedostępna.', 405)
    const root = resolve('dist')
    const decoded = decodeURIComponent(path)
    let file = resolve(root, `.${decoded}`)
    const relation = relative(root, file)
    if (relation.startsWith('..') || relation.includes(':')) fail('Niedozwolona ścieżka.', 403)
    if (!extname(file) || !existsSync(file)) file = resolve(root, 'index.html')
    if (!existsSync(file)) fail('Najpierw zbuduj aplikację.', 404)
    const extension = extname(file)
    response.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream')
    response.setHeader(
      'Cache-Control',
      file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    )
    if (request.method === 'HEAD') response.end()
    else response.end(readFileSync(file))
  } catch (error) {
    response.statusCode = error.status || 500
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: error.status ? error.message : 'Nie udało się wykonać operacji.' }))
    if (!error.status) console.error(error)
  }
})

const port = Number(process.env.PORT || 4310)
const host = process.env.CRM_HOST || '127.0.0.1'
server.listen(port, host, () => console.log(`CRM: http://${host}:${port}`))

function shutdown() {
  server.close(() => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      db.close()
    } finally {
      process.exit(0)
    }
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
