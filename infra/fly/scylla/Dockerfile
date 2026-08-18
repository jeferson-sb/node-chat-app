FROM scylladb/scylla:6.2

COPY entrypoint.sh /usr/local/bin/fly-entrypoint.sh

# The base image's ENTRYPOINT is /docker-entrypoint.py; ours resolves the
# Fly-specific addressing first and then hands over to it.
ENTRYPOINT ["/usr/local/bin/fly-entrypoint.sh"]
