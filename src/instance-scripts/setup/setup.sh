#!/bin/bash
#
# Full provisioning for a fresh TTE Terraria EC2 instance. Idempotent -- every
# step is guarded, so re-running upgrades in place rather than duplicating work.
#
# Runs BEFORE SSM is usable (it installs the agent itself), so this is staged on
# the box over SSH rather than delivered by Run Command:
#
#   scp -r setup/ ubuntu@<ip>:/tmp/tte-setup/
#   ssh ubuntu@<ip>
#   sudo TTE_REST_PASSWORD=... /tmp/tte-setup/setup.sh
#
# The instance role must already be attached before this runs -- the script
# pulls TShock from S3 and cannot bootstrap its own credentials. See README.
#
# Steps run in order; use --only/--skip to re-run a subset:
#   awscli dotnet layout ssm tshock metrics account config summary
# (preflight always runs -- later steps depend on what it resolves.)
#
set -euo pipefail

# --- configuration ------------------------------------------------------------
# All overridable from the environment. Defaults match the prod fleet.

ROOT=${TTE_ROOT:-/home/ubuntu/terraria}
RUN_AS=${TTE_USER:-ubuntu}

TSHOCK_BUCKET=${TTE_TSHOCK_BUCKET:-ttesm-resources}
TSHOCK_KEY=${TTE_TSHOCK_KEY:-tshock/current.zip}

LOGS_BUCKET=${TTE_LOGS_BUCKET:-ttesm-logs}
CONFIG_BUCKET=${TTE_CONFIG_BUCKET:-ttesm-server-configs}
INSTANCE_TABLE=${TTE_INSTANCE_TABLE:-ttesm-instance-data}

# Default matches the shape used by the existing fleet's validRoots (checked
# against the live ttesm-instance-data table, not guessed) -- nickname=path
# pairs, comma-separated, paths relative to BASE_ROOT/TTE_ROOT.
VALID_ROOTS=${TTE_VALID_ROOTS:-"main=/tshock,worlds=/worlds,plugins=/tshock/ServerPlugins"}
WORLD_PATH_NICKNAMES=${TTE_WORLD_PATH_NICKNAMES:-worlds}

REST_PORT=${TTE_REST_PORT:-3891}
REST_USER=${TTE_REST_USER:-ttesm_lambda_user}
REST_GROUP=${TTE_REST_GROUP:-ttesm-rest}
REST_PASSWORD=${TTE_REST_PASSWORD:-}

DOTNET_MAJOR=${TTE_DOTNET_MAJOR:-9}

# Permissions the lambda's REST calls require. Kept in sync with the docstring
# on _shared/shared/utils/TShockAPI.ts -- if you add a REST call there that
# needs a new permission, add it here too or the call 403s on a fresh box.
REST_PERMS=(
	tshock.rest.maintenance
	tshock.rest.useapi
	tshock.rest.cfg
	tshock.rest.mute
	tshock.rest.kill
	tshock.rest.kick
	"tshock.rest.bans.*"
	tshock.rest.users.info
	tshock.rest.broadcast
	"playerinfo.*"
	"tshock.*"
)

# preflight is deliberately absent -- it always runs, since later steps depend on
# the ARCH/INSTANCE_ID it resolves.
STEPS=(awscli dotnet layout ssm tshock metrics account config register summary)

# --- plumbing -----------------------------------------------------------------

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ONLY=""
SKIP=""

# The account step leaves a server and a fifo-holder running. An EXIT trap, not a
# RETURN one -- die() exits the script outright, and a RETURN trap would never
# fire, orphaning a TShock process holding the setup world open.
ACCOUNT_SERVER_PID=""
ACCOUNT_HOLDER_PID=""

