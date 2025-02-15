import { Device } from "mediasoup-client";
import type { Consumer, ConsumerOptions } from "mediasoup-client/lib/Consumer";
import type { Producer } from "mediasoup-client/lib/types";
import { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import { CLIENT_ENV } from "./env";

interface Connection {
  socket?: Socket;
  producer?: Producer;
}
const connection: Connection = {
  socket: null,
  producer: null,
};

export async function connectAndProduce(
  userId: string,
  token: string,
  clientSocket: Socket
) {
  if (connection.socket?.connected) return;
  connection.socket?.close();

  connection.socket = io(`${CLIENT_ENV.SOCKET_IO_URL}/webrtc`, {
    path: "/socket",
    auth: {
      userId,
      token,
    },
  });

  const consumers: Map<string, Consumer> = new Map();

  const device = new Device();
  const routerCapabilities = await connection.socket.emitWithAck(
    "getRouterRtpCapabilities"
  );

  await device.load({ routerRtpCapabilities: routerCapabilities });

  await connection.socket.emitWithAck("updateDeviceRtpCapabilities", {
    deviceRtpCapabilities: device.rtpCapabilities,
  });

  const transportConfigs = await connection.socket.emitWithAck(
    "createTransports",
    {
      sctpCapabilities: device.sctpCapabilities,
    }
  );

  const sendTransport = device.createSendTransport(
    transportConfigs.sendTransport
  );
  const recvTransport = device.createRecvTransport(
    transportConfigs.recvTransport
  );

  sendTransport.on("connect", async (params, callback, err) => {
    try {
      await connection.socket.emitWithAck("connectTransport", {
        transportId: sendTransport.id,
        dtlsParameters: params.dtlsParameters,
      });
      callback();
    } catch (e) {
      err(e);
    }
  });

  sendTransport.on("produce", async (params, callback, errback) => {
    try {
      const id = await connection.socket.emitWithAck("produce", {
        kind: params.kind,
        rtpParameters: params.rtpParameters,
        appData: params.appData,
      });

      callback({ id });
    } catch (e) {
      errback(e);
    }
  });

  recvTransport.on("connect", async (params, callback, err) => {
    try {
      await connection.socket.emitWithAck("connectTransport", {
        transportId: recvTransport.id,
        dtlsParameters: params.dtlsParameters,
      });
      callback();
    } catch (e) {
      err(e);
    }
  });

  connection.socket.on("closedConsumer", ({ consumerId }) => {
    const consumer = consumers.get(consumerId);
    if (!consumer) return;

    consumer.close();
    consumers.delete(consumerId);
  });

  async function startProduce() {
    console.log("start producing");
    // const deviceId = document.location.hash.includes("cable")
    //   ? "3cddd62789a263b613d361e7d6590ca5d5b32f4f576f51dd5f21c71bea4227b4"
    //   : "communications";
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // deviceId,
        noiseSuppression: false,
        echoCancellation: false,
        autoGainControl: false,
        channelCount: 2,
      },
    });
    const audioTrack = stream.getAudioTracks()[0];

    if (connection.producer) connection.producer.close();

    connection.producer = await sendTransport.produce({
      track: audioTrack,
      stopTracks: false,
      encodings: [{ maxBitrate: 64_000 }],
      codecOptions: {
        opusStereo: false,
        opusDtx: true, // TODO: check if this is good on older browsers too
        opusMaxAverageBitrate: 64_000,
      },
      zeroRtpOnPause: true, // TODO: check if this is good on older browsers too
    });

    let isSpeaking = false;
    let lastMonitoringChange = Date.now();
    monitorAudio(stream, (speaking, power) => {
      if (lastMonitoringChange > Date.now() - 300) return;

      if (speaking != isSpeaking) {
        lastMonitoringChange = Date.now();
        isSpeaking = speaking;
        clientSocket.emit("speaking", isSpeaking);
      }
    });

    connection.producer.observer.on("close", () => {
      audioTrack.stop();
      connection.socket.emit("closedProducer");
    });
  }

  await startProduce();

  return {
    _connection: connection, // for debuggin purposes
    mute: () => {
      console.log("muteing??");
      connection.producer.pause();
    },
    unmute: () => {
      connection.producer.resume();
    },
    consume: async (userId: string) => {
      console.log("start consuming", userId);
      const consumeData: ConsumerOptions = await connection.socket?.emitWithAck(
        "consume",
        {
          userId,
        }
      );

      const consumer = await recvTransport.consume(consumeData);

      consumers.set(consumer.id, consumer);

      connection.socket?.emit("resume", { consumerId: consumer.id });
      consumer.resume();

      const consumerStream = new MediaStream([consumer.track]);
      const audio = new Audio();
      audio.srcObject = consumerStream;
      audio.play();

      consumer.observer.on("close", () => {
        audio.remove();
      });

      // TODO: check if we need this lol
      // document.body.append(audio);
      return consumerStream;
    },
    closeConsume: (userId: string) => {
      // TODO: find matching consumer and close
    },
    stopProduce: () => {
      connection.producer?.close();
    },
    startProduce: async () => {
      await startProduce();
    },
    changeProducerStream: async (deviceId) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId,
          noiseSuppression: false,
          echoCancellation: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      const audioTrack = stream.getAudioTracks()[0];
      connection.producer?.replaceTrack({ track: audioTrack });

      let isSpeaking = false;
      let lastMonitoringChange = Date.now();
      monitorAudio(stream, (speaking, power) => {
        if (lastMonitoringChange > Date.now() - 300) return;

        if (speaking != isSpeaking) {
          lastMonitoringChange = Date.now();
          isSpeaking = speaking;
          clientSocket.emit("speaking", isSpeaking);
        }
      });
    },
  };
}

