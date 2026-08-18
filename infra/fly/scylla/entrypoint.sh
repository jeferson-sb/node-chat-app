#!/usr/bin/env bash
# Adapts ScyllaDB to Fly's 6PN network before handing over to the
# image's own entrypoint.
#
# Two things differ from the docker-compose.yml cluster:
#   - every address is IPv6, so gossip has to advertise $FLY_PRIVATE_IP
#     rather than whatever Scylla would auto-detect;
#   - there is no static seed hostname, so seeds come from the AAAA
#     records behind $SCYLLA_SEED_HOST (one per machine in the app).
set -euo pipefail

CONF=/etc/scylla/scylla.yaml
RACKDC=/etc/scylla/cassandra-rackdc.properties

# Fly regions are the natural datacenter boundary; the server's
# SCYLLA_LOCAL_DATACENTER must match this value.
cat >"$RACKDC" <<EOF
dc=${FLY_REGION}
rack=${FLY_REGION}
EOF

# Gossip exchanges hostnames as well as addresses, and the default
# resolver path is IPv4-only.
if grep -q '^enable_ipv6_dns_lookup:' "$CONF"; then
  sed -i 's/^enable_ipv6_dns_lookup:.*/enable_ipv6_dns_lookup: true/' "$CONF"
else
  echo 'enable_ipv6_dns_lookup: true' >>"$CONF"
fi

# Every machine in the app answers on <app>.internal. Including our own
# address is fine - Scylla ignores itself unless it is bootstrapping the
# ring, which is exactly what the first node must do.
seeds=$(getent ahostsv6 "${SCYLLA_SEED_HOST}" | awk '{ print $1 }' | sort -u | paste -sd, -)
if [ -z "$seeds" ]; then
  seeds="${FLY_PRIVATE_IP}"
fi

echo "scylla: region=${FLY_REGION} ip=${FLY_PRIVATE_IP} seeds=${seeds}"

exec /docker-entrypoint.py \
  --seeds "$seeds" \
  --listen-address "${FLY_PRIVATE_IP}" \
  --broadcast-address "${FLY_PRIVATE_IP}" \
  --broadcast-rpc-address "${FLY_PRIVATE_IP}" \
  --api-address 127.0.0.1 \
  --endpoint-snitch GossipingPropertyFileSnitch \
  --smp "${SCYLLA_SMP:-2}" \
  --memory "${SCYLLA_MEMORY:-3G}" \
  "$@"
