#!/bin/sh
#
# Control surface for the TTE metrics collector. Installed to
# /usr/local/bin/tte-metrics-ctl and driven over SSM by the instance-manager
# lambda (see _shared/shared/utils/InstanceMetrics.ts), which is how the web UI
# turns collection on/off, retunes the timers, and forces an upload.
#
# Usage:
#   tte-metrics-ctl status
#   tte-metrics-ctl apply [--enabled=true|false] [--upload-mode=timer|manual]
#                         [--collect=<sec>] [--upload=<sec>] [--retain=<days>]
#   tte-metrics-ctl upload
#
# `apply` takes the whole desired state and is idempotent -- omitted flags keep
# their current value, so flipping the collector off doesn't discard a tuned
# interval. One invocation means one daemon-reload no matter how much changed.
#
# Turning the collector OFF only touches systemd enablement. Nothing is deleted:
# the units, scripts, and buffered data all stay put, and `apply --enabled=true`
# brings it back exactly as it was. That's the entire point of this script
# existing rather than an uninstall path.
#
set -eu

ENV_FILE=${TTE_METRICS_ENV_FILE:-/etc/tte-metrics.env}
UNIT_DIR=${TTE_METRICS_UNIT_DIR:-/etc/systemd/system}

COLLECT_TIMER=tte-metrics-collect.timer
UPLOAD_TIMER=tte-metrics-upload.timer
UPLOAD_SERVICE=tte-metrics-upload.service
FLUSH_SERVICE=tte-metrics-flush.service

# Mirrored by METRICS_BOUNDS in _shared/shared/utils/InstanceMetrics.ts, which
# rejects out-of-range values before they ever reach SSM. Enforced here too so a
# hand-run command can't install a 1-second timer.
COLLECT_MIN=15;  COLLECT_MAX=3600
UPLOAD_MIN=60;   UPLOAD_MAX=3600
RETAIN_MIN=1;    RETAIN_MAX=30

die() { echo "tte-metrics-ctl: $*" >&2; exit 1; }

require_root() {
	[ "$(id -u)" -eq 0 ] || die "must run as root"
}

# --- config file --------------------------------------------------------------

# Defaults match the shipped unit files, so a box that predates a given setting
# reads back the value it is actually running.
load_config() {
	CFG_BUCKET=""
	CFG_PREFIX="metrics"
	CFG_DIR="/var/lib/tte-metrics"
	CFG_COLLECT=60
	CFG_UPLOAD=300
	CFG_UPLOAD_MODE="timer"
	CFG_RETAIN=2

	if [ -f "$ENV_FILE" ]; then
		# Root-owned and root-written; sourcing is safe and saves a parse loop.
		. "$ENV_FILE"
		CFG_BUCKET=${TTE_METRICS_BUCKET:-$CFG_BUCKET}
		CFG_PREFIX=${TTE_METRICS_PREFIX:-$CFG_PREFIX}
		CFG_DIR=${TTE_METRICS_DIR:-$CFG_DIR}
		CFG_COLLECT=${TTE_METRICS_COLLECT_SEC:-$CFG_COLLECT}
		CFG_UPLOAD=${TTE_METRICS_UPLOAD_SEC:-$CFG_UPLOAD}
		CFG_UPLOAD_MODE=${TTE_METRICS_UPLOAD_MODE:-$CFG_UPLOAD_MODE}
		CFG_RETAIN=${TTE_METRICS_RETAIN_DAYS:-$CFG_RETAIN}
	fi
}

save_config() {
	[ -n "$CFG_BUCKET" ] || die "TTE_METRICS_BUCKET missing from $ENV_FILE -- run install.sh first"

	cat > "$ENV_FILE" <<EOF
TTE_METRICS_BUCKET=$CFG_BUCKET
TTE_METRICS_PREFIX=$CFG_PREFIX
TTE_METRICS_DIR=$CFG_DIR
TTE_METRICS_COLLECT_SEC=$CFG_COLLECT
TTE_METRICS_UPLOAD_SEC=$CFG_UPLOAD
TTE_METRICS_UPLOAD_MODE=$CFG_UPLOAD_MODE
TTE_METRICS_RETAIN_DAYS=$CFG_RETAIN
EOF
	chmod 0644 "$ENV_FILE"
}

# --- validation ---------------------------------------------------------------

