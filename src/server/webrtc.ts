import { createWorker } from "mediasoup";
import type {
  AppData,
  Consumer,
  DtlsParameters,
  Producer,
  RtpCapabilities,
  SctpCapabilities,
  TransportListenInfo,
  WebRtcTransport,
} from "mediasoup/node/lib/types.js";
import { Server } from "socket.io";
import {
  finishProducerConnection,
  getUserChannel,
  userInChannel,
} from "./server.js";
import { SERVER_ENV } from "./env.js";

const MAX_ALLOWED_BITRATE_VOICE = 512_000;

const listenInfos: TransportListenInfo[] = [
  {
    portRange: {
      min: SERVER_ENV.WEBRTC_PORT_RANGE_MIN,
      max: SERVER_ENV.WEBRTC_PORT_RANGE_MAX,
    },
    protocol: "udp",
    ip: "0.0.0.0",
    announcedAddress: SERVER_ENV.WEBRTC_ANNOUNCED_ADDRESS,
  },
];

// TODO: dynamically create worker and routers based on usage
const worker = await createWorker();
const router = await worker.createRouter({
  mediaCodecs: [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    // {
    //   kind: "video",
    //   mimeType: "video/VP8",
    //   clockRate: 90000,
    //   parameters: {
    //     "x-google-start-bitrate": 1000,
    //   },
    // },
    // {
    //   kind: "video",
    //   mimeType: "video/VP9",
    //   clockRate: 90000,
    //   parameters: {
    //     "profile-id": 2,
    //     "x-google-start-bitrate": 1000,
    //   },
    // },
    // {
    //   kind: "video",
    //   mimeType: "video/h264",
    //   clockRate: 90000,
    //   parameters: {
    //     "packetization-mode": 1,
    //     "profile-level-id": "4d0034", // "main" profile, level 5.2
    //     "level-asymmetry-allowed": 1,
    //     "x-google-start-bitrate": 1000,
    //   },
    // },
    // {
    //   kind: "video",
    //   mimeType: "video/h264",
    //   clockRate: 90000,
    //   parameters: {
    //     "packetization-mode": 1,
    //     "profile-level-id": "42e029", // "baseline" profile, level 4.1
    //     "level-asymmetry-allowed": 1,
    //     "x-google-start-bitrate": 1000,
    //   },
    // },
  ],
});

// setLogEventListeners({
//   ondebug: (namespace, log) => {
//     console.log(namespace, log);
//   },
//   onwarn: (namespace, log) => {
//     console.log(namespace, log);
//   },
//   onerror: (namespace, log, error) => {
//     console.log(namespace, log, error);
//   },
// });

// let activeProducers: Producer[] = [];
let userIdProducerMap: Map<string, Producer> = new Map<string, Producer>();
let userIdConsumerMap: Map<string, Consumer[]> = new Map();
let userIdUserDataMap: Map<string, any> = new Map();

export function closeConsumersForProducer(userId: string) {
  if (!userIdConsumerMap.has(userId)) return;
  const consumers = userIdConsumerMap.get(userId);
  consumers.forEach((c) => {
    console.log("forprod", c);
    c.close();
  });
}

export function closeOwnConsumers(userId: string) {
  const userData = userIdUserDataMap.get(userId);
  if (!userData) return;

  userData.consumers.forEach((c) => {
    console.log("own", c);
    c.close();
  });
}

