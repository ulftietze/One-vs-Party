import { createApp } from "vue";
import App from "./App.vue";
import router from "./router.js";
import { initI18n } from "./i18n.js";

async function bootstrap() {
  try {
    await initI18n();
  } catch {
    // App should still render even if i18n bootstrap fails.
  }
  createApp(App).use(router).mount("#app");
}

bootstrap();
