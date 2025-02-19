import Database from "better-sqlite3";
import { SERVER_ENV } from "../env.js";
import { parseUUID, stringifyUUID } from "../utils/uuid.js";

const db = new Database(SERVER_ENV.SQLITE_FILE_LOCATION);
db.pragma("journal_mode = WAL");

export function dbGetUserByName(username: string) {
  const res = db
    .prepare<
      { username: string },
      { id: Uint8Array; name: string; pw_hash: string }
    >("SELECT * FROM users WHERE name=:username")
    .get({ username });

  if (!res) return false;
  return {
    ...res,
    id: stringifyUUID(res.id),
  };
}

export function dbInsertUser(id: string, username: string, pwHash: string) {
  const res = db
    .prepare<{ id: Uint8Array; name: string; pw_hash: string }>(
      "INSERT INTO users (id, name, pw_hash) VALUES (:id, :name, :pw_hash)"
    )
    .run({
      id: parseUUID(id),
      name: username,
      pw_hash: pwHash,
    });

  console.log(res);

  if (res.changes > 0) return true;
  return false;
}
