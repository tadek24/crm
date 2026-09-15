const now = () => new Date().toISOString()

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column)
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function runMigration(db, version, name, migrate) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)
  if (applied) return

  db.exec('BEGIN IMMEDIATE')
  try {
    migrate()
    db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)')
      .run(version, name, now())
    db.exec(`PRAGMA user_version = ${version}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function migrate(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS schema_migrations(
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  runMigration(db, 1, 'legacy_base', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS companies(
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        contact TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        owner_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'Aktywna'
      );
      CREATE TABLE IF NOT EXISTS tasks(
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        due TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Do zrobienia'
      );
      CREATE TABLE IF NOT EXISTS activity(
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        actor TEXT NOT NULL,
        message TEXT NOT NULL,
        created TEXT NOT NULL,
        seen INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS leaves(
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Oczekuje',
        reviewer_id INTEGER REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS events(
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL REFERENCES users(id)
      );
    `)
  })

  runMigration(db, 2, 'crm_task_and_leave_details', () => {
    addColumn(db, 'companies', 'archived', 'INTEGER NOT NULL DEFAULT 0')

    addColumn(db, 'tasks', 'assignee_id', 'INTEGER REFERENCES users(id)')
    addColumn(db, 'tasks', 'description', "TEXT NOT NULL DEFAULT ''")
    addColumn(db, 'tasks', 'series_id', 'INTEGER')
    addColumn(db, 'tasks', 'occurrence_on', 'TEXT')
    addColumn(db, 'tasks', 'source', "TEXT NOT NULL DEFAULT 'assigned'")
    addColumn(db, 'tasks', 'created_by', 'INTEGER REFERENCES users(id)')
    addColumn(db, 'tasks', 'created_at', "TEXT NOT NULL DEFAULT ''")
    addColumn(db, 'tasks', 'updated_at', "TEXT NOT NULL DEFAULT ''")
    addColumn(db, 'tasks', 'completed_at', 'TEXT')
    addColumn(db, 'tasks', 'archived', 'INTEGER NOT NULL DEFAULT 0')
    db.exec(`
      UPDATE tasks
      SET assignee_id = COALESCE(
        assignee_id,
        (SELECT owner_id FROM companies WHERE companies.id = tasks.company_id)
      );
      UPDATE tasks SET created_at = COALESCE(NULLIF(created_at, ''), '${now()}');
      UPDATE tasks SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at);
    `)

    addColumn(db, 'leaves', 'leave_type', "TEXT NOT NULL DEFAULT 'Wypoczynkowy'")
    addColumn(db, 'leaves', 'decision_note', "TEXT NOT NULL DEFAULT ''")
    addColumn(db, 'leaves', 'created_at', "TEXT NOT NULL DEFAULT ''")
    addColumn(db, 'leaves', 'decided_at', 'TEXT')
    db.exec(`UPDATE leaves SET created_at = COALESCE(NULLIF(created_at, ''), '${now()}')`)

    addColumn(db, 'activity', 'kind', "TEXT NOT NULL DEFAULT 'info'")
    addColumn(db, 'activity', 'importance', "TEXT NOT NULL DEFAULT 'normal'")
    addColumn(db, 'activity', 'target_path', "TEXT NOT NULL DEFAULT ''")
    addColumn(db, 'activity', 'dedupe_key', 'TEXT')
  })

  runMigration(db, 3, 'recurring_tasks_and_daily_plans', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_series(
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        assignee_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL,
        cadence TEXT NOT NULL,
        interval_n INTEGER NOT NULL DEFAULT 1,
        starts_on TEXT NOT NULL,
        ends_on TEXT,
        next_occurrence_on TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_plan_items(
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        plan_date TEXT NOT NULL,
        planned_start TEXT NOT NULL DEFAULT '',
        planned_minutes INTEGER NOT NULL DEFAULT 60,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        company_id INTEGER REFERENCES companies(id),
        task_id INTEGER REFERENCES tasks(id),
        status TEXT NOT NULL DEFAULT 'Zaplanowane',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_series_occurrence
        ON tasks(series_id, occurrence_on)
        WHERE series_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_daily_plan_user_date
        ON daily_plan_items(user_id, plan_date, position);
    `)
  })

  runMigration(db, 4, 'production_indexes', () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires);
      CREATE INDEX IF NOT EXISTS idx_companies_owner_active ON companies(owner_id, archived);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee_due ON tasks(assignee_id, due, archived);
      CREATE INDEX IF NOT EXISTS idx_tasks_company_active ON tasks(company_id, archived);
      CREATE INDEX IF NOT EXISTS idx_leaves_user_dates ON leaves(user_id, start, end);
      CREATE INDEX IF NOT EXISTS idx_leaves_pending ON leaves(status) WHERE status = 'Oczekuje';
      CREATE INDEX IF NOT EXISTS idx_activity_recipient_seen ON activity(user_id, seen, id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_dedupe
        ON activity(user_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_task_series_next ON task_series(active, next_occurrence_on);
      PRAGMA optimize;
    `)
  })

  runMigration(db, 5, 'crm_messenger', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_threads(
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL CHECK(kind IN ('direct', 'group')),
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_members(
        thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        joined_at TEXT NOT NULL,
        last_read_message_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(thread_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS chat_messages(
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, thread_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, id);
      CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC);
      PRAGMA optimize;
    `)
  })
}
