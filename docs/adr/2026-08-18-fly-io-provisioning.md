# Provision the stack on Fly.io as four apps on one private network

- Status: Accepted (proof of concept - nothing deployed)
- Date: 2026-08-18

## Context

`docker-compose.yml` reproduces the whole architecture locally: three
`@chatme/server` replicas behind nginx, Redis, Postgres, and a 3-node
ScyllaDB cluster. The only deployment artifact in the repo was a
`fly.toml` generated in 2022, from before any of those backing stores
existed - it describes a single process with no Redis, no Postgres and
no Scylla, so it can no longer deploy a working app.

We want the compose topology expressed as infrastructure-as-code for
Fly.io, as a POC: readable, re-runnable, and honest about what it does
not cover. Nothing is deployed.

Three questions drove the design:

1. One Fly app with process groups, or one app per component?
2. What replaces nginx?
3. How do stateful services - Scylla in particular - find each other on
   Fly's network?

## Decision

**Four apps on the same 6PN private network**, described under
`infra/fly/` (`chatme`, `chatme-postgres`, `chatme-redis`,
`chatme-scylla`), created and deployed by `infra/fly/provision.sh` in
dependency order: stores, then schema migrations, then the chat tier.

**Fly Proxy replaces nginx.** It already terminates TLS, performs the
websocket upgrade and load-balances across machines, so `nginx.conf`
has no counterpart in the deployed stack. The chat tier declares
`type = "connections"` concurrency (soft 200 / hard 250) rather than
request-based limits, because a Socket.IO client holds one long-lived
websocket - request counts would describe almost nothing. Sticky
sessions are unnecessary: the app is websocket-only (no long-polling
fallback, per `docs/adr/2026-08-09-horizontal-scaling.md`) and
cross-node broadcast goes through the Redis adapter.

**Backing stores publish no public ports** (`ports = []`), so Postgres,
Redis and Scylla are reachable only over 6PN, addressed as
`chatme-<store>.internal`. The server's `REDIS_URL` and
`SCYLLA_CONTACT_POINTS` are plain config in `fly.toml`; only
`DATABASE_URL` and `BETTER_AUTH_SECRET` are secrets.

**Scylla is adapted to 6PN by an entrypoint wrapper**
(`infra/fly/scylla/entrypoint.sh`) rather than by baking a
`scylla.yaml`. Fly's private network is IPv6-only and has no stable
per-node hostname, so at boot each node resolves the AAAA records
behind `chatme-scylla.internal` into a `--seeds` list, advertises
`$FLY_PRIVATE_IP` as its listen/broadcast address, enables
`enable_ipv6_dns_lookup`, and writes `dc=$FLY_REGION` for
`GossipingPropertyFileSnitch`. The server's `SCYLLA_LOCAL_DATACENTER`
is set to that same region string. Nodes are added one at a time so a
second node never bootstraps an empty ring concurrently with the first.

**Postgres and Redis run as stock images on Fly volumes**, single node
each, which keeps the entire POC describable in this repo.

## Alternatives considered

- **One app, four process groups.** Rejected: process groups share an
  image and a scaling story, while these components need different
  images, machine sizes and restart semantics - and only the chat tier
  should scale on connection count.
- **Keep nginx as a Fly app in front of the servers.** Rejected: it
  would be a second hop doing what Fly Proxy already does, plus a
  single point of failure we would then have to scale ourselves.
- **Fly Managed Postgres (`fly mpg`) and Upstash Redis
  (`fly redis create`).** These are the right production answer -
  backups, failover, pooling - but neither is expressible as a
  `fly.toml`, so a POC built on them would be a README of CLI commands
  rather than IaC. Self-hosted single nodes here; the trade-off and the
  upgrade path are recorded in `infra/fly/README.md`.
- **Terraform (`fly` provider) or Pilot.** Rejected for the POC: the
  official Fly Terraform provider is deprecated in favour of flyctl,
  and a state backend is a lot of ceremony for four apps. `fly.toml`
  plus an idempotent shell script stays close to how Fly is actually
  operated.
- **Running the migrations inside a server machine on release.** Not
  possible as-is: the image is built with `pnpm install --prod`, which
  prunes `@better-auth/cli` and the other dev-only tooling the migrate
  scripts need. They run from a workstation over `fly proxy` instead.
  A dedicated migration image would be the fix if this grew past a POC.

## Consequences

- The stale 2022 `fly.toml` is deleted; deploys are now explicit about
  which config they use (`fly deploy . --config
  infra/fly/server/fly.toml`).
- `nginx.conf` stays as local-only infrastructure for
  `docker-compose.yml`; the deployed stack has no nginx.
- Postgres and Redis are single points of failure with no backups, and
  Scylla's RF=3 `SimpleStrategy` keyspace assumes one region. Health
  checks are TCP-only until the server grows a `/health` route.
- None of it is deployed or load-tested: machine sizes are starting
  points, not measurements.
