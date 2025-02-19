import { Server } from "socket.io";
import {
  closeConsumersForProducer,
  closeOwnConsumers,
  setupWebRTCSignaling,
} from "./webrtc.js";
import { SERVER_ENV } from "./env.js";
import { createToken } from "./utils/crypto.js";
import type { SocketHandshakeAuth } from "../shared/socket-types.js";
import { registerOrLoginUser } from "./user.js";

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
// await setupWHIP();

io.use(async (socket, next) => {
  const auth = socket.handshake.auth as SocketHandshakeAuth;
  if (auth.method !== "login") {
    next(new Error("not authorized"));
    socket.disconnect();
    return;
  }

  // TODO: add proper authentication with db lookup and shit
  const user = await registerOrLoginUser(auth.username, auth.password);
  if (!user) {
    next(new Error("not authorized"));
    socket.disconnect();
    return;
  }

  socket.data = { userId: user.id, username: user.username };
  socket.emit("me", { userId: user.id, username: user.username });
  next();
});
io.on("connection", (socket) => {
  // TODO: proper auth, proper userId etc.
  const { userId, username } = socket.data;
  console.log("connection", userId);

  socket.emit("channels", channels);

  socket.on("chatmsg", (msg) => {
    if (!channelExists(msg.channel)) return;

    io.emit("chatmsg", {
      channel: msg.channel,
      content: msg.content,
      user: username,
      timestamp: Date.now(),
    });
  });

  socket.on("speaking", (isSpeaking: boolean) => {
    io.emit("speaking", { userId, isSpeaking });
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