export function monitorAudio(
  stream: MediaStream,
  callback: (speaking: boolean, power: number) => void
) {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;

  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);

  let frequencyData = new Uint8Array(analyser.frequencyBinCount);
  const monitoring = {
    speaking: false,
    speechPower: 0,
  };
  const monitor = () => {
    if (!stream.active) {
      console.log("stream became inactive, cancel monitoring");
      return;
    }

    analyser.getByteFrequencyData(frequencyData);

    const sampleRate = ctx.sampleRate;
    const binSize = sampleRate / analyser.fftSize;

    let sumPower = 0;
    let speechBins = 0;

    for (let i = 0; i < frequencyData.length; i++) {
      const freq = i * binSize;
      if (freq >= 300 && freq <= 3000) {
        sumPower += frequencyData[i];
        speechBins++;
      }
    }

    const power = sumPower / speechBins;
    const speaking = power > 1;

    monitoring.speechPower = power;
    monitoring.speaking = speaking;

    if (callback) {
      callback(speaking, power);
    }

    setTimeout(monitor, 50);
  };
  setTimeout(monitor, 50);

  return monitoring;
}

export async function getAudioInputDevices() {
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput"
  );
  return devices;
}

// const rtcSocket = io("ws://:8099/webrtc", { path: "/socket" });
//
// (async function () {
//   const device = new Device();
//   const routerCapabilities = await rtcSocket.emitWithAck(
//     "getRouterRtpCapabilities"
//   );

//   await device.load({ routerRtpCapabilities: routerCapabilities });
//   console.log(device);

//   await rtcSocket.emitWithAck("updateDeviceRtpCapabilities", {
//     deviceRtpCapabilities: device.rtpCapabilities,
//   });

//   console.log(routerCapabilities);

//   const transportConfigs = await rtcSocket.emitWithAck("createTransports", {
//     sctpCapabilities: device.sctpCapabilities,
//   });

//   console.log("transports", transportConfigs);

//   const sendTransport = device.createSendTransport(
//     transportConfigs.sendTransport
//   );
//   const recvTransport = device.createRecvTransport(
//     transportConfigs.recvTransport
//   );

