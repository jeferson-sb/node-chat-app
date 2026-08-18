#!/usr/bin/env bash
# Provisions the whole ChatMe stack on Fly.io from scratch, in
# dependency order: backing stores first, migrations once they answer,
# then the chat tier that fails without them.
#
# Re-runnable: every step is skipped when the resource already exists,
# so this doubles as the "add a Scylla node" / "redeploy" path.
#
#   ./infra/fly/provision.sh                 # everything
#   ./infra/fly/provision.sh redis scylla    # only those steps
#
# Requires: flyctl (authenticated), pnpm, openssl. Run from anywhere -
# paths are resolved against the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLY_DIR="$ROOT/infra/fly"

ORG="${FLY_ORG:-personal}"
REGION="${FLY_REGION:-gru}"

SERVER_APP="chatme"
POSTGRES_APP="chatme-postgres"
REDIS_APP="chatme-redis"
SCYLLA_APP="chatme-scylla"

SERVER_COUNT="${SERVER_COUNT:-3}"
SCYLLA_COUNT="${SCYLLA_COUNT:-3}"

PG_USER="chatme"
PG_DB="chatme"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

app_exists() { fly apps list --json | grep -q "\"Name\": *\"$1\""; }

ensure_app() {
  if app_exists "$1"; then
    log "app $1 already exists"
    return
  fi
  log "creating app $1"
  fly apps create "$1" --org "$ORG"
}

# Fly volumes are per-machine: `fly scale count` clones the volume for
# each new machine, so we only ever create the first one by hand.
ensure_volume() {
  local app="$1" name="$2" size="$3"
  if fly volumes list --app "$app" --json | grep -q "\"name\": *\"$name\""; then
    log "volume $name ($app) already exists"
    return
  fi
  log "creating volume $name ($app, ${size}GB)"
  fly volumes create "$name" --app "$app" --region "$REGION" --size "$size" --yes
}

secret_exists() {
  fly secrets list --app "$1" --json 2>/dev/null | grep -q "\"Name\": *\"$2\""
}

# --- Postgres ---------------------------------------------------------
provision_postgres() {
  ensure_app "$POSTGRES_APP"
  ensure_volume "$POSTGRES_APP" chatme_pg_data 10

  if ! secret_exists "$POSTGRES_APP" POSTGRES_PASSWORD; then
    log "generating POSTGRES_PASSWORD"
    fly secrets set --app "$POSTGRES_APP" --stage \
      "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  fi

  log "deploying $POSTGRES_APP"
  fly deploy "$FLY_DIR/postgres" --config "$FLY_DIR/postgres/fly.toml" --yes
}

# --- Redis ------------------------------------------------------------
provision_redis() {
  ensure_app "$REDIS_APP"
  ensure_volume "$REDIS_APP" chatme_redis_data 3

  log "deploying $REDIS_APP"
  fly deploy "$FLY_DIR/redis" --config "$FLY_DIR/redis/fly.toml" --yes
}

# --- ScyllaDB ---------------------------------------------------------
provision_scylla() {
  ensure_app "$SCYLLA_APP"
  ensure_volume "$SCYLLA_APP" chatme_scylla_data 40

  log "deploying $SCYLLA_APP (first node bootstraps the ring)"
  fly deploy "$FLY_DIR/scylla" --config "$FLY_DIR/scylla/fly.toml" --yes

  # Nodes join one at a time: two nodes bootstrapping at once against an
  # empty ring can each decide they are the seed and split it.
  local current
  current=$(fly machines list --app "$SCYLLA_APP" --json | grep -c '"id"' || true)
  while [ "$current" -lt "$SCYLLA_COUNT" ]; do
    current=$((current + 1))
    log "scaling $SCYLLA_APP to $current node(s)"
    fly scale count "$current" --app "$SCYLLA_APP" --region "$REGION" --yes
    fly status --app "$SCYLLA_APP"
    log "wait for the new node to reach UN in \`nodetool status\` before continuing"
    sleep 60
  done
}

# --- Schema -----------------------------------------------------------
# The server image is built with `pnpm install --prod`, so the migration
# tooling (@better-auth/cli, the migrate scripts' dev deps) is not in it.
# Migrations therefore run from this machine, tunnelled over WireGuard.
migrate() {
  local pg_password
  pg_password=$(fly ssh console --app "$POSTGRES_APP" -C 'printenv POSTGRES_PASSWORD' | tr -d '\r\n')

  log "opening tunnels to $POSTGRES_APP and $SCYLLA_APP"
  fly proxy 15432:5432 --app "$POSTGRES_APP" &
  local pg_proxy=$!
  fly proxy 19042:9042 --app "$SCYLLA_APP" &
  local scylla_proxy=$!
  trap 'kill $pg_proxy $scylla_proxy 2>/dev/null || true' EXIT
  sleep 5

  local database_url="postgres://${PG_USER}:${pg_password}@localhost:15432/${PG_DB}"

  log "postgres: better-auth schema"
  DATABASE_URL="$database_url" pnpm --dir "$ROOT" --filter @chatme/server run db:migrate:auth

  log "postgres: user-rooms schema"
  DATABASE_URL="$database_url" pnpm --dir "$ROOT" --filter @chatme/server run db:migrate:user-rooms

  log "scylla: chatme keyspace and messages table"
  SCYLLA_CONTACT_POINTS="localhost:19042" \
    SCYLLA_LOCAL_DATACENTER="$REGION" \
    pnpm --dir "$ROOT" --filter @chatme/server run db:migrate:scylla

  kill $pg_proxy $scylla_proxy 2>/dev/null || true
  trap - EXIT
}

# --- Chat server ------------------------------------------------------
provision_server() {
  ensure_app "$SERVER_APP"

  if ! secret_exists "$SERVER_APP" BETTER_AUTH_SECRET; then
    log "generating BETTER_AUTH_SECRET"
    fly secrets set --app "$SERVER_APP" --stage \
      "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
  fi

  if ! secret_exists "$SERVER_APP" DATABASE_URL; then
    local pg_password
    pg_password=$(fly ssh console --app "$POSTGRES_APP" -C 'printenv POSTGRES_PASSWORD' | tr -d '\r\n')
    log "wiring DATABASE_URL to $POSTGRES_APP over 6PN"
    fly secrets set --app "$SERVER_APP" --stage \
      "DATABASE_URL=postgres://${PG_USER}:${pg_password}@${POSTGRES_APP}.internal:5432/${PG_DB}"
  fi

  log "deploying $SERVER_APP"
  fly deploy "$ROOT" --config "$FLY_DIR/server/fly.toml" --dockerfile "$ROOT/Dockerfile" --yes

  log "scaling $SERVER_APP to $SERVER_COUNT replicas"
  fly scale count "$SERVER_COUNT" --app "$SERVER_APP" --region "$REGION" --yes
}

main() {
  local steps=("$@")
  if [ ${#steps[@]} -eq 0 ]; then
    steps=(postgres redis scylla migrate server)
  fi

  for step in "${steps[@]}"; do
    case "$step" in
      postgres) provision_postgres ;;
      redis) provision_redis ;;
      scylla) provision_scylla ;;
      migrate) migrate ;;
      server) provision_server ;;
      *)
        echo "unknown step: $step (postgres|redis|scylla|migrate|server)" >&2
        exit 1
        ;;
    esac
  done

  log "done - https://${SERVER_APP}.fly.dev"
}

main "$@"
