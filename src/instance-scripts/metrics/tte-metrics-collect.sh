#!/bin/bash
#
# Samples CPU and memory utilization from /proc and appends one JSON line to the
# current hour's local buffer. Deliberately dependency-free (bash + awk, no AWS
# calls, no network) so a run costs single-digit milliseconds and a few hundred
# KB of transient RSS -- this replaces the CloudWatch agent, so it must not cost
# more than the metrics are worth.
#
# This is the hot path: it runs every 15-60s forever, where the uploader runs
# every few minutes at most. It is therefore written to fork exactly ONCE (the
# awk below) on the common path. bash rather than sh specifically for printf's
# %(...)T, which formats the current time as a builtin and removes what would
# otherwise be a date(1) fork on every single sample.
#
# Output line: {"t":<epoch_s>,"cpu":<pct>,"mem":<pct>,"memMb":<used_mb>}
#
set -eu

DIR=${TTE_METRICS_DIR:-/var/lib/tte-metrics}
STATE="$DIR/.cpu"

# The buffer mirrors the S3 key layout (YYYY/MM/DD/HH.jsonl) rather than using a
# flat YYYY-MM-DDTHH name, so a local path maps to its S3 key by stripping the
# buffer root -- see tte-metrics-upload.sh.
printf -v ts '%(%s)T' -1
printf -v hour '%(%Y/%m/%d/%H)T' -1
file="$DIR/$hour.jsonl"

# Builtin test first so the mkdir only forks on the hour rollover, not on every
# single sample.
dir=${file%/*}
[[ -d $dir ]] || mkdir -p "$dir"

# /proc/stat's cpu line is cumulative jiffies since boot, so a utilization
# percentage only exists as a delta against the previous sample. `read` is a
# builtin, so loading that state costs no fork.
if [[ -f $STATE ]]; then
	read -r prev_idle prev_total < "$STATE"
else
	# Sentinel for "no previous sample" -- awk skips emitting rather than
	# reporting a meaningless 0%.
	prev_idle=-1
	prev_total=-1
fi

# One awk does the whole job: parses both /proc files, writes the new delta
# state, and appends the finished JSON line. This was previously two awk forks
# plus shell arithmetic; int() truncates exactly as the shell integer division
# did, so the emitted numbers are unchanged.
#
# Redirections are written as printf(...) > file rather than printf ... > file:
# without the parentheses awk can read the > as a comparison operator against
# the last argument instead of as a redirection.
awk -v ts="$ts" -v pi="$prev_idle" -v pt="$prev_total" -v state="$STATE" -v out="$file" '
	# Idle time is idle + iowait ($5 + $6); everything from $2 on is total time.
	# The trailing space in /^cpu / matches only the aggregate line, not cpu0/cpu1.
	/^cpu / { idle = $5 + $6; for (i = 2; i <= NF; i++) total += $i; next }

	# MemAvailable is the kernel estimate of what is actually obtainable without
	# swapping, which is what "used" should mean here. MemFree alone would count
	# reclaimable page cache as used and read as ~100% at all times.
	/^MemTotal:/     { mem_total = $2 }
	/^MemAvailable:/ { mem_avail = $2 }

	END {
		# Written unconditionally, including on the samples skipped below: the
		# next run still needs this run of counters to diff against, or one skip
		# would cascade into skipping forever.
		printf("%d %d\n", idle, total) > state
		close(state)

		# First sample after boot -- nothing to diff against yet.
		if (pt + 0 < 0) exit 0

		d_total = total - pt
		d_idle  = idle - pi

		# The state file lives on the EBS root volume and so survives the
		# auto-shutoff stop/start cycle, but /proc/stat resets on boot. A
		# non-positive delta means this sample straddles a reboot; skip it
		# instead of emitting a wildly wrong number.
		if (d_total <= 0 || d_idle < 0) exit 0
		if (mem_total <= 0) exit 0

		cpu = int(100 * (d_total - d_idle) / d_total)
		used_kb = mem_total - mem_avail

		printf("{\"t\":%d,\"cpu\":%d,\"mem\":%d,\"memMb\":%d}\n",
			ts, cpu, int(100 * used_kb / mem_total), int(used_kb / 1024)) >> out
	}
' /proc/stat /proc/meminfo