# `tte-metrics-ctl status` output from step_metrics, consumed by step_register.
# Empty when metrics was skipped via --only/--skip, which is exactly when the
# row should not claim a metrics config.
METRICS_STATUS_JSON=""
cleanup_account() {
	[ -n "$ACCOUNT_HOLDER_PID" ] && kill "$ACCOUNT_HOLDER_PID" 2>/dev/null
	[ -n "$ACCOUNT_SERVER_PID" ] && kill "$ACCOUNT_SERVER_PID" 2>/dev/null
	ACCOUNT_SERVER_PID=""
	ACCOUNT_HOLDER_PID=""
	rm -f /tmp/tte-setup-ctl /tmp/tte-setup-world.wld
	return 0
}
trap cleanup_account EXIT

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mFATAL\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
	case "$1" in
		--only) ONLY=$2; shift 2 ;;
		--skip) SKIP=$2; shift 2 ;;
		--help|-h)
			echo "usage: sudo [ENV=...] $0 [--only step,step] [--skip step,step]"
			echo "steps: ${STEPS[*]}"
			exit 0 ;;
		*) die "unknown argument: $1" ;;
	esac
done

should_run() {
	local step=$1
	if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$step,"* ]]; then return 1; fi
	if [ -n "$SKIP" ] && [[ ",$SKIP," == *",$step,"* ]]; then return 1; fi
	return 0
}

# The dotnet/aws installs put binaries somewhere the current shell hasn't seen.
export PATH=$PATH:/usr/local/bin:/usr/share/dotnet:/snap/bin

# --- steps --------------------------------------------------------------------

step_preflight() {
	log "preflight"

	[ "$(id -u)" -eq 0 ] || die "must run as root (sudo $0)"
	id "$RUN_AS" >/dev/null 2>&1 || die "user '$RUN_AS' does not exist"

	command -v apt-get >/dev/null 2>&1 || die "expected a Debian/Ubuntu instance (no apt-get)"

	# Everything downstream needs at least one of these; fail now with a clear
	# message rather than halfway through an install.
	[ -n "$TSHOCK_BUCKET" ] || die "TTE_TSHOCK_BUCKET must be set (bucket holding the TShock zip)"
	[ -n "$LOGS_BUCKET" ]   || die "TTE_LOGS_BUCKET must be set (logs bucket, for metrics + console logs)"
	[ -n "$REST_PASSWORD" ] || die "TTE_REST_PASSWORD must be set, and must match TSHOCK_PASSWORD in the Secrets Manager secret"

	ARCH=$(uname -m)
	case "$ARCH" in
		x86_64)  AWS_ARCH=x86_64;  DOTNET_ARCH=x64 ;;
		aarch64) AWS_ARCH=aarch64; DOTNET_ARCH=arm64 ;;
		*) die "unsupported architecture: $ARCH" ;;
	esac

	# IMDSv2. Also doubles as the check that we're actually on EC2.
	local imds_token
	imds_token=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" \
		-H "X-aws-ec2-metadata-token-ttl-seconds: 300" --max-time 5 2>/dev/null) \
		|| die "could not reach IMDS -- is this an EC2 instance?"

	INSTANCE_ID=$(curl -sS -H "X-aws-ec2-metadata-token: $imds_token" \
		--max-time 5 "http://169.254.169.254/latest/meta-data/instance-id")
	[ -n "$INSTANCE_ID" ] || die "could not read instance id from IMDS"

	local role
	role=$(curl -sS -H "X-aws-ec2-metadata-token: $imds_token" --max-time 5 \
		"http://169.254.169.254/latest/meta-data/iam/security-credentials/" 2>/dev/null || true)
	[ -n "$role" ] || die "no IAM role attached to this instance -- attach it before running (see README)"

	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq
	apt-get install -y -qq curl unzip jq ca-certificates sqlite3 >/dev/null

	ok "instance $INSTANCE_ID ($ARCH), role $role"
}

step_awscli() {
	log "aws cli"

	if command -v aws >/dev/null 2>&1 && aws --version 2>&1 | grep -q "aws-cli/2"; then
		ok "already installed: $(aws --version 2>&1)"
		return
	fi

	local tmp
	tmp=$(mktemp -d)
	curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o "$tmp/awscliv2.zip"
	unzip -q "$tmp/awscliv2.zip" -d "$tmp"
	# --update makes this safe over an existing v2 install.
	"$tmp/aws/install" --update >/dev/null
	rm -rf "$tmp"

	command -v aws >/dev/null 2>&1 || die "aws cli install did not put 'aws' on PATH"
	ok "installed $(aws --version 2>&1)"
}

