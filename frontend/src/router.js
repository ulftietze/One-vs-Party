import { createRouter, createWebHashHistory } from "vue-router";

import Home from "./pages/Home.vue";
import AdminCreate from "./pages/AdminCreate.vue";
import Admin from "./pages/Admin.vue";
import Presentation from "./pages/Presentation.vue";
import GuestLive from "./pages/GuestLive.vue";
import GuestAsync from "./pages/GuestAsync.vue";
import Player from "./pages/Player.vue";
import ResultsShare from "./pages/ResultsShare.vue";
import StatsSimulator from "./pages/StatsSimulator.vue";

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/t/:token", component: Home, props: true },

    // Admin-Bereich: nur hier Spiel erstellen
    { path: "/admin", component: AdminCreate },
    { path: "/admin/:token", component: Admin, props: true },

    { path: "/present/:token", component: Presentation, props: true },
    { path: "/guest/live/:token", component: GuestLive, props: true },
    { path: "/guest/async/:token", component: GuestAsync, props: true },
    { path: "/player/:token", component: Player, props: true },
    { path: "/results/:token", component: ResultsShare, props: true },
    { path: "/sim/stats", component: StatsSimulator }
  ]
});
