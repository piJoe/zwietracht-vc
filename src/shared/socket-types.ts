export interface ServerToClientEvents {}

export interface ClientToServerEvents {}

export interface SocketData {}

export type SocketHandshakeAuth =
  | { method: "login" | "register"; username: string; password: string }
  | { method: "token"; token: string };