step_dotnet() {
	log "dotnet ${DOTNET_MAJOR}"

	if command -v dotnet >/dev/null 2>&1 && \
	   dotnet --list-runtimes 2>/dev/null | grep -q "Microsoft.NETCore.App ${DOTNET_MAJOR}\."; then
		ok "runtime ${DOTNET_MAJOR}.x already present"
		return
	fi

	# Ubuntu 24.04+ carries dotnet 9 in its own repos. Older releases don't, so
	# fall back to Microsoft's install script rather than pinning an apt source
	# that may not exist for this release.
	if apt-get install -y -qq "dotnet-runtime-${DOTNET_MAJOR}.0" >/dev/null 2>&1; then
		ok "installed from apt"
	else
		warn "apt has no dotnet-runtime-${DOTNET_MAJOR}.0, falling back to dotnet-install.sh"
		local tmp
		tmp=$(mktemp -d)
		curl -sSL https://dot.net/v1/dotnet-install.sh -o "$tmp/dotnet-install.sh"
		chmod +x "$tmp/dotnet-install.sh"
		"$tmp/dotnet-install.sh" --channel "${DOTNET_MAJOR}.0" --runtime dotnet \
			--architecture "$DOTNET_ARCH" --install-dir /usr/share/dotnet >/dev/null
		ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
		rm -rf "$tmp"
		ok "installed to /usr/share/dotnet"
	fi

	# TShock is launched by systemd-run without a login shell, so DOTNET_ROOT
	# has to be discoverable system-wide rather than from ubuntu's .bashrc.
	cat > /etc/profile.d/dotnet.sh <<-'EOF'
		export DOTNET_ROOT=/usr/share/dotnet
		export PATH=$PATH:/usr/share/dotnet
		export DOTNET_CLI_TELEMETRY_OPTOUT=1
	EOF
	chmod 0644 /etc/profile.d/dotnet.sh

	dotnet --list-runtimes 2>/dev/null | grep -q "Microsoft.NETCore.App ${DOTNET_MAJOR}\." \
		|| die "dotnet ${DOTNET_MAJOR} runtime still not visible after install"
	ok "runtime ready"
}

step_layout() {
	log "file layout"

	install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$ROOT"
	install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$ROOT/tshock"
	install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$ROOT/logs"
	# TSHOCK_OUT_LOGS / TSHOCK_ERR_LOGS point *inside* logs/, and the launch command redirects into
	# them with `1>> .../stdout/DATE.log`. Shell redirection creates the file but never the directory,
	# so if these are missing the redirect fails before exec and TShock silently never starts --
	# no world file, no console output, nothing to diagnose from.
	install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$ROOT/logs/stdout"
	install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$ROOT/logs/errout"
	# Sibling to tshock/, not inside it -- matches the existing fleet's "worlds"
	# validRoots entry, and keeps world saves out of the REST-account bootstrap's
	# throwaway world (which lives in /tmp, not here).
	install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$ROOT/worlds"

	ok "$ROOT/{tshock,logs/{stdout,errout},worlds}"
}

step_ssm() {
	log "ssm agent"

	if systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service 2>/dev/null \
	   || systemctl is-active --quiet amazon-ssm-agent 2>/dev/null; then
		ok "already running"
		return
	fi

	if command -v snap >/dev/null 2>&1; then
		snap install amazon-ssm-agent --classic >/dev/null 2>&1 || true
		snap start amazon-ssm-agent >/dev/null 2>&1 || true
	fi

	if ! systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service 2>/dev/null; then
		local tmp
		tmp=$(mktemp -d)
		local deb_arch=amd64
		[ "$ARCH" = "aarch64" ] && deb_arch=arm64
		curl -sS "https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/debian_${deb_arch}/amazon-ssm-agent.deb" \
			-o "$tmp/ssm.deb"
		dpkg -i "$tmp/ssm.deb" >/dev/null
		systemctl enable --now amazon-ssm-agent
		rm -rf "$tmp"
	fi

	ok "installed"
}

