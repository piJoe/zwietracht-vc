module.exports = function migrate(db) {
  db.exec(
    `CREATE TABLE users (
        id BLOB PRIMARY KEY NOT NULL, 
        name TEXT UNIQUE NOT NULL, 
        pw_hash TEXT NOT NULL
    )`
  );
};
