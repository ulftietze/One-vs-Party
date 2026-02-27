#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${ADMIN_TOKEN:-}" && -f ".env" ]]; then
  ADMIN_TOKEN="$(grep '^ADMIN_TOKEN=' .env | head -n1 | cut -d= -f2- || true)"
fi

if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  echo "ADMIN_TOKEN missing. Set ADMIN_TOKEN env or add ADMIN_TOKEN to .env." >&2
  exit 1
fi

DEFAULT_ARGS=(
  --url "${LOADTEST_URL:-http://host.docker.internal:8080}"
  --admin-token "$ADMIN_TOKEN"
  --guest-counts "${LOADTEST_GUEST_COUNTS:-100,250,500}"
  --questions "${LOADTEST_QUESTIONS:-10}"
  --register-concurrency "${LOADTEST_REGISTER_CONCURRENCY:-50}"
  --connect-concurrency "${LOADTEST_CONNECT_CONCURRENCY:-15}"
  --answer-concurrency "${LOADTEST_ANSWER_CONCURRENCY:-100}"
  --socket-timeout-ms "${LOADTEST_SOCKET_TIMEOUT_MS:-45000}"
  --ws-connect-retries "${LOADTEST_WS_CONNECT_RETRIES:-5}"
  --ws-retry-delay-ms "${LOADTEST_WS_RETRY_DELAY_MS:-400}"
  --min-connected-ratio "${LOADTEST_MIN_CONNECTED_RATIO:-1}"
  --report-dir "${LOADTEST_REPORT_DIR:-./loadtest/reports}"
  --report-prefix "${LOADTEST_REPORT_PREFIX:-load-test}"
)

exec docker compose -f loadtest/docker-compose.yml run --rm --build loadtest "${DEFAULT_ARGS[@]}" "$@"