check_int_range() {
	name=$1; value=$2; min=$3; max=$4

	case "$value" in
		''|*[!0-9]*) die "$name must be a whole number, got '$value'" ;;
	esac
	if [ "$value" -lt "$min" ] || [ "$value" -gt "$max" ]; then
		die "$name must be between $min and $max, got $value"
	fi
}

check_bool() {
	case "$2" in
		true|false) ;;
		*) die "$1 must be true or false, got '$2'" ;;
	esac
}

# --- systemd ------------------------------------------------------------------

# is-enabled exits 1 for a disabled unit and is-active exits 3 for an inactive
# one. Under `set -e` an unguarded call would abort the script, so "metrics is
# off" would surface to the lambda as a failed SSM command rather than as state.
unit_enabled() { systemctl is-enabled "$1" 2>/dev/null || echo missing; }
unit_active()  { systemctl is-active  "$1" 2>/dev/null || echo inactive; }

# `OnUnitActiveSec` is a LIST in systemd, so a drop-in that just sets it ADDS a
# second trigger instead of replacing the shipped one -- the timer would then
# fire at both the old and new interval. The empty assignment resets the list
# first; that idiom is required, not stylistic.
#
# AccuracySec scales with the interval rather than staying at the shipped
# constant: systemd coalesces timer wakeups within that window, so a loose
# accuracy on a slow timer lets the kernel batch it with other work instead of
# forcing a dedicated wakeup. On a single-core box that is a real saving.
write_timer_dropin() {
	unit=$1; interval=$2

	accuracy=$((interval / 10))
	if [ "$accuracy" -lt 1 ]; then accuracy=1; fi
	if [ "$accuracy" -gt 60 ]; then accuracy=60; fi

	dropin_dir="$UNIT_DIR/$unit.d"
	mkdir -p "$dropin_dir"
	cat > "$dropin_dir/override.conf" <<EOF
# Managed by tte-metrics-ctl -- hand edits are overwritten on the next apply.
[Timer]
OnUnitActiveSec=
OnUnitActiveSec=$interval
AccuracySec=${accuracy}s
EOF
	chmod 0644 "$dropin_dir/override.conf"
}

# --- commands -----------------------------------------------------------------