step_tshock() {
	log "tshock"

	local marker="$ROOT/tshock/.tte-installed-key"
	if [ -f "$marker" ] && [ "$(cat "$marker")" = "$TSHOCK_KEY" ] && [ -f "$ROOT/tshock/TShock.Server" ]; then
		ok "already installed from s3://$TSHOCK_BUCKET/$TSHOCK_KEY"
		return
	fi

	local tmp
	tmp=$(mktemp -d)
	aws s3 cp "s3://${TSHOCK_BUCKET}/${TSHOCK_KEY}" "$tmp/tshock.zip" >/dev/null \
		|| die "could not download s3://${TSHOCK_BUCKET}/${TSHOCK_KEY} -- check the key and the instance role's s3:GetObject"

	unzip -q -o "$tmp/tshock.zip" -d "$tmp/unpacked"

	# The zip may or may not have a single wrapping directory; normalise both.
	local src="$tmp/unpacked"
	if [ ! -f "$src/TShock.Server" ]; then
		local nested
		nested=$(find "$src" -maxdepth 2 -name TShock.Server -printf '%h\n' -quit)
		[ -n "$nested" ] || die "TShock.Server not found in the zip -- check the artifact layout"
		src=$nested
	fi

	# Preserve config.json / tshock.sqlite across upgrades; the zip shouldn't
	# carry them, but an accidental overwrite would wipe the REST account.
	cp -a "$src/." "$ROOT/tshock/"
	chown -R "$RUN_AS:$RUN_AS" "$ROOT/tshock"
	chmod +x "$ROOT/tshock/TShock.Server"
	printf '%s' "$TSHOCK_KEY" > "$marker"
	rm -rf "$tmp"

	ok "installed from s3://$TSHOCK_BUCKET/$TSHOCK_KEY"
}

# Pulls one field out of the inst# row's metricsConfig map, or prints nothing.
# Always returns 0: a missing row, a missing attribute and a box that predates
# the setting are all normal, and under `set -e` a non-zero return here would
# abort the whole provision.
read_metrics_cfg() {
	local field=$1 dtype=$2 key val

	[ -n "$INSTANCE_TABLE" ] || return 0

	key=$(printf '{"uid":{"S":"inst#%s"}}' "$INSTANCE_ID")
	val=$(aws dynamodb get-item --table-name "$INSTANCE_TABLE" --key "$key" \
		--query "Item.metricsConfig.M.${field}.${dtype}" --output text 2>/dev/null || true)

	if [ -n "$val" ] && [ "$val" != "None" ]; then
		printf '%s' "$val"
	fi
	return 0
}

# Pulls one field out of the JSON status line tte-metrics-ctl prints. That line
# is a flat object of booleans, integers and two fixed enum strings, so no value
# can contain a comma, colon or brace -- which is what makes this three
# substitutions rather than a JSON parser the box may not have.
metrics_status_field() {
	printf '%s' "$METRICS_STATUS_JSON" | tr -d '{}"' | tr ',' '\n' \
		| awk -F: -v k="$1" '$1 == k { print $2; exit }'
}