//   sendTransport.on("connect", async (params, callback, err) => {
//     try {
//       console.log("connecting sendtransport", sendTransport.id);
//       await rtcSocket.emitWithAck("connectTransport", {
//         transportId: sendTransport.id,
//         dtlsParameters: params.dtlsParameters,
//       });
//       console.log("sendtransport connected!", params.dtlsParameters);
//       callback();
//     } catch (e) {
//       err(e);
//     }
//   });

//   sendTransport.on("produce", async (params, callback, errback) => {
//     try {
//       console.log("start producing", sendTransport.id, params);
//       const id = await rtcSocket.emitWithAck("produce", {
//         // transportId: sendTransport.id,
//         kind: params.kind,
//         rtpParameters: params.rtpParameters,
//         appData: params.appData,
//       });
//       console.log("producer", id);

//       callback({ id });
//     } catch (e) {
//       errback(e);
//     }
//   });

//   sendTransport.on("connectionstatechange", (s) => {
//     console.log("state changed", s);
//   });

//   sendTransport.on("icegatheringstatechange", (s) => {
//     console.log("ice state changed", s);
//   });

//   recvTransport.on("connect", async (params, callback, err) => {
//     try {
//       console.log(
//         "connecting recvtransport",
//         recvTransport.id,
//         params.dtlsParameters
//       );
//       await rtcSocket.emitWithAck("connectTransport", {
//         transportId: recvTransport.id,
//         dtlsParameters: params.dtlsParameters,
//       });
//       callback();
//     } catch (e) {
//       err(e);
//     }
//   });

//   if (document.location.hash.includes("produce")) {
//     // PRODUCING
//     const deviceId = document.location.hash.includes("cable")
//       ? "3cddd62789a263b613d361e7d6590ca5d5b32f4f576f51dd5f21c71bea4227b4"
//       : "communications";
//     const stream = await navigator.mediaDevices.getUserMedia({
//       audio: {
//         deviceId,
//         noiseSuppression: false,
//         echoCancellation: false,
//         autoGainControl: false,
//         channelCount: 2,
//       },
//     });
//     console.log(stream.getAudioTracks());
//     const audioTrack = stream.getAudioTracks()[0];

//     const producer = await sendTransport.produce({
//       track: audioTrack,
//       stopTracks: false,
//       encodings: [{ maxBitrate: 64_000 }],
//       codecOptions: {
//         opusStereo: deviceId === "communications" ? false : true,
//         opusDtx: true, // TODO: check if this is good on older hardware too
//         opusMaxAverageBitrate: 64_000,
//       },
//       zeroRtpOnPause: true, // TODO: check if this is good on older hardware too
//     });
//     console.log(producer);

//     const consumerStream = new MediaStream([audioTrack]);
//     const audio = new Audio();
//     audio.controls = true;
//     audio.srcObject = consumerStream;
//     audio.play();
//     document.body.append(audio);

//     const pauseButton = document.createElement("button");
//     pauseButton.textContent = "(Un-)Pause";
//     pauseButton.addEventListener("click", () => {
//       if (producer.paused) {
//         producer.resume();
//       } else {
//         producer.pause();
//       }
//     });
//     document.body.append(pauseButton);
//   } else {
//     // CONSUMING
//     const producers = await rtcSocket.emitWithAck("getProducers");
//     console.log("found producers", producers);

//     for (const producer of producers) {
//       const consumeData: ConsumerOptions = await rtcSocket.emitWithAck(
//         "consume",
//         {
//           producerId: producer,
//         }
//       );

//       console.log("consuming", consumeData);
//       const consumer = await recvTransport.consume(consumeData);

//       rtcSocket.emit("resume", { consumerId: consumer.id });
//       consumer.resume();

//       const consumerStream = new MediaStream([consumer.track]);
//       const audio = new Audio();
//       audio.controls = true;
//       audio.srcObject = consumerStream;
//       audio.play();

//       document.body.append(audio);
//     }
//   }
// })();
