<template>
  <div ref="appRoot" style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 0;">
    <ConnectionIndicator />
    <router-view />
  </div>
</template>

<script setup>
import { ref } from "vue";
import ConnectionIndicator from "./components/ConnectionIndicator.vue";
import { getSocket } from "./socket.js";
import { useAutoTranslateRoot } from "./i18n.js";

// Socket global initialisieren, damit auf jeder Seite der Status sichtbar ist
getSocket();

const appRoot = ref(null);
useAutoTranslateRoot(appRoot);
</script>
