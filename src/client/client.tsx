import { render } from "solid-js/web";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import { io } from "socket.io-client";
import { connectAndProduce } from "./rtc-voice";

let msginput: HTMLInputElement;

const [allChannels, setAllChannels] = createSignal([]);
const [activeChannel, setActiveChannel] = createSignal(null);
const [messages, setMessages] = createSignal({});
const [unread, setUnread] = createSignal({});
const [voiceRooms, setVoiceRooms] = createSignal({});
const [input, setInput] = createSignal("");
const [muted, setMuted] = createSignal(false);
const [deafened, setDeafened] = createSignal(false);
const [currentVoiceRoom, setCurrentVoiceRoom] = createSignal(null);

const socket = io("ws://:8099/", { path: "/socket" });

const self = {
  userId: null,
  rtcConnection: null,
};
socket.on("connect", () => {
  self.userId = socket.id;
});

// await navigator.mediaDevices.getUserMedia({ audio: true });
// console.log(
//   (await navigator.mediaDevices.enumerateDevices()).filter(
//     (d) => d.kind === "audioinput"
//   )
// );

socket.on("channels", (channels: any) => {
  setAllChannels(() => channels.map((c) => c.name));
  setMessages((prev) => {
    const messages = {};
    channels.forEach((c) =>
      prev[c.name] ? (messages[c.name] = prev[c.name]) : (messages[c.name] = [])
    );
    return messages;
  });
  setUnread((prev) => {
    const unread = {};
    channels.forEach((c) =>
      prev[c.name] ? (unread[c.name] = prev[c.name]) : (unread[c.name] = false)
    );
    return unread;
  });
  setVoiceRooms(() => {
    const voicerooms = {};
    channels.forEach((c) => (voicerooms[c.name] = c.voiceroom));
    return voicerooms;
  });
  if (activeChannel() === null) setActiveChannel(channels[0].name);
});

socket.on("chatmsg", (incomingMsg) => {
  setMessages((prev) => ({
    ...prev,
    [incomingMsg.channel]: [
      ...prev[incomingMsg.channel],
      {
        user: incomingMsg.user,
        avatar: "🔵",
        time: new Date(incomingMsg.timestamp).toLocaleTimeString(),
        text: incomingMsg.content,
      },
    ],
  }));

  if (incomingMsg.channel !== activeChannel()) {
    setUnread((prev) => ({
      ...prev,
      [incomingMsg.channel]: true,
    }));
  }
});

socket.on("joinvoice", ({ user, channel }) => {
  setVoiceRooms((prev) => ({
    ...prev,
    [channel]: [...prev[channel], user],
  }));

  if (user === self.userId) {
    setCurrentVoiceRoom(channel);
    const users = voiceRooms()[channel];
    console.log(
      "joined",
      users,
      users.filter((u) => u !== self.userId),
      self.rtcConnection,
      self.userId
    );
    users
      .filter((u) => u !== self.userId)
      .forEach((u) => {
        self.rtcConnection?.consume(u);
      });
  } else {
    self.rtcConnection?.consume(user);
  }
});

socket.on("leavevoice", ({ user, channel }) => {
  setVoiceRooms((prev) => ({
    ...prev,
    [channel]: prev[channel].filter((u) => u !== user),
  }));

  if (user !== self.userId) {
    self.rtcConnection?.closeConsume(user);
  }
});

const sendMessage = () => {
  if (!input().trim()) return;
  const content = input();
  socket.emit("chatmsg", { channel: activeChannel(), content });
  setInput("");
};

const joinVoiceConnection = async () => {
  const res = await socket.emitWithAck("joinvoice", activeChannel());
  if (res && res.connectionToken) {
    self.rtcConnection = await connectAndProduce(
      self.userId,
      res.connectionToken
    );
    console.log("joining");
    return;
  }
  // TODO SERVER: create voice login credentials (single use!), return in callback
  // TODO CLIENT: use credentials in res ACK to connect to webrtc
  // AAAAACTUALLY: would be way cooler to reuse existing connections and producer, just dispose any consumer serverside and clientside
  // that means: on joinvoice serverside, figure out if connections and producer already existing, disconnect any existing consumers and only return {reuseConnections: true} or sth
  // then on the client: check res (ACK) for reuseConnections: true, and do nothing OR use sent credentials to establish new webRTC connection using rtc-voice.ts
  // server then sends the joinvoice event and also a "newproducer" or sth event to everyone in the channel and also the freshly joined user gets all the newproducer events for every connected client as well
  //   return;
  //   setCurrentVoiceRoom(res.channel);
  //
  // await self.rtcConnection.startProduce();
};

