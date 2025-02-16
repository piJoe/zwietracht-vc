import { Socket } from "socket.io";
import { RTCSession } from "./rtc-session.js";
import { VoiceRoom } from "./voice-room.js";

export class User {
  private id: string;
  private username: string;
  private isGuest: boolean;
  private sessionToken: string;
  private websocket: Socket;
  private connectedRoom: VoiceRoom; // TODO: maybe don't connect to room but to channel?
  private rtcSession: RTCSession;
  constructor() {}
}

export function loginUser(name: string, password: string) {}

export function registerUser(name: string, password: string) {}
