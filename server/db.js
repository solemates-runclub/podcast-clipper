const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Lightweight migrations for columns added after an existing app.db was created --
// schema.sql's CREATE TABLE IF NOT EXISTS only applies to brand-new databases.
const MIGRATIONS = [
  "ALTER TABLE clips ADD COLUMN topic_text TEXT",
];
for (const stmt of MIGRATIONS) {
  try {
    db.exec(stmt);
  } catch (err) {
    // Column already exists -- fine, this migration already ran.
  }
}

module.exports = db;
