#!/bin/sh
#
# Pushes the local metric buffer to S3 and prunes old local files. Runs on a
# timer (every few minutes) and once more on shutdown via tte-metrics-flush.
#
# Each hour is a single object that gets overwritten in place rather than an
# append-only stream of small objects: it keeps the object count trivial and
# makes the read side a plain prefix list.
#
# Key layout: s3://$BUCKET/$PREFIX/$INSTANCE_ID/YYYY/MM/DD/HH.jsonl
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

# Upload the current hour AND the previous one. The previous hour keeps taking
# samples between its final scheduled upload and the rollover, so a
# current-hour-only push would silently drop up to one upload interval's worth
# of data every single hour.
now=$(date -u +%s)
for offset in 0 3600; do
	at=$((now - offset))
	stamp=$(date -u -d "@$at" +%Y-%m-%dT%H)
	src="$DIR/$stamp.jsonl"
	[ -f "$src" ] || continue

	key="$PREFIX/$IID/$(date -u -d "@$at" +%Y/%m/%d)/$(date -u -d "@$at" +%H).jsonl"
	aws s3 cp "$src" "s3://$BUCKET/$key" --only-show-errors
done

# S3 is the durable copy; the local buffer only needs to cover the gap between
# uploads plus enough slack to debug a failed push.
find "$DIR" -maxdepth 1 -name '*.jsonl' -mtime "+$RETAIN_DAYS" -delete 2>/dev/null || true
