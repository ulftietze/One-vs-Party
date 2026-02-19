import { io } from "socket.io-client";
import { ref } from "vue";

let socket;
let keepAliveTimer;

// reaktiv für UI (globaler Verbindungs-Indikator)
export const wsConnected = ref(false);
export const wsLastError = ref(null);

export function getSocket() {
  if (socket) return socket;

  socket = io("/", {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 5000,
    timeout: 8000
  });

  socket.on("connect", () => {
    wsConnected.value = true;
    wsLastError.value = null;
  });
  socket.on("disconnect", () => {
    wsConnected.value = false;
  });
  socket.on("connect_error", (err) => {
    wsConnected.value = false;
    wsLastError.value = err?.message || String(err || "connect_error");
  });

  // Keep-alive: alle 15s Ping senden
  keepAliveTimer = setInterval(() => {
    try {
      socket.emit("keep_alive");
    } catch {}
  }, 15000);

  return socket;
}

export function cleanupSocket() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (socket) {
    try { socket.disconnect(); } catch {}
    socket = null;
  }
  wsConnected.value = false;
  wsLastError.value = null;
}