cmd_status() {
	load_config

	collect_enabled=$(unit_enabled "$COLLECT_TIMER")
	collect_active=$(unit_active "$COLLECT_TIMER")
	upload_enabled=$(unit_enabled "$UPLOAD_TIMER")
	flush_enabled=$(unit_enabled "$FLUSH_SERVICE")

	if [ -f "$UNIT_DIR/$COLLECT_TIMER" ]; then installed=true; else installed=false; fi
	if [ "$collect_enabled" = "enabled" ]; then enabled=true; else enabled=false; fi
	if [ "$collect_active" = "active" ]; then active=true; else active=false; fi

	# Derived from systemd rather than the env file: the timer's own enablement
	# is what actually decides whether uploads happen on a schedule, so it can't
	# drift out of sync the way a recorded value could.
	#
	# Except when collection is off -- turning the collector off disables the
	# upload timer too, so its state then says nothing about which mode is
	# configured. Reading it anyway would report every disabled collector as
	# having switched to manual, and the UI would show permanent false drift.
	if [ "$enabled" = "true" ]; then
		if [ "$upload_enabled" = "enabled" ]; then mode=timer; else mode=manual; fi
	else
		mode=$CFG_UPLOAD_MODE
	fi

	pending=$(find "$CFG_DIR" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')

	last_raw=$(systemctl show "$UPLOAD_SERVICE" -p ExecMainExitTimestamp --value 2>/dev/null || echo "")
	if [ -n "$last_raw" ]; then
		last=$(date -d "$last_raw" +%s 2>/dev/null || echo 0)
	else
		last=0
	fi

	printf '{"installed":%s,"enabled":%s,"active":%s,"uploadMode":"%s","collectSec":%s,"uploadSec":%s,"retainDays":%s,"pendingFiles":%s,"lastUploadAt":%s,"flushEnabled":%s}\n' \
		"$installed" "$enabled" "$active" "$mode" \
		"$CFG_COLLECT" "$CFG_UPLOAD" "$CFG_RETAIN" \
		"$pending" "$last" \
		"$([ "$flush_enabled" = "enabled" ] && echo true || echo false)"
}

cmd_apply() {
	require_root
	load_config

	want_enabled=""
	want_mode=""
	want_collect=""
	want_upload=""
	want_retain=""

	for arg in "$@"; do
		case "$arg" in
			--enabled=*)     want_enabled=${arg#*=} ;;
			--upload-mode=*) want_mode=${arg#*=} ;;
			--collect=*)     want_collect=${arg#*=} ;;
			--upload=*)      want_upload=${arg#*=} ;;
			--retain=*)      want_retain=${arg#*=} ;;
			*) die "unknown argument: $arg" ;;
		esac
	done

	# Anything omitted keeps its current value.
	if [ -z "$want_collect" ]; then want_collect=$CFG_COLLECT; fi
	if [ -z "$want_upload" ]; then want_upload=$CFG_UPLOAD; fi
	if [ -z "$want_retain" ]; then want_retain=$CFG_RETAIN; fi
	if [ -z "$want_mode" ]; then want_mode=$CFG_UPLOAD_MODE; fi
	if [ -z "$want_enabled" ]; then
		if [ "$(unit_enabled "$COLLECT_TIMER")" = "enabled" ]; then want_enabled=true; else want_enabled=false; fi
	fi

	check_bool "--enabled" "$want_enabled"
	check_int_range "--collect" "$want_collect" "$COLLECT_MIN" "$COLLECT_MAX"
	check_int_range "--upload" "$want_upload" "$UPLOAD_MIN" "$UPLOAD_MAX"
	check_int_range "--retain" "$want_retain" "$RETAIN_MIN" "$RETAIN_MAX"
	case "$want_mode" in
		timer|manual) ;;
		*) die "--upload-mode must be timer or manual, got '$want_mode'" ;;
	esac

	CFG_COLLECT=$want_collect
	CFG_UPLOAD=$want_upload
	CFG_UPLOAD_MODE=$want_mode
	CFG_RETAIN=$want_retain
	save_config

	write_timer_dropin "$COLLECT_TIMER" "$CFG_COLLECT"
	write_timer_dropin "$UPLOAD_TIMER" "$CFG_UPLOAD"

	systemctl daemon-reload

	if [ "$want_enabled" = "true" ]; then
		# restart rather than `enable --now`: an already-running timer keeps its
		# old interval until it is restarted, so a retune would otherwise not
		# take effect until the next reboot.
		systemctl enable "$COLLECT_TIMER" >/dev/null 2>&1 || true
		systemctl restart "$COLLECT_TIMER"

		if [ "$CFG_UPLOAD_MODE" = "timer" ]; then
			systemctl enable "$UPLOAD_TIMER" >/dev/null 2>&1 || true
			systemctl restart "$UPLOAD_TIMER"
		else
			systemctl disable --now "$UPLOAD_TIMER" >/dev/null 2>&1 || true
		fi

		# In manual mode this unit is the only thing standing between a stop and
		# losing everything buffered since the last trigger, so it is enabled
		# regardless of upload mode. Started, not just enabled, because its whole
		# job is the ExecStop -- which only fires if the unit is currently active.
		systemctl enable "$FLUSH_SERVICE" >/dev/null 2>&1 || true
		systemctl start "$FLUSH_SERVICE"
	else
		systemctl disable --now "$COLLECT_TIMER" >/dev/null 2>&1 || true
		systemctl disable --now "$UPLOAD_TIMER" >/dev/null 2>&1 || true

		# Stopped last, and deliberately: stopping runs the unit's ExecStop, which
		# drains whatever is still buffered. Turning collection off therefore ends
		# with the local data safe in S3 rather than stranded on the volume.
		systemctl disable "$FLUSH_SERVICE" >/dev/null 2>&1 || true
		systemctl stop "$FLUSH_SERVICE" >/dev/null 2>&1 || true
	fi

	cmd_status
}

cmd_upload() {
	require_root

	# Routed through systemd instead of exec'ing the uploader directly: the unit
	# carries the Nice/idle scheduling and the filesystem sandboxing. SSM would
	# otherwise run this as unrestricted root at normal priority -- exactly the
	# CPU spike the manual-upload mode exists to avoid.
	systemctl start --wait "$UPLOAD_SERVICE"
	cmd_status
}

case "${1:-}" in
	status) cmd_status ;;
	apply)  shift; cmd_apply "$@" ;;
	upload) cmd_upload ;;
	*) die "usage: tte-metrics-ctl {status|apply [--flags]|upload}" ;;
esac
