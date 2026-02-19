<template>
  <div style="position:fixed; bottom:12px; right:12px; z-index:9999; display:flex; align-items:center; gap:8px;">
    <div v-if="wsConnected" title="Websocket connected"
         style="width:18px; height:18px; border-radius:999px; background:#1f9d55; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:12px; box-shadow:0 6px 18px rgba(0,0,0,0.12);">
      ✓
    </div>

    <div v-else
         style="padding:6px 8px; border-radius:12px; background:#b00020; color:#fff; font-weight:900; font-size:12px; box-shadow:0 6px 18px rgba(0,0,0,0.18);">
      No connection
    </div>
  </div>
</template>

<script setup>
import { wsConnected } from "../socket.js";
</script>