step_metrics() {
	log "metrics collector"

	local installer="$HERE/../metrics/install.sh"
	[ -f "$installer" ] || die "metrics installer not found at $installer -- stage the whole instance-scripts/ directory, not just setup/"

	# Rebuilding a box that already has an inst# row picks its saved metrics
	# settings back up, so a fleet replacement doesn't silently reset everything
	# configured from the web UI. A genuinely new instance has no row yet (this
	# step runs before `register` seeds one) and falls through to the installer's
	# own defaults.
	local cfg_enabled cfg_mode cfg_collect cfg_upload cfg_retain
	# --output text renders a DynamoDB BOOL as Python's True/False; the installer
	# and tte-metrics-ctl both want lowercase.
	cfg_enabled=$(read_metrics_cfg enabled BOOL | tr '[:upper:]' '[:lower:]')
	cfg_mode=$(read_metrics_cfg uploadMode S)
	cfg_collect=$(read_metrics_cfg collectSec N)
	cfg_upload=$(read_metrics_cfg uploadSec N)
	cfg_retain=$(read_metrics_cfg retainDays N)

	# Built as an array for `env` rather than as inline VAR=val prefixes: prefix
	# assignments are recognised when the command is parsed, so a ${x:+VAR=val}
	# that expands later lands as an argument to bash instead of as a variable.
	local -a envs=(TTE_METRICS_BUCKET="$LOGS_BUCKET")
	if [ -n "$cfg_enabled" ]; then envs+=(TTE_METRICS_ENABLED="$cfg_enabled"); fi
	if [ -n "$cfg_mode" ]; then envs+=(TTE_METRICS_UPLOAD_MODE="$cfg_mode"); fi
	if [ -n "$cfg_collect" ]; then envs+=(TTE_METRICS_COLLECT_SEC="$cfg_collect"); fi
	if [ -n "$cfg_upload" ]; then envs+=(TTE_METRICS_UPLOAD_SEC="$cfg_upload"); fi
	if [ -n "$cfg_retain" ]; then envs+=(TTE_METRICS_RETAIN_DAYS="$cfg_retain"); fi

	if [ -n "$cfg_collect" ]; then
		ok "reusing saved metrics config from inst#${INSTANCE_ID}"
	fi

	env "${envs[@]}" bash "$installer"

	# Captured for step_register to record on the inst# row. Read back from the
	# box rather than reassembled from the values above so it reflects what was
	# actually applied -- the installer owns the defaults for anything not passed
	# in, and duplicating them here would be a third place to keep in sync.
	METRICS_STATUS_JSON=$(/usr/local/bin/tte-metrics-ctl status 2>/dev/null || true)

	ok "metrics installed"
}

