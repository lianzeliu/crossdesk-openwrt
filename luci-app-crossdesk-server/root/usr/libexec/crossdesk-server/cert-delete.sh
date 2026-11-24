#!/bin/sh
# Delete the CrossDesk server certificate files.
#
# Removes the bundle, the private key and the root certificate from
# /etc/crossdesk/certs (the persistent location; the server reads
# them via the /var/lib/crossdesk/certs symlink). Does NOT restart
# the server: the running server keeps its in-memory TLS context,
# and it will not start again without certificates, so use LuCI
# (CrossDesk Server -> Certificate -> "Generate certificate") to
# create a new pair afterwards.
# Exit non-zero on any failure.

set -e

. /lib/functions.sh

CERTS_DIR="/etc/crossdesk/certs"

log() {
	echo "$1"
	logger -t crossdesk-server "$1"
}

rm -f "$CERTS_DIR/api.crossdesk.cn_bundle.crt" \
      "$CERTS_DIR/api.crossdesk.cn.key" \
      "$CERTS_DIR/api.crossdesk.cn_root.crt"
log "Certificate files deleted from $CERTS_DIR. Generate a new pair in LuCI before restarting the server."
exit 0
