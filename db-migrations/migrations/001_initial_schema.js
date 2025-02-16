module.exports = function migrate(db) {
  db.exec(
    `CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL, 
        name TEXT UNIQUE NOT NULL, 
        password TEXT NOT NULL
    )`
  );
};