step_account() {
	log "tshock rest account"

	local db="$ROOT/tshock/tshock.sqlite"
	if [ -f "$db" ] && sqlite3 "$db" \
		"SELECT 1 FROM Users WHERE Username='${REST_USER}' LIMIT 1;" 2>/dev/null | grep -q 1; then
		ok "'$REST_USER' already exists"
		return
	fi

	# TShock has no offline user-add. The only supported path is driving the
	# server console, which means booting it once against a throwaway world and
	# writing commands to its stdin. The console session is implicitly
	# superadmin, so no /setup code is needed.
	local world="/tmp/tte-setup-world.wld"
	local console="/tmp/tte-setup-console.log"
	local ctl="/tmp/tte-setup-ctl"

	rm -f "$world" "$console" "$ctl"
	mkfifo "$ctl"
	chown "$RUN_AS:$RUN_AS" "$ctl"
	touch "$console"
	chown "$RUN_AS:$RUN_AS" "$console"

	# Holds the write end open so TShock doesn't see EOF and exit early.
	sleep 600 > "$ctl" &
	ACCOUNT_HOLDER_PID=$!

	# TShock's config.json/tshock.sqlite path is hardcoded to a "tshock" folder
	# relative to the process's CWD, not to the executable's location -- the live
	# fleet launches from $ROOT for exactly this reason (see launchWorld.ts's
	# `cd "$TSHOCK_WD" && exec .../tshock/TShock.Server`). Without cd'ing here
	# first, TShock inherits the SSH session's login-shell CWD (ubuntu's $HOME)
	# and writes its files to the wrong place entirely.
	local prev_pwd=$PWD
	cd "$ROOT"

	# A bind port nothing else uses, so this can't collide with a live server.
	sudo -u "$RUN_AS" env DOTNET_ROOT=/usr/share/dotnet HOME="/home/$RUN_AS" \
		"$ROOT/tshock/TShock.Server" \
			-world "$world" -autocreate 1 -worldname TTESetup -seed tte \
			-port 7999 -maxplayers 1 \
		< "$ctl" > "$console" 2>&1 &
	ACCOUNT_SERVER_PID=$!
	local server=$ACCOUNT_SERVER_PID

	cd "$prev_pwd"

	# World generation dominates this wait; a small world is usually <60s but
	# a cold page cache on a t-class box can push it well past that.
	log "  booting throwaway server for console access (up to 5 min)..."
	local waited=0
	until grep -qiE "type 'help'|server started|listening on port" "$console" 2>/dev/null; do
		sleep 3
		waited=$((waited + 3))
		if ! kill -0 "$server" 2>/dev/null; then
			echo "--- console transcript ---" >&2
			cat "$console" >&2
			die "TShock exited before becoming ready"
		fi
		if [ "$waited" -ge 300 ]; then
			echo "--- console transcript ---" >&2
			cat "$console" >&2
			die "TShock never reported ready after ${waited}s"
		fi
	done
	ok "console ready after ${waited}s"

	send() { printf '%s\n' "$1" > "$ctl"; sleep 2; }

	send "/group add ${REST_GROUP}"
	for perm in "${REST_PERMS[@]}"; do
		send "/group addperm ${REST_GROUP} ${perm}"
	done
	send "/user add ${REST_USER} ${REST_PASSWORD} ${REST_GROUP}"
	sleep 3
	send "/off"
	sleep 5

	# Verify against the database rather than the console output -- TShock
	# reports most of these as success even when they partially applied.
	[ -f "$db" ] || { echo "--- console transcript ---" >&2; cat "$console" >&2; die "no tshock.sqlite was created"; }

	sqlite3 "$db" "SELECT 1 FROM Users WHERE Username='${REST_USER}' LIMIT 1;" 2>/dev/null | grep -q 1 || {
		echo "--- console transcript ---" >&2
		cat "$console" >&2
		die "user '${REST_USER}' was not created -- see transcript above, and README 'account bootstrap' for the manual fallback"
	}

	local granted
	granted=$(sqlite3 "$db" "SELECT Commands FROM GroupList WHERE GroupName='${REST_GROUP}';" 2>/dev/null || true)
	for perm in "${REST_PERMS[@]}"; do
		[[ "$granted" == *"$perm"* ]] || warn "permission '$perm' missing from group '${REST_GROUP}'"
	done

	# The transcript is the only evidence if REST auth misbehaves later.
	cp "$console" "$ROOT/logs/setup-console.log"
	chown "$RUN_AS:$RUN_AS" "$ROOT/logs/setup-console.log"

	cleanup_account
	ok "'$REST_USER' created in group '$REST_GROUP' (transcript: $ROOT/logs/setup-console.log)"
}

