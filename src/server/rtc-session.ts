import type {
  Consumer,
  Producer,
  RtpCapabilities,
  WebRtcTransport,
} from "mediasoup/node/lib/types.js";
import { Socket } from "socket.io";

export class RTCSession {
  private deviceRtpCapabilities: RtpCapabilities;
  private produceTransport: WebRtcTransport;
  private consumeTransport: WebRtcTransport;
  // private producers: Producer[]; // TODO: map? set? idk
  // Actually: it might be better to separate producers into a mandatory voiceProducer
  // and dynamically add streamProducers or sth?
  private voiceProducer: Producer;
  private mediaProducers: Producer[]; // any non-voice producers (soundboard, screen-share/streaming, ...)
  private consumers: Consumer[]; // TODO: map? set? idk, list of every consumer this session has active
  private rtcSocket: Socket;
}
