# Fly.io provisioning (POC)

Infrastructure-as-code for running the architecture in the root README
on Fly.io: several stateless `@chatme/server` machines in front of one
Postgres, one Redis, and one 3-node ScyllaDB cluster.

This is a **proof of concept** - nothing here has been deployed. It is
meant to be readable and re-runnable, not production-hardened; the
caveats are spelled out at the bottom and in
[`docs/adr/2026-08-18-fly-io-provisioning.md`](../../docs/adr/2026-08-18-fly-io-provisioning.md).

## Layout

| Path | App | Role |
| --- | --- | --- |
| [`server/fly.toml`](server/fly.toml) | `chatme` | Chat tier, 3+ machines, public HTTPS/websockets |
| [`postgres/fly.toml`](postgres/fly.toml) | `chatme-postgres` | Better Auth accounts + user rooms |
| [`redis/`](redis) | `chatme-redis` | Room roster, socket.io adapter, history write queue |
| [`scylla/`](scylla) | `chatme-scylla` | Persisted chat history, 3 nodes |
| [`provision.sh`](provision.sh) | - | Creates apps/volumes/secrets, deploys, migrates |

Four apps rather than one app with four process groups: only the chat
tier scales on connection count, and each store needs its own volume,
machine size and restart semantics.

## Topology

```
              internet
                 │  https / wss
        ┌────────▼────────┐
        │    Fly Proxy    │  TLS, websocket upgrade, load balancing
        └────────┬────────┘   (replaces nginx.conf)
     ┌───────────┼───────────┐
  chatme      chatme      chatme        3x stateless machines
     └───────────┼───────────┘
                 │  6PN private network (IPv6, *.internal DNS)
   ┌─────────────┼──────────────┐
   ▼             ▼              ▼
chatme-        chatme-      chatme-scylla
postgres       redis        (3 nodes, 1 volume each)
:5432          :6379        :9042
```

Fly Proxy replaces nginx: it terminates TLS, handles the websocket
upgrade, and balances across machines. Because the app is
websocket-only with no sticky sessions (Redis carries cross-node
broadcast), the proxy needs no special configuration beyond
connection-based concurrency limits.

No store publishes a public port (`ports = []`), so all three are
reachable only from inside the organization's private network.

## Usage

```bash
fly auth login
./infra/fly/provision.sh              # postgres, redis, scylla, migrate, server
./infra/fly/provision.sh server       # redeploy just the chat tier
FLY_ORG=my-org FLY_REGION=iad ./infra/fly/provision.sh
```

Order matters and the script encodes it: the stores come up first,
schemas are applied through a WireGuard tunnel, and only then does the
chat tier deploy - it exits at startup if `DATABASE_URL` is unreachable.

Migrations run from your workstation rather than inside a machine
because the server image is built with `pnpm install --prod`, which
prunes `@better-auth/cli` and the other tooling the migrate scripts
need.

## Fly-specific details worth knowing

- **6PN is IPv6-only.** Redis binds `::`, and Scylla has to be told to
  advertise `$FLY_PRIVATE_IP` and to resolve AAAA records
  (`scylla/entrypoint.sh`), which is the one genuinely non-obvious part
  of this setup.
- **Scylla seeds come from DNS.** `chatme-scylla.internal` returns one
  AAAA record per machine in the app, so the entrypoint can build the
  `--seeds` list without hardcoding addresses. Add nodes one at a time
  (`provision.sh` does) so a second node never bootstraps an empty ring
  in parallel with the first.
- **Datacenter naming.** The entrypoint writes `dc=$FLY_REGION`, so the
  server's `SCYLLA_LOCAL_DATACENTER` must be the same region string -
  the driver silently treats a mismatch as "no local nodes".
- **Volumes are per-machine.** `fly scale count` clones the volume
  definition for each new machine; the script only creates the first.
- **The chat tier never scales to zero** (`auto_stop_machines = "off"`)
  because stopping a machine drops live websocket connections.

## Known POC gaps

- **Single-node Postgres and Redis.** Both are stock images on one
  volume: no replication, no automated backups, and a machine restart
  is a brief outage. For production, Fly Managed Postgres
  (`fly mpg create`) and Upstash Redis (`fly redis create`) trade the
  self-describing config here for real durability.
- **No auth on Redis.** It relies on 6PN isolation only; add
  `requirepass` plus credentials in `REDIS_URL` before this is more
  than a POC.
- **Scylla RF=3 in one region.** `migrate.ts` creates the keyspace with
  `SimpleStrategy` and RF 3, which matches a 3-node single-region
  cluster but would need `NetworkTopologyStrategy` to span regions.
- **TCP health checks only.** The server has no `/health` route yet, so
  a machine that is listening but has lost Redis still passes.
- **Not deployed or load-tested.** Sizes (`shared-cpu-2x` for the chat
  tier, `performance-2x`/4GB for Scylla) are starting points from
  Scylla's minimum requirements, not measurements.
