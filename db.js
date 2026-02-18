const sqlite3 = require("sqlite3").verbose();

function openDb(dbPath) {
  return new sqlite3.Database(dbPath);
}

function initDb(db) {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS shots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shot_date TEXT NOT NULL,
        master_id TEXT NOT NULL,
        master_name TEXT NOT NULL,
        created_by_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS attendance (
        shot_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        PRIMARY KEY (shot_id, player_id),
        FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_shots_date ON shots(shot_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_player ON attendance(player_id)`);
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = { openDb, initDb, run, all };