const hangupVoiceConnection = () => {
  socket.emit("leavevoice");
  //   TODO: kill producer completly! completley kill the session and clean up on server as well!!
  self.rtcConnection.stopProduce();
  setCurrentVoiceRoom(null);
};

const toggleMute = () => {
  setMuted(!muted());
  if (muted()) {
    self.rtcConnection.mute();
  } else {
    self.rtcConnection.unmute();
  }
};

function MessageList() {
  let msgView: HTMLDivElement;
  const channelMessages = createMemo(() => messages()[activeChannel()]);
  createEffect(() => {
    channelMessages();
    msgView.scrollTo(0, msgView.scrollHeight);
    setUnread((prev) => ({
      ...prev,
      [activeChannel()]: false,
    }));
  });
  return (
    <div ref={msgView} class="flex-1 overflow-y-auto py-2 select-text">
      <For each={channelMessages()}>
        {(msg) => (
          <div class="flex items-start gap-3 py-2">
            <div class="text-2xl select-none">{msg.avatar}</div>
            <div>
              <div class="text-sm font-bold">
                {msg.user} <span class="text-xs text-gray-500">{msg.time}</span>
              </div>
              <div>{msg.text}</div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

export default function ChatApp() {
  return (
    <div class="flex h-screen bg-gray-900 text-white select-none">
      {/* Left Sidebar - Channel List & Voice Room */}
      <div class="w-1/4 p-2 bg-gray-800 flex flex-col gap-4">
        <div>
          <h2 class="text-lg font-bold">Server GEILO3000</h2>
          <ul class="mt-2">
            <For each={allChannels()}>
              {(channel) => (
                <li class="my-2">
                  <div
                    class={`py-1 px-2 flex items-center cursor-pointer text-gray-300 hover:bg-gray-700 rounded-sm ${
                      activeChannel() === channel ? "bg-gray-600" : ""
                    } ${unread()[channel] && "text-white font-bold"}`}
                    onClick={() => setActiveChannel(channel)}
                  >
                    {unread()[channel] && (
                      <span class="absolute -left-1 rounded-full bg-white w-2 h-2"></span>
                    )}
                    #{channel}
                  </div>
                  <div class="text-sm ml-2 text-gray-300">
                    <For each={voiceRooms()[channel]}>
                      {(user) => (
                        <div class="flex items-center gap-1 mt-1">
                          <div class="text-lg">🔵</div>
                          {user}
                        </div>
                      )}
                    </For>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </div>

        <div class="mt-auto p-4 bg-gray-700 rounded">
          <h2 class="text-md font-bold">Voice Connection</h2>
          {currentVoiceRoom() && (
            <h3 class="text-sm">
              Connected: <strong>{currentVoiceRoom()}</strong>
            </h3>
          )}
          <div class="w-full flex flex-row gap-2">
            {currentVoiceRoom() !== activeChannel() && (
              <button
                class="flex-auto p-2 mt-2 bg-blue-600 rounded cursor-pointer"
                onClick={joinVoiceConnection}
              >
                {`Join #${activeChannel()}`}
              </button>
            )}
            {currentVoiceRoom() !== null && (
              <button
                class="flex-auto p-2 mt-2 bg-blue-600 rounded cursor-pointer"
                onClick={hangupVoiceConnection}
              >
                {"Hang Up"}
              </button>
            )}
          </div>
          {currentVoiceRoom() && (
            <div class="flex gap-2 mt-2">
              <button
                class={`p-2 rounded cursor-pointer ${
                  muted() ? "bg-red-600" : "bg-gray-600"
                }`}
                onClick={toggleMute}
              >
                {muted() ? "Unmute" : "Mute"}
              </button>
              <button
                class={`p-2 rounded cursor-pointer ${
                  deafened() ? "bg-red-600" : "bg-gray-600"
                }`}
                onClick={() => setDeafened(!deafened())}
              >
                {deafened() ? "Undeafen" : "Deafen"}
              </button>
            </div>
          )}
          {/* TODO: ADD MIC SELECT HERE!! */}
        </div>
      </div>

      {/* Middle - Chat Window */}
      <div class="flex flex-col flex-1 p-4">
        <h2 class="text-xl font-bold border-b border-gray-700 pb-2">
          #{activeChannel()}
        </h2>
        <MessageList />

        {/* Message Input */}
        <div class="p-2 border-t border-gray-700 flex gap-2">
          <input
            type="text"
            class="flex-1 p-2 bg-gray-800 text-white rounded outline-none"
            value={input()}
            ref={msginput}
            onInput={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            autofocus
          />
          <button class="p-2 bg-blue-600 rounded" onClick={sendMessage}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

render(() => <ChatApp />, document.body);
document.body.addEventListener("keydown", (e) => {
  if (msginput && document.activeElement !== msginput) {
    msginput.focus();
  }
});
