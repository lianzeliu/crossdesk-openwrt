#!/bin/sh
# Issue or renew a public Let's Encrypt certificate for CrossDesk Server
# using acme.sh (OpenWrt 'acme' package), then install it where the
# server loads it from:
#   /etc/crossdesk/certs/api.crossdesk.cn_bundle.crt  (full chain)
#   /etc/crossdesk/certs/api.crossdesk.cn.key         (private key)
#
# Usage: cert-acme.sh [issue|renew]
#   issue: run --issue (skips if the cert is still valid) and
#          --install-cert with a --reloadcmd that restarts this service.
#   renew: run --renew; the reloadcmd saved at install time runs
#          automatically, so renewal restarts the service too.
#
# acme.sh installs its own cron job on first issue, so renewals happen
# automatically afterwards. This script only does the on-demand part.
#
# Requirements for HTTP-01: the domain (UCI global.domain) must resolve
# to this router's WAN address, and TCP port 80 must be reachable from
# the internet. Webroot mode uses uhttpd serving /www; standalone mode
# stops uhttpd while acme.sh listens on port 80, then starts it again.
#
# Notes:
# - acme.sh 3.x defaults to ZeroSSL, so --server letsencrypt is passed
#   explicitly.
# - The acme.sh binary moved between OpenWrt versions; both known paths
#   are probed.
# - All output is echoed (LuCI shows it) and logged; exit non-zero on
#   any failure.

set -e

. /lib/functions.sh

ACTION="${1:-issue}"
CERT_DIR="/etc/crossdesk/certs"
KEY_FILE="$CERT_DIR/api.crossdesk.cn.key"
CRT_FILE="$CERT_DIR/api.crossdesk.cn_bundle.crt"

config_load crossdesk-server
config_get domain global domain ""
config_get email cert acme_email ""
config_get method cert acme_method "webroot"

if [ -z "$domain" ]; then
	echo "No domain configured (crossdesk-server.global.domain)" >&2
	exit 1
fi

ACME=""
for p in /usr/lib/acme/client/acme.sh /usr/lib/acme/acme.sh; do
	if [ -x "$p" ]; then
		ACME="$p"
		break
	fi
done
if [ -z "$ACME" ]; then
	echo "acme.sh not found (install the 'acme' package)" >&2
	exit 1
fi

mkdir -p "$CERT_DIR" /etc/acme
chmod 700 "$CERT_DIR"

log() {
	echo "$1"
	logger -t crossdesk-server "$1"
}

issue_cert() {
	local args="--home /etc/acme --server letsencrypt"
	[ -n "$email" ] && args="$args --accountemail $email"

	if [ "$method" = "standalone" ]; then
		log "Issuing certificate for $domain (standalone, stopping uhttpd on port 80)..."
		/etc/init.d/uhttpd stop
		# Make sure uhttpd comes back even if issuance fails.
		trap '/etc/init.d/uhttpd start' EXIT
		# shellcheck disable=SC2086
		"$ACME" $args --issue -d "$domain" --standalone
		/etc/init.d/uhttpd start
		trap - EXIT
	else
		log "Issuing certificate for $domain (webroot /www)..."
		# shellcheck disable=SC2086
		"$ACME" $args --issue -d "$domain" --webroot /www
	fi

	log "Installing certificate to $CRT_FILE ..."
	"$ACME" --home /etc/acme --install-cert -d "$domain" \
		--key-file "$KEY_FILE" \
		--fullchain-file "$CRT_FILE" \
		--reloadcmd "/etc/init.d/crossdesk-server restart"
}

renew_cert() {
	log "Renewing certificate for $domain ..."
	"$ACME" --home /etc/acme --renew -d "$domain"
}

case "$ACTION" in
	issue) issue_cert ;;
	renew) renew_cert ;;
	*)
		echo "Usage: $0 [issue|renew]" >&2
		exit 1
		;;
esac

log "Done. Certificate expiry:"
openssl x509 -in "$CRT_FILE" -noout -enddate 2>/dev/null || true

# If the service is running, the install/renew reloadcmd already
# restarted it; if it was not running, nothing to do (it will pick up
# the new certificate on next start).
exit 0
