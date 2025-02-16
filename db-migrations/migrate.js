const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// TODO: use ENV variable for this?
const db = new Database("db.sqlite");

db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

const appliedMigrations = new Set(
  db
    .prepare("SELECT name FROM migrations")
    .all()
    .map((row) => row.name)
);

const migrationDirectory = path.join(__dirname, "migrations");
const files = fs.readdirSync(migrationDirectory).sort();

for (const file of files) {
  if (appliedMigrations.has(file)) {
    console.log(`migration ${file} already applied, skipping`);
    continue;
  }

  const migrationPath = path.join(migrationDirectory, file);
  const migrate = require(migrationPath);
  migrate(db);

  db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
  console.log(`migration ${file} successfully applied.`);
}

db.close();
console.log(`done applying all migrations`);
