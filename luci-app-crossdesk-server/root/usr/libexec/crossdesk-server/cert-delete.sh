#!/bin/sh
# Delete the CrossDesk server certificate files, then restart the
# server so it auto-generates a fresh self-signed pair on startup
# (see SignalServer::ReloadTlsContext in lianzeliu/crossdesk-server).
#
# Removes the bundle, the private key and the root certificate from
# /etc/crossdesk/certs (the persistent location; the server reads
# them via the /var/lib/crossdesk/certs symlink). Restarts the
# service afterwards if it is running, so the new certificate takes
# effect immediately; if the service is not running, fresh
# certificates are generated on the next start.
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
log "Certificate files deleted from $CERTS_DIR."

if pgrep -x crossdesk_server >/dev/null 2>&1; then
	/etc/init.d/crossdesk-server restart
	log "Server restarted; a fresh self-signed certificate is generated on startup."
else
	log "Server is not running; a fresh self-signed certificate will be generated on the next start."
fi
exit 0