export async function setupWebRTCSignaling(io: Server) {
  const rtcIO = io.of("/webrtc");

  rtcIO.on("connection", (socket) => {
    if (!socket.handshake.auth) {
      socket.disconnect();
      return;
    }

    const { userId, token } = socket.handshake.auth;
    // TODO: check if userId and token is valid

    // TODO: make this into proper store, globally available (or at least for room) per user
    const userData: {
      deviceRtpCapabilities?: RtpCapabilities;
      sendTransport?: WebRtcTransport;
      recvTransport?: WebRtcTransport;
      producer?: Producer;
      consumers: Map<string, Consumer>;
    } = {
      deviceRtpCapabilities: null,
      sendTransport: null,
      recvTransport: null,
      producer: null,
      consumers: new Map<string, Consumer>(),
    };

    userIdUserDataMap.set(userId, userData);

    function findTransportById(transportId: string): WebRtcTransport | null {
      if (userData.recvTransport?.id === transportId) {
        return userData.recvTransport;
      }

      if (userData.sendTransport?.id === transportId) {
        return userData.sendTransport;
      }

      return null;
    }

    socket.on("disconnect", () => {
      userData.sendTransport?.close();
      userData.recvTransport?.close();
      console.log("cleaning up after some closed connections");
    });

    socket.on("getRouterRtpCapabilities", async (callback) => {
      callback(router.rtpCapabilities);
    });

    socket.on(
      "updateDeviceRtpCapabilities",
      async (
        {
          deviceRtpCapabilities,
        }: {
          deviceRtpCapabilities: RtpCapabilities;
        },
        callback: () => void
      ) => {
        userData.deviceRtpCapabilities = deviceRtpCapabilities;
        callback();
      }
    );

    socket.on(
      "createTransports",
      async (
        { sctpCapabilities }: { sctpCapabilities: SctpCapabilities },
        callback
      ) => {
        // TODO: check if transports already exist, reuse or close existing
        const sendTransport = await router.createWebRtcTransport({
          listenInfos: listenInfos,
          numSctpStreams: sctpCapabilities.numStreams,
        });
        const recvTransport = await router.createWebRtcTransport({
          listenInfos: listenInfos,
          numSctpStreams: sctpCapabilities.numStreams,
        });

        // store to user
        userData.sendTransport = sendTransport;
        userData.recvTransport = recvTransport;

        callback({
          sendTransport: {
            id: sendTransport.id,
            iceParameters: sendTransport.iceParameters,
            iceCandidates: sendTransport.iceCandidates,
            dtlsParameters: sendTransport.dtlsParameters,
            sctpParameters: sendTransport.sctpParameters,
          },
          recvTransport: {
            id: recvTransport.id,
            iceParameters: recvTransport.iceParameters,
            iceCandidates: recvTransport.iceCandidates,
            dtlsParameters: recvTransport.dtlsParameters,
            sctpParameters: recvTransport.sctpParameters,
          },
        });
      }
    );

    socket.on(
      "connectTransport",
      async (
        {
          transportId,
          dtlsParameters,
        }: { transportId: string; dtlsParameters: DtlsParameters },
        callback: () => void
      ) => {
        const transport = findTransportById(transportId);
        if (!transport)
          throw new Error(`transport with id ${transportId} not found.`);

        console.log("connecting transport", transport.id);
        await transport.connect({ dtlsParameters });
        callback();
      }
    );

    // // TODO: replace with dynamic system on main socket connection
    // socket.on("getProducers", async (callback) => {
    //   callback(
    //     userIdProducerMap.entries().map(([userId, producer]) => producer)
    //   );
    // });

    socket.on("produce", async ({ kind, rtpParameters, appData }, callback) => {
      // TODO: check if authorized to produce (user exists in server etc.)
      const transport = userData.sendTransport;
      if (!transport) throw new Error(`produce transport not found`);

      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData,
      });
      console.log("producing", producer.id);

      // TODO: reenable this, but make it more stable lol
      // setInterval(async () => {
      //   const stats = await producer.getStats();
      //   for (const s of stats) {
      //     console.log("producer bitrate", s.bitrate);
      //     if (s.bitrate > MAX_ALLOWED_BITRATE_VOICE * 2) {
      //       console.log(
      //         `${s.bitrate} higher than max allowed bitrate ${MAX_ALLOWED_BITRATE_VOICE}`
      //       );
      //       producer.close();
      //     }
      //   }
      // }, 5000);

      // activeProducers.push(producer);
      userIdProducerMap.set(userId, producer);
      userData.producer = producer;

      producer.observer.on("close", () => {
        // activeProducers = activeProducers.filter((p) => p.id !== producer.id);
        userIdProducerMap.delete(userId);
        userData.producer = null;
        console.log("closed producer", producer.id);
      });

      callback({ id: producer.id });

      // TODO: also anounce new producer to all in room
      // probably better to somehow let the user store update and tell connected clients about new producer from outside
      finishProducerConnection(userId);
    });

    socket.on("consume", async (consumeData, callback) => {
      const otherUserId = consumeData.userId;

      // only when both are in same channel, we can consume
      if (!userInChannel(otherUserId, getUserChannel(userId))) return;

      const transport = userData.recvTransport;
      if (!transport) throw new Error(`consume transport not found.`);

      const producer = userIdProducerMap.get(otherUserId);
      if (!producer) return;

      const producerId = producer.id;

      if (
        !router.canConsume({
          producerId,
          rtpCapabilities: userData.deviceRtpCapabilities,
        })
      )
        throw new Error(`cannot consume`);

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities: userData.deviceRtpCapabilities,
        paused: true,
      });

      if (!userIdConsumerMap.has(otherUserId)) {
        userIdConsumerMap.set(otherUserId, []);
      }
      userIdConsumerMap.set(otherUserId, [
        ...userIdConsumerMap.get(otherUserId),
        consumer,
      ]);
      console.log("added new userIdConsumerMap Entryy", otherUserId, consumer);

      userData.consumers.set(consumer.id, consumer);

      consumer.observer.on("close", () => {
        userData.consumers.delete(consumer.id);
        userIdConsumerMap.set(
          otherUserId,
          userIdConsumerMap.get(otherUserId).filter((c) => c !== consumer)
        );
        socket.emit("closedConsumer", { consumerId: consumer.id });
        console.log("closed consumer", consumer.id);
      });

      callback({
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    });

    socket.on("resume", async ({ consumerId }) => {
      if (!userData.consumers.has(consumerId)) return;
      console.log("resuming consumer", consumerId);
      userData.consumers.get(consumerId).resume();
    });

    socket.on("closedProducer", () => {
      userData.producer?.close();
    });
  });
}
