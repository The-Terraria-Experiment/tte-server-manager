#!/bin/bash
#
# Installs the TTE metrics collector on an EC2 instance. Idempotent -- safe to
# re-run to pick up script changes.
#
# Run via SSM Run Command (AWS-RunShellScript) with the repo contents staged on
# the box, or paste the whole metrics/ directory somewhere and run this from
# inside it. Requires root; the units themselves run as ubuntu.
#
# Usage:
#   sudo TTE_METRICS_BUCKET=<logs-bucket-name> ./install.sh
#
# Tunables (collect/upload interval, upload mode, retention) can be seeded here,
# but the web UI owns them afterwards via tte-metrics-ctl. Re-running this
# installer preserves whatever is already configured -- see load_existing below.
#
set -euo pipefail

ENV_FILE=/etc/tte-metrics.env

RUN_AS=${TTE_METRICS_USER:-ubuntu}

# Precedence is: what the caller passed > what the box is already running >
# defaults. Sourcing assigns unconditionally, so the caller's values have to be
# captured BEFORE the env file is read or the file would silently win.
ARG_BUCKET=${TTE_METRICS_BUCKET:-}
ARG_PREFIX=${TTE_METRICS_PREFIX:-}
ARG_DIR=${TTE_METRICS_DIR:-}
ARG_COLLECT_SEC=${TTE_METRICS_COLLECT_SEC:-}
ARG_UPLOAD_SEC=${TTE_METRICS_UPLOAD_SEC:-}
ARG_UPLOAD_MODE=${TTE_METRICS_UPLOAD_MODE:-}
ARG_RETAIN_DAYS=${TTE_METRICS_RETAIN_DAYS:-}
ARG_ENABLED=${TTE_METRICS_ENABLED:-}

# Re-running the installer to pick up script changes must not silently reset a
# tuned instance back to defaults, so existing config is the fallback for every
# value the caller didn't explicitly override.
if [ -f "$ENV_FILE" ]; then
	FRESH_INSTALL=0
	# shellcheck disable=SC1090
	. "$ENV_FILE"
else
	FRESH_INSTALL=1
fi

BUCKET=${ARG_BUCKET:-${TTE_METRICS_BUCKET:-}}
PREFIX=${ARG_PREFIX:-${TTE_METRICS_PREFIX:-metrics}}
DIR=${ARG_DIR:-${TTE_METRICS_DIR:-/var/lib/tte-metrics}}

COLLECT_SEC=${ARG_COLLECT_SEC:-${TTE_METRICS_COLLECT_SEC:-60}}
UPLOAD_SEC=${ARG_UPLOAD_SEC:-${TTE_METRICS_UPLOAD_SEC:-300}}
UPLOAD_MODE=${ARG_UPLOAD_MODE:-${TTE_METRICS_UPLOAD_MODE:-timer}}
RETAIN_DAYS=${ARG_RETAIN_DAYS:-${TTE_METRICS_RETAIN_DAYS:-2}}

# Enablement is the one value NOT inherited from the env file -- it lives in
# systemd, not here. Left empty, tte-metrics-ctl keeps whatever the timer is
# currently set to, which is what a re-run to pick up script changes should do.
# A first install has no such state to preserve and defaults to on.
ENABLED=${ARG_ENABLED:-}
if [ -z "$ENABLED" ] && [ "$FRESH_INSTALL" -eq 1 ]; then
	ENABLED=true
fi

if [ -z "$BUCKET" ]; then
	echo "TTE_METRICS_BUCKET must be set to the logs bucket name" >&2
	exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
	echo "must run as root" >&2
	exit 1
fi

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

install -m 0755 "$here/tte-metrics-collect.sh" /usr/local/bin/tte-metrics-collect
install -m 0755 "$here/tte-metrics-upload.sh" /usr/local/bin/tte-metrics-upload
install -m 0755 "$here/tte-metrics-ctl.sh" /usr/local/bin/tte-metrics-ctl

install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$DIR"

# Written rather than checked in so the bucket name stays out of the repo, and
# so the units have a single source for their config. Only the values
# tte-metrics-ctl does not own are written here; it rewrites this file wholesale
# on every apply, filling in the tunables.
cat > "$ENV_FILE" <<EOF
TTE_METRICS_BUCKET=$BUCKET
TTE_METRICS_PREFIX=$PREFIX
TTE_METRICS_DIR=$DIR
EOF
chmod 0644 "$ENV_FILE"

for unit in tte-metrics-collect.service tte-metrics-collect.timer \
	tte-metrics-upload.service tte-metrics-upload.timer \
	tte-metrics-flush.service; do
	install -m 0644 "$here/systemd/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload

# Enablement, timer intervals and retention are all tte-metrics-ctl's job -- the
# installer deliberately does not duplicate that logic, so there is exactly one
# implementation of "what does 'on' mean" for the UI and the installer to share.
apply_args=(
	--upload-mode="$UPLOAD_MODE"
	--collect="$COLLECT_SEC"
	--upload="$UPLOAD_SEC"
	--retain="$RETAIN_DAYS"
)
if [ -n "$ENABLED" ]; then
	apply_args+=(--enabled="$ENABLED")
fi

/usr/local/bin/tte-metrics-ctl apply "${apply_args[@]}" >/dev/null

echo "installed. buffer: $DIR  bucket: s3://$BUCKET/$PREFIX/"
echo "config: $(/usr/local/bin/tte-metrics-ctl status)"
systemctl list-timers 'tte-metrics-*' --no-pager || true
