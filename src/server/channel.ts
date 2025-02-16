import { VoiceRoom } from "./voice-room.js";

export class Channel {
  private id: string;
  private name: string;
  private description: string;
  private voiceRoom: VoiceRoom; // TODO: not sure yet if we really want to separate this from channel
}
