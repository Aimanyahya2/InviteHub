const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE,
  custom_domain TEXT UNIQUE,
  logo_path TEXT,
  primary_color TEXT DEFAULT '#8a6d3b',
  plan TEXT DEFAULT 'تجريبي',
  status TEXT DEFAULT 'نشط',
  notes TEXT,
  wa_phone_number_id TEXT,
  wa_access_token TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  is_super_admin INTEGER DEFAULT 0,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, username)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  client_name TEXT,
  event_date TEXT,
  location TEXT,
  location_map_url TEXT,
  design_image TEXT,
  status TEXT DEFAULT 'مسودة',
  event_type TEXT,
  event_datetime TEXT,
  reminder_hours_before INTEGER DEFAULT 24,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'قيد الانتظار',
  rsvp TEXT,
  viewed_at TEXT,
  responded_at TEXT,
  reminder_sent_at TEXT,
  checked_in_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admins_tenant ON admins(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guests_event ON guests(event_id);
CREATE INDEX IF NOT EXISTS idx_guests_token ON guests(token);
`);

module.exports = db;
