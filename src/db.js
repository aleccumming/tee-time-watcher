import Database from 'better-sqlite3';

const db = new Database('watches.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    discord_channel_id TEXT NOT NULL,
    site TEXT NOT NULL,
    course_id INTEGER,
    date TEXT NOT NULL,
    time_min INTEGER,
    time_max INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS seen_slots (
    watch_id INTEGER NOT NULL,
    slot_key TEXT NOT NULL,
    seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (watch_id, slot_key)
  );
`);

export function createWatch({ userId, channelId, site, courseId, date, timeMin, timeMax }) {
  const stmt = db.prepare(`
    INSERT INTO watches (discord_user_id, discord_channel_id, site, course_id, date, time_min, time_max)
    VALUES (@userId, @channelId, @site, @courseId, @date, @timeMin, @timeMax)
  `);
  const info = stmt.run({ userId, channelId, site, courseId: courseId ?? null, date, timeMin: timeMin ?? null, timeMax: timeMax ?? null });
  return info.lastInsertRowid;
}

export function getActiveWatches() {
  return db.prepare('SELECT * FROM watches WHERE active = 1').all();
}

export function getUserWatches(userId) {
  return db.prepare('SELECT * FROM watches WHERE discord_user_id = ? AND active = 1 ORDER BY id').all(userId);
}

export function deactivateWatch(id, userId) {
  const info = db
    .prepare('UPDATE watches SET active = 0 WHERE id = ? AND discord_user_id = ?')
    .run(id, userId);
  return info.changes > 0;
}

export function hasSeenSlot(watchId, slotKey) {
  return !!db.prepare('SELECT 1 FROM seen_slots WHERE watch_id = ? AND slot_key = ?').get(watchId, slotKey);
}

export function markSlotSeen(watchId, slotKey) {
  db.prepare('INSERT OR IGNORE INTO seen_slots (watch_id, slot_key) VALUES (?, ?)').run(watchId, slotKey);
}

export default db;
