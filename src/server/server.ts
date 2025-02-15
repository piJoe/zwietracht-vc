import { Server } from "socket.io";
import { v7 as uuidv7 } from "uuid";
import {
  closeConsumersForProducer,
  closeOwnConsumers,
  setupWebRTCSignaling,
} from "./webrtc.js";
import crypto from "node:crypto";
import { SERVER_ENV } from "./env.js";

function createToken(byteLength = 48) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

const io = new Server(SERVER_ENV.SOCKET_IO_PORT, {
  cors: {
    origin: "*",
  },
  path: "/socket",
});

const channels = [
  { name: "general", voiceroom: [] },
  { name: "gaming", voiceroom: [] },
  { name: "tech", voiceroom: [] },
  { name: "random", voiceroom: [] },
];
const userVoiceChannelMap = new Map();
const rtcConnectionSetup = new Map();

export function userInChannel(userId, channelName) {
  return userVoiceChannelMap.get(userId) === channelName;
}

export function getUserChannel(userId) {
  return userVoiceChannelMap.get(userId);
}

function channelExists(channelName) {
  return channels.some((c) => c.name === channelName);
}

function leaveVoice(userId) {
  if (!userVoiceChannelMap.has(userId)) return;
  const channelName = userVoiceChannelMap.get(userId);
  if (!channelExists(channelName)) return;
  const channel = channels.find((c) => c.name === channelName);

  userVoiceChannelMap.delete(userId);
  channel.voiceroom = channel.voiceroom.filter((u) => u !== userId);

  closeConsumersForProducer(userId);
  closeOwnConsumers(userId);
  io.emit("leavevoice", { user: userId, channel: channelName });
}

function joinVoice(userId, channelName): string | undefined {
  if (userVoiceChannelMap.has(userId)) {
    leaveVoice(userId);
  }

  if (!channelExists(channelName)) return;
  const channel = channels.find((c) => c.name === channelName);
  if (channel.voiceroom.includes(userId)) return;

  if (!rtcConnectionSetup.has(userId)) {
    const connectToken = createToken(256);
    rtcConnectionSetup.set(userId, {
      connected: false,
      token: connectToken,
      channel: channelName,
    });
    return connectToken;
  }

  // we're still connecting, don't do anything.
  if (!rtcConnectionSetup.get(userId).connected) return;

  // TODO: do this AFTER successful RTC connection
  channel.voiceroom.push(userId);
  userVoiceChannelMap.set(userId, channelName);
  io.emit("joinvoice", { user: userId, channel: channelName });
}

function cleanupSession(userId) {
  leaveVoice(userId);
}

export function finishProducerConnection(userId) {
  if (!rtcConnectionSetup.has(userId)) return;
  const connection = rtcConnectionSetup.get(userId);

  const channel = channels.find((c) => c.name === connection.channel);
  connection.connected = true;
  channel.voiceroom.push(userId);
  userVoiceChannelMap.set(userId, channel.name);
  io.emit("joinvoice", { user: userId, channel: channel.name });
}

await setupWebRTCSignaling(io);

io.on("connection", (socket) => {
  // TODO: proper auth, proper userId etc.
  const userId = socket.id;
  console.log("connection", userId);

  socket.emit("channels", channels);

  socket.on("chatmsg", (msg) => {
    if (!channelExists(msg.channel)) return;

    io.emit("chatmsg", {
      channel: msg.channel,
      content: msg.content,
      user: userId,
      timestamp: Date.now(),
    });
  });

  socket.on("joinvoice", (channelName, callback) => {
    if (!channelExists(channelName)) return;
    const token = joinVoice(userId, channelName);
    if (!token) {
      // TODO: idk yet lol
      callback();
      return;
    }

    callback({ connectionToken: token });
  });
  socket.on("leavevoice", () => {
    leaveVoice(userId);
  });

  socket.on("disconnect", () => {
    cleanupSession(userId);
  });
});