step_config() {
	log "tshock config"

	local cfg="$ROOT/tshock/config.json"
	[ -f "$cfg" ] || die "no config.json at $cfg -- the account step should have generated it; re-run --only account"

	# REST is off by default and the lambda has no other way in. Token endpoint
	# auth is what makes /v2/token/create accept the user/password pair the
	# lambda pulls from Secrets Manager.
	local patched
	patched=$(jq \
		--argjson port "$REST_PORT" \
		'.Settings.RestApiEnabled = true
		 | .Settings.RestApiPort = $port
		 | .Settings.EnableTokenEndpointAuthentication = true
		 | .Settings.LogRest = true' "$cfg") \
		|| die "config.json is not valid JSON"

	printf '%s\n' "$patched" > "$cfg"
	chown "$RUN_AS:$RUN_AS" "$cfg"
	ok "REST enabled on port $REST_PORT"

	# The app treats S3 as the source of truth for config -- writeConfig and
	# applyServerPasswordToConfig both read inst#<id>/config.json and throw if
	# it's absent, so seed it now rather than on first use.
	if [ -n "$CONFIG_BUCKET" ]; then
		local key="inst#${INSTANCE_ID}/config.json"
		if aws s3 ls "s3://${CONFIG_BUCKET}/${key}" >/dev/null 2>&1; then
			ok "s3://${CONFIG_BUCKET}/${key} already exists, leaving it alone"
		else
			aws s3 cp "$cfg" "s3://${CONFIG_BUCKET}/${key}" >/dev/null \
				|| die "failed to seed config to s3://${CONFIG_BUCKET}/${key}"
			ok "seeded s3://${CONFIG_BUCKET}/${key}"
		fi
	else
		warn "TTE_CONFIG_BUCKET unset -- skipping S3 config seed. Config reads/writes and launch passwords will fail until inst#${INSTANCE_ID}/config.json exists."
	fi

	cat > /etc/tte-instance.env <<-EOF
		TTE_ROOT=$ROOT
		TTE_INSTANCE_ID=$INSTANCE_ID
		TTE_REST_PORT=$REST_PORT
		TTE_REST_USER=$REST_USER
		TTE_LOGS_BUCKET=$LOGS_BUCKET
		TTE_CONFIG_BUCKET=$CONFIG_BUCKET
		TTE_TSHOCK_SOURCE=s3://$TSHOCK_BUCKET/$TSHOCK_KEY
	EOF
	chmod 0644 /etc/tte-instance.env
}

step_register() {
	log "instance table row"

	if [ -z "$INSTANCE_TABLE" ]; then
		warn "TTE_INSTANCE_TABLE unset -- skipping. File browsing and launchWorld will reject every path until inst#${INSTANCE_ID} has validRoots/worldPaths (see README)."
		return
	fi

	local key
	key=$(printf '{"uid":{"S":"inst#%s"}}' "$INSTANCE_ID")

	# Don't clobber an entry someone has since hand-edited via the Users page's
	# path editor (editPaths.ts) -- only seed defaults for a truly new row.
	local existing
	existing=$(aws dynamodb get-item --table-name "$INSTANCE_TABLE" --key "$key" \
		--query 'Item.validRoots' --output text 2>/dev/null || true)
	if [ -n "$existing" ] && [ "$existing" != "None" ]; then
		ok "inst#${INSTANCE_ID} already has validRoots, leaving it alone"
		return
	fi

	# Build the validRoots map and worldPaths list as DynamoDB JSON from the
	# nickname=path,nickname=path config string.
	local roots_json="{"
	local first=1
	IFS=',' read -ra pairs <<< "$VALID_ROOTS"
	for pair in "${pairs[@]}"; do
		local nickname=${pair%%=*}
		local path=${pair#*=}
		[ -n "$nickname" ] && [ -n "$path" ] || die "malformed TTE_VALID_ROOTS entry: '$pair'"
		[ "$first" -eq 1 ] || roots_json+=","
		roots_json+=$(printf '"%s":{"S":"%s"}' "$nickname" "$path")
		first=0
	done
	roots_json+="}"

	local worldpaths_json="["
	first=1
	IFS=',' read -ra nicknames <<< "$WORLD_PATH_NICKNAMES"
	for nickname in "${nicknames[@]}"; do
		[[ ",$VALID_ROOTS," == *",${nickname}="* ]] || die "worldPaths nickname '$nickname' is not in TTE_VALID_ROOTS"
		[ "$first" -eq 1 ] || worldpaths_json+=","
		worldpaths_json+=$(printf '{"S":"%s"}' "$nickname")
		first=0
	done
	worldpaths_json+="]"

	# Recording what step_metrics applied is the only thing that makes a later
	# rebuild able to restore these settings -- nothing re-applies stored config at
	# boot, so step_metrics reading this row back is the entire reconciliation
	# story. It also keeps the web UI from reporting a provisioned instance as
	# never configured, which it otherwise would: the API hands back defaults when
	# the attribute is absent and flags them as unsaved.
	#
	# Same ordering rule the lambda follows (see writeMetricsConfig): this is
	# written only after the apply on the box succeeded, so the row can never claim
	# a setting the instance is not running.
	local metrics_json=""
	if [ -n "$METRICS_STATUS_JSON" ]; then
		local m_enabled m_mode m_collect m_upload m_retain
		m_enabled=$(metrics_status_field enabled)
		m_mode=$(metrics_status_field uploadMode)
		m_collect=$(metrics_status_field collectSec)
		m_upload=$(metrics_status_field uploadSec)
		m_retain=$(metrics_status_field retainDays)

		if [ -n "$m_enabled" ] && [ -n "$m_mode" ] && [ -n "$m_collect" ] \
			&& [ -n "$m_upload" ] && [ -n "$m_retain" ]; then
			metrics_json=$(printf '"metricsConfig": {"M": {"enabled":{"BOOL":%s},"uploadMode":{"S":"%s"},"collectSec":{"N":"%s"},"uploadSec":{"N":"%s"},"retainDays":{"N":"%s"},"appliedAt":{"S":"%s"},"appliedBy":{"S":"setup.sh"}}},' \
				"$m_enabled" "$m_mode" "$m_collect" "$m_upload" "$m_retain" \
				"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)")
		else
			warn "could not parse tte-metrics-ctl status -- inst#${INSTANCE_ID} will have no metricsConfig, so the UI shows it as unconfigured and a rebuild won't restore these settings"
		fi
	fi

	local item
	item=$(cat <<-EOF
		{
			"uid": {"S": "inst#${INSTANCE_ID}"},
			"validRoots": {"M": ${roots_json}},
			"worldPaths": {"L": ${worldpaths_json}},
			${metrics_json}
			"updatedAt": {"S": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"}
		}
	EOF
	)

	aws dynamodb put-item --table-name "$INSTANCE_TABLE" --item "$item" \
		|| die "failed to write inst#${INSTANCE_ID} to $INSTANCE_TABLE"

	ok "inst#${INSTANCE_ID} seeded with validRoots=[${VALID_ROOTS}] worldPaths=[${WORLD_PATH_NICKNAMES}]"
}

step_summary() {
	log "summary"

	echo
	echo "  instance    $INSTANCE_ID"
	echo "  root        $ROOT"
	echo "  tshock      $(ls "$ROOT/tshock/TShock.Server" >/dev/null 2>&1 && echo present || echo MISSING)"
	echo "  dotnet      $(dotnet --list-runtimes 2>/dev/null | grep -c "Microsoft.NETCore.App ${DOTNET_MAJOR}\.") runtime(s)"
	echo "  rest        ${REST_USER}@:${REST_PORT}"
	echo "  metrics     $(systemctl is-active tte-metrics-collect.timer 2>/dev/null || echo inactive)"
	echo "  ssm         $(systemctl is-active snap.amazon-ssm-agent.amazon-ssm-agent.service 2>/dev/null || systemctl is-active amazon-ssm-agent 2>/dev/null || echo inactive)"
	echo "  inst# row   $([ -n "$INSTANCE_TABLE" ] && echo "seeded/checked in $INSTANCE_TABLE" || echo "SKIPPED (TTE_INSTANCE_TABLE unset)")"
	echo
	echo "  Still to do BY HAND, from your own machine (never from this box --"
	echo "  see README 'Registering the instance' for why):"
	echo
	echo "    1) confirm TSHOCK_PASSWORD in Secrets Manager matches what was set here"
	echo
	echo "    2) add $INSTANCE_ID to EC2_INSTANCE_IDS on ttesm-instance-manager:"
	echo
	echo "         aws lambda get-function-configuration --function-name ttesm-instance-manager \\"
	echo "           --query 'Environment.Variables' --output json > env.json"
	echo
	echo "       Edit env.json by hand: find EC2_INSTANCE_IDS and append ',$INSTANCE_ID'"
	echo "       to its existing value (skip if already present). Do not touch any"
	echo "       other key -- update-function-configuration REPLACES the whole map,"
	echo "       so anything dropped from env.json is gone from \$LATEST. Then:"
	echo
	echo "         aws lambda update-function-configuration --function-name ttesm-instance-manager \\"
	echo "           --environment \"Variables=\$(cat env.json)\""
	echo
	echo "       This only updates \$LATEST -- it won't reach the live stage/prod"
	echo "       alias until the next push to stage/main publishes a new version,"
	echo "       unless you also run publish-version + update-alias yourself."
	echo
}

# --- run ----------------------------------------------------------------------

step_preflight

for step in "${STEPS[@]}"; do
	if should_run "$step"; then
		"step_$step"
	fi
done

log "done"
