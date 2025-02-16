import Database from "better-sqlite3";
import { SERVER_ENV } from "../env.js";

const db = new Database(SERVER_ENV.SQLITE_FILE_LOCATION);
db.pragma("journal_mode = WAL");
