import { Socket } from "socket.io";

export class User {
  private id: string;
  private username: string;
  private isGuest: boolean;
  private sessionToken: string;
  private websocket: Socket;
  constructor(socket: Socket) {
    this.websocket = socket;
  }
}
