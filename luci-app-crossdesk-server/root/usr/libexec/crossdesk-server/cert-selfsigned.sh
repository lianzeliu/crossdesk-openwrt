#!/bin/sh
# Generate a self-signed CA + server certificate for CrossDesk Server.
#
# The server only loads two files (see SignalServer::ReloadTlsContext):
#   /etc/crossdesk/certs/api.crossdesk.cn_bundle.crt
#   /etc/crossdesk/certs/api.crossdesk.cn.key
# This script creates them with SAN=DNS:<domain from UCI global>,
# following the approach of docker/generate_certs.sh in
# lianzeliu/crossdesk-server, except the SAN is a DNS name (the
# upstream script only supports an IP SAN).
#
# The root certificate is kept at
#   /etc/crossdesk/certs/api.crossdesk.cn_root.crt
# so it can be installed on clients that validate the chain.
# The root key is deleted after signing (same as upstream).
#
# Idempotent: re-running regenerates everything (old certs replaced).
# Restarts the service afterwards if it is running, so the new
# certificate takes effect. Exit non-zero on any failure.

set -e

. /lib/functions.sh

CERT_DIR="/etc/crossdesk/certs"
ROOT_KEY="$CERT_DIR/api.crossdesk.cn_root.key"
ROOT_CERT="$CERT_DIR/api.crossdesk.cn_root.crt"
SERVER_KEY="$CERT_DIR/api.crossdesk.cn.key"
SERVER_CSR="$CERT_DIR/api.crossdesk.cn.csr"
SERVER_CERT="$CERT_DIR/api.crossdesk.cn_bundle.crt"
SAN_CONF="$CERT_DIR/san.cnf"

config_load crossdesk-server
config_get domain global domain ""

if [ -z "$domain" ]; then
	echo "No domain configured (crossdesk-server.global.domain)" >&2
	exit 1
fi

# A DNS SAN must be a hostname, not an IP address.
if printf '%s' "$domain" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
	echo "Domain '$domain' is an IP address; this script only creates DNS SAN certificates" >&2
	exit 1
fi
case "$domain" in
	*.*) : ;;
	*)
		echo "Domain '$domain' does not look like a hostname" >&2
		exit 1
		;;
esac

command -v openssl >/dev/null 2>&1 || {
	echo "openssl not found (install openssl-util)" >&2
	exit 1
}

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

SUBJ="/C=CN/ST=Zhejiang/L=Hangzhou/O=CrossDesk/OU=CrossDesk/CN=$domain"

echo "Generating root CA (4096-bit, 3650 days)..."
openssl genrsa -out "$ROOT_KEY" 4096 2>/dev/null
openssl req -x509 -new -nodes -key "$ROOT_KEY" -sha256 -days 3650 \
	-out "$ROOT_CERT" -subj "$SUBJ" 2>/dev/null

echo "Generating server key (2048-bit)..."
openssl genrsa -out "$SERVER_KEY" 2048 2>/dev/null
openssl req -new -key "$SERVER_KEY" -out "$SERVER_CSR" -subj "$SUBJ" 2>/dev/null

cat > "$SAN_CONF" <<EOF
[ req ]
default_bits = 2048
distinguished_name = req_distinguished_name
req_extensions = req_ext
prompt = no

[ req_distinguished_name ]
C = CN
ST = Zhejiang
L = Hangzhou
O = CrossDesk
OU = CrossDesk
CN = $domain

[ req_ext ]
subjectAltName = DNS:$domain
EOF

echo "Signing server certificate with root CA (SAN=DNS:$domain, 3650 days)..."
openssl x509 -req -in "$SERVER_CSR" -CA "$ROOT_CERT" -CAkey "$ROOT_KEY" \
	-CAcreateserial -out "$SERVER_CERT.tmp" -days 3650 -sha256 \
	-extfile "$SAN_CONF" -extensions req_ext 2>/dev/null

# bundle.crt is the full chain (server cert + root cert), same as upstream.
cat "$SERVER_CERT.tmp" "$ROOT_CERT" > "$SERVER_CERT"
# Note: -CAcreateserial writes <CA basename>.srl, i.e. api.crossdesk.cn_root.srl
# (without the .crt suffix), not $ROOT_CERT.srl.
rm -f "$SERVER_CERT.tmp" "${ROOT_CERT%.crt}.srl" "$SAN_CONF" "$ROOT_KEY" "$SERVER_CSR"

chmod 600 "$SERVER_KEY"
chmod 644 "$SERVER_CERT" "$ROOT_CERT"

echo "Certificate written:"
echo "  $SERVER_CERT"
echo "  $SERVER_KEY"
echo "  root cert (install on clients that validate): $ROOT_CERT"
openssl x509 -in "$SERVER_CERT" -noout -subject -ext subjectAltName -enddate 2>/dev/null || true
logger -t crossdesk-server "Self-signed certificate generated for $domain"

if pgrep -x crossdesk_server >/dev/null 2>&1; then
	echo "Restarting crossdesk-server..."
	/etc/init.d/crossdesk-server restart
fi

exit 0
