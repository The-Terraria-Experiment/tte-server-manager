#!/bin/sh
#
# Pushes the local metric buffer to S3 and prunes old local files. May run on a
# timer, on shutdown via tte-metrics-flush, or on demand from the web UI (which
# reaches it through `tte-metrics-ctl upload`).
#
# The whole buffer goes up in ONE `aws s3 sync`, not one `aws s3 cp` per hour.
# The AWS CLI is Python: every invocation costs the better part of a second of
# CPU and ~100MB RSS, which on a single-core instance is the single most
# expensive thing this collector does. With manual-trigger uploads the backlog
# can be arbitrarily many hours, so per-file `cp` would scale that cost with the
# gap between triggers. One sync is flat regardless of backlog.
#
# This is why the local buffer mirrors the S3 key layout exactly -- sync can
# only preserve a layout it already has:
#
#   $DIR/YYYY/MM/DD/HH.jsonl  ->  s3://$BUCKET/$PREFIX/$INSTANCE_ID/YYYY/MM/DD/HH.jsonl
#
set -eu

DIR=${TTE_METRICS_DIR:-/var/lib/tte-metrics}
BUCKET=${TTE_METRICS_BUCKET:-}
PREFIX=${TTE_METRICS_PREFIX:-metrics}
RETAIN_DAYS=${TTE_METRICS_RETAIN_DAYS:-2}

if [ -z "$BUCKET" ]; then
	echo "TTE_METRICS_BUCKET is not set (expected in /etc/tte-metrics.env)" >&2
	exit 1
fi

mkdir -p "$DIR"

# IMDS is local and free, but the instance ID never changes for the life of the
# box, so cache it and skip the round trip on every run.
IID_CACHE="$DIR/.instance-id"
if [ -s "$IID_CACHE" ]; then
	read -r IID < "$IID_CACHE"
else
	TOKEN=$(curl -sf -m 2 -X PUT http://169.254.169.254/latest/api/token \
		-H "X-aws-ec2-metadata-token-ttl-seconds: 60") || TOKEN=""
	IID=$(curl -sf -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" \
		http://169.254.169.254/latest/meta-data/instance-id) || IID=""
	if [ -z "$IID" ]; then
		echo "could not resolve instance id from IMDS" >&2
		exit 1
	fi
	printf '%s\n' "$IID" > "$IID_CACHE"
fi

# --exclude/--include are load-bearing, not decoration: the buffer dir also holds
# the .cpu delta state and the .instance-id cache, and neither belongs in S3.
#
# Completed hours are immutable, so sync skips them after their first upload;
# only the current hour is re-sent each run, which is the same write pattern as
# before. The object count stays one per instance-hour.
aws s3 sync "$DIR" "s3://$BUCKET/$PREFIX/$IID/" \
	--exclude "*" --include "*.jsonl" \
	--only-show-errors

# Everything below only runs on a successful sync -- `set -e` aborts the script
# on a non-zero aws exit. That ordering is the whole safety property: under
# manual-trigger uploads a buffer file can be days old and still be the only
# copy of that data, so pruning by mtime alone (as this used to do) would
# silently delete metrics that had never reached S3. Reaching this line means
# every .jsonl present is in S3.
find "$DIR" -name '*.jsonl' -mtime "+$RETAIN_DAYS" -delete 2>/dev/null || true

# The dated directories are cheap but unbounded; drop the ones the prune above
# emptied out so the tree doesn't accumulate a folder per day forever.
find "$DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
