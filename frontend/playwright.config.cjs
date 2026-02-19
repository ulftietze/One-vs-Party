const fs = require("fs");
const path = require("path");
const { defineConfig } = require("@playwright/test");

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const repoEnv = readDotEnv(path.resolve(__dirname, "../.env"));
const frontendPort = process.env.FRONTEND_PORT || repoEnv.FRONTEND_PORT || "8080";
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${frontendPort}`;

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: {
    timeout: 15_000
  },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  }
});
