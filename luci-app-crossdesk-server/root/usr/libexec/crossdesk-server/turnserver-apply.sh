#!/bin/sh
# Apply the local coturn (TURN relay) configuration from UCI.
#
# Reads /etc/config/crossdesk-server: global.domain and the turn
# section (use_local, local_port, realm, secret, relay_min_port,
# relay_max_port, external_ip).
#
# use_local=1 (use the coturn running on this router):
#   - Generates /etc/turnserver.conf (listening port, realm,
#     static-auth-secret, relay port range, external IP). coturn's
#     external-ip only takes an IP address, so the configured
#     external address (a domain by default) is resolved to the
#     current public IPv4 first; if DNS fails, the WAN interface
#     address is used; if that fails too, external-ip is omitted
#     and a warning is logged. Re-run this script if the WAN IP
#     changes, or the relayed candidates will advertise a stale IP.
#   - Syncs the server-side TURN settings: turn.host is set to the
#     domain and turn.port to the local coturn port, so
#     crossdesk-server issues the local relay to clients. The
#     previous manual host/port are stashed in turn.host_backup /
#     turn.port_backup and restored when local coturn is disabled.
#     The secret is shared: it is written to turnserver.conf as
#     static-auth-secret AND read by crossdesk-server as
#     COTURN_AUTH_SECRET, so it only has to be entered once.
#   - Adds firewall rules (listening port + relay port range,
#     TCP+UDP) if they do not exist yet, and reloads the firewall.
#   - Enables and restarts coturn (its own /etc/init.d/turnserver),
#     then restarts crossdesk-server if it is running.
# use_local=0 (third-party TURN): turn.host/port/secret are used as
#   typed in LuCI. Local coturn is left untouched; use the
#   start/stop buttons in LuCI to control it by hand.
#
# Idempotent; exits non-zero with a message on failure. All steps
# are logged with the crossdesk-server tag.

set -e

. /lib/functions.sh

TURNSERVER_CONF="/etc/turnserver.conf"

log() {
	echo "$1"
	logger -t crossdesk-server "$1"
}

# Resolve a hostname (or plain IPv4) to an IPv4 address.
# Prints the address, or nothing if it cannot be resolved.
resolve_ipv4() {
	local host="$1" ip
	if printf '%s' "$host" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
		printf '%s' "$host"
		return 0
	fi
	# busybox nslookup prints one "Address N: <ip>" line per answer
	# (the first one is the DNS server itself, with extra text after
	# the address, so the anchored pattern skips it). Take the last
	# dotted-quad answer.
	ip=$(nslookup "$host" 2>/dev/null | awk '/^Address [0-9]+: [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/{ip=$3} END{print ip}')
	printf '%s' "$ip"
}

# Check whether a firewall rule with the given name already exists.
FW_WANT=""
FW_FOUND=0
_fw_check_one() {
	local n
	config_get n "$1" name ""
	[ "$n" = "$FW_WANT" ] && FW_FOUND=1
	# Must always succeed: with set -e a non-zero return here would
	# abort the whole script on the first non-matching rule.
	return 0
}
fw_rule_exists() {
	FW_WANT="$1"; FW_FOUND=0
	config_load firewall
	config_foreach _fw_check_one rule
	[ "$FW_FOUND" = 1 ]
}

ensure_fw_rule() {
	local name="$1" port="$2" proto="$3" sec
	if fw_rule_exists "$name"; then
		log "Firewall rule '$name' already exists, skipping."
		return 0
	fi
	sec=$(uci add firewall rule)
	uci set "firewall.$sec.name=$name"
	uci set "firewall.$sec.src=*"
	uci set "firewall.$sec.dest_port=$port"
	uci set "firewall.$sec.proto=$proto"
	uci set "firewall.$sec.target=ACCEPT"
	uci commit firewall
	log "Firewall rule '$name' added ($proto $port)."
}

config_load crossdesk-server
config_get domain global domain ""
config_get_bool use_local turn use_local 0
config_get local_port turn local_port 3478
config_get realm turn realm ""
config_get secret turn secret ""
config_get relay_min turn relay_min_port 50000
config_get relay_max turn relay_max_port 50100
config_get external_ip turn external_ip ""

