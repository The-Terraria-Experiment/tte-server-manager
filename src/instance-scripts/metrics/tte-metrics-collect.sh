#!/bin/sh
#
# Samples CPU and memory utilization from /proc and appends one JSON line to the
# current hour's local buffer. Deliberately dependency-free (POSIX sh + awk, no
# AWS calls, no network) so a run costs single-digit milliseconds and a few
# hundred KB of transient RSS -- this replaces the CloudWatch agent, so it must
# not cost more than the metrics are worth.
#
# Output line: {"t":<epoch_s>,"cpu":<pct>,"mem":<pct>,"memMb":<used_mb>}
#
set -eu

DIR=${TTE_METRICS_DIR:-/var/lib/tte-metrics}
STATE="$DIR/.cpu"

mkdir -p "$DIR"

# One date(1) fork for both the timestamp and the buffer path. The buffer
# mirrors the S3 key layout (YYYY/MM/DD/HH.jsonl) rather than using a flat
# YYYY-MM-DDTHH name, so the uploader can push the whole tree with a single
# `aws s3 sync` instead of one `aws s3 cp` per hour -- see tte-metrics-upload.sh.
set -- $(date -u '+%s %Y/%m/%d/%H')
ts=$1
file="$DIR/$2.jsonl"

# Builtin test first so the mkdir only forks on the hour rollover, not on every
# single sample.
dir=${file%/*}
[ -d "$dir" ] || mkdir -p "$dir"

# /proc/stat's cpu line is cumulative jiffies since boot, so a utilization
# percentage only exists as a delta against the previous sample. Idle time is
# idle + iowait ($5 + $6); everything from $2 on is total time.
set -- $(awk '/^cpu /{idle=$5+$6; for (i=2; i<=NF; i++) total+=$i; print idle, total; exit}' /proc/stat)
idle=$1
total=$2

# No previous sample (first run after boot) -- seed the state and emit nothing
# rather than reporting a meaningless 0%.
if [ ! -f "$STATE" ]; then
	printf '%s %s\n' "$idle" "$total" > "$STATE"
	exit 0
fi

read -r prev_idle prev_total < "$STATE"
printf '%s %s\n' "$idle" "$total" > "$STATE"

d_total=$((total - prev_total))
d_idle=$((idle - prev_idle))

# The state file lives on the EBS root volume and so survives the auto-shutoff
# stop/start cycle, but /proc/stat's counters reset on boot. A non-positive
# delta means this sample straddles a reboot; skip it instead of emitting a
# wildly wrong number.
if [ "$d_total" -le 0 ] || [ "$d_idle" -lt 0 ]; then
	exit 0
fi

cpu=$(( (100 * (d_total - d_idle)) / d_total ))

# MemAvailable is the kernel's own estimate of what's actually obtainable
# without swapping, which is what "used" should mean here -- MemFree alone
# would count reclaimable page cache as used and read as ~100% at all times.
set -- $(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t, a}' /proc/meminfo)
mem_total_kb=$1
mem_avail_kb=$2

if [ "$mem_total_kb" -le 0 ]; then
	exit 0
fi

mem_used_kb=$((mem_total_kb - mem_avail_kb))
mem=$(( (100 * mem_used_kb) / mem_total_kb ))
mem_used_mb=$((mem_used_kb / 1024))

printf '{"t":%s,"cpu":%s,"mem":%s,"memMb":%s}\n' "$ts" "$cpu" "$mem" "$mem_used_mb" >> "$file"
