import { Socket } from "socket.io";
import { RTCSession } from "./rtc-session.js";
import { VoiceRoom } from "./voice-room.js";
import { dbGetUserByName, dbInsertUser } from "./db/db.js";
import { hashPassword, verifyPassword } from "./utils/crypto.js";
import { generateUUID } from "./utils/uuid.js";

export class User {
  private isGuest: boolean;
  private sessionToken: string;
  private websocket: Socket;
  private connectedRoom: VoiceRoom; // TODO: maybe don't connect to room but to channel?
  private rtcSession: RTCSession;
  constructor(public readonly id: string, public readonly username: string) {}
}

export async function loginUser(name: string, password: string) {
  const userEntry = dbGetUserByName(name);
  if (!userEntry) return false;

  const verified = await verifyPassword(password, userEntry.pw_hash);
  if (!verified) return false;

  console.log("login successful", userEntry.id);
  return new User(userEntry.id, userEntry.name);
}

export async function registerOrLoginUser(name: string, password: string) {
  const userEntry = dbGetUserByName(name);
  if (userEntry) return await loginUser(name, password); // user already exists, log them in instead

  try {
    const newId = generateUUID();
    const pwHash = await hashPassword(password);
    const successInsert = dbInsertUser(newId, name, pwHash);
    if (!successInsert) return false;

    console.log("register successful", newId);
    return new User(newId, name);
  } catch (e) {
    return false; // something failed :(
  }
}