if [ "$use_local" != 1 ]; then
	# Third-party TURN: restore a stashed manual host/port if the
	# user previously had local coturn enabled, then stop here.
	config_get host_backup turn host_backup ""
	config_get port_backup turn port_backup ""
	if [ -n "$host_backup" ]; then
		uci set crossdesk-server.turn.host="$host_backup"
		uci set crossdesk-server.turn.port="$port_backup"
		uci delete crossdesk-server.turn.host_backup
		uci delete crossdesk-server.turn.port_backup
		uci commit crossdesk-server
		log "Local coturn disabled; manual TURN host/port restored."
	else
		log "Local coturn disabled; using third-party TURN as configured."
	fi
	exit 0
fi

# --- use_local=1 ---
[ -n "$domain" ] || { echo "No domain configured (crossdesk-server.global.domain)" >&2; exit 1; }
[ -n "$secret" ] || { echo "TURN secret is empty; set it in LuCI (TURN section) first" >&2; exit 1; }
[ -z "$realm" ] && realm="$domain"
[ -z "$external_ip" ] && external_ip="$domain"

EXT_IP=$(resolve_ipv4 "$external_ip")
if [ -z "$EXT_IP" ]; then
	EXT_IP=$(ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@["ipv4-address"][0].address' 2>/dev/null)
	[ -n "$EXT_IP" ] && log "Could not resolve $external_ip, using WAN address $EXT_IP instead."
fi
if [ -z "$EXT_IP" ]; then
	log "WARNING: could not determine the public IP for $external_ip; writing turnserver.conf without external-ip (relay may advertise a LAN address)."
fi

log "Writing $TURNSERVER_CONF (listening $local_port, realm $realm, relay $relay_min-$relay_max)..."
cat > "$TURNSERVER_CONF" <<EOF
# Generated by luci-app-crossdesk-server (turnserver-apply.sh). Do not edit by hand;
# change it in LuCI: CrossDesk Server -> TURN, then click "Apply relay config".
# External address $external_ip resolved to ${EXT_IP:-<unresolved>} at apply time;
# re-apply if the WAN IP changes.
listening-port=$local_port
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=$secret
realm=$realm
server-name=$realm
min-port=$relay_min
max-port=$relay_max
EOF
[ -n "$EXT_IP" ] && echo "external-ip=$EXT_IP" >> "$TURNSERVER_CONF"
# Plain turn only; the server never issues turns: URLs.
echo "no-tls" >> "$TURNSERVER_CONF"
echo "no-dtls" >> "$TURNSERVER_CONF"
# Secret inside: readable by the turnserver user only.
chmod 640 "$TURNSERVER_CONF"
chown root:turnserver "$TURNSERVER_CONF" 2>/dev/null || chmod 644 "$TURNSERVER_CONF"

# Sync the server-side TURN settings. Stash a manual host/port first
# (once) so disabling local coturn later can restore them.
config_get cur_host turn host ""
config_get cur_port turn port "3478"
config_get host_backup turn host_backup ""
if [ -z "$host_backup" ] && [ -n "$cur_host" ] && [ "$cur_host" != "$domain" ]; then
	uci set crossdesk-server.turn.host_backup="$cur_host"
	uci set crossdesk-server.turn.port_backup="$cur_port"
fi
uci set crossdesk-server.turn.host="$domain"
uci set crossdesk-server.turn.port="$local_port"
uci commit crossdesk-server

# Firewall: listening port + relay range (both TCP and UDP).
ensure_fw_rule "Allow-crossdesk-turn" "$local_port" "tcp udp"
ensure_fw_rule "Allow-crossdesk-turn-relay" "$relay_min-$relay_max" "tcp udp"
/etc/init.d/firewall reload 2>/dev/null || log "WARNING: firewall reload failed; rules take effect after the next firewall restart."

# Enable + restart coturn (its own UCI switch + init script).
if ! uci -q get turnserver.general.enabled >/dev/null 2>&1; then
	uci add turnserver general >/dev/null
	uci rename turnserver.@general[-1] general
fi
uci set turnserver.general.enabled='1'
uci commit turnserver
/etc/init.d/turnserver enable
/etc/init.d/turnserver restart

# Restart crossdesk-server so it picks up the synced COTURN_*/ICE values.
if pgrep -x crossdesk_server >/dev/null 2>&1; then
	/etc/init.d/crossdesk-server restart
fi

log "Local coturn applied and restarted (turn $domain:$local_port, realm $realm)."
exit 0
