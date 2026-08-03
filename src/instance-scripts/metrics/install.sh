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
set -euo pipefail

BUCKET=${TTE_METRICS_BUCKET:-}
PREFIX=${TTE_METRICS_PREFIX:-metrics}
DIR=${TTE_METRICS_DIR:-/var/lib/tte-metrics}
RUN_AS=${TTE_METRICS_USER:-ubuntu}

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

install -d -o "$RUN_AS" -g "$RUN_AS" -m 0755 "$DIR"

# Written rather than checked in so the bucket name stays out of the repo, and
# so the units have a single source for their config.
cat > /etc/tte-metrics.env <<EOF
TTE_METRICS_BUCKET=$BUCKET
TTE_METRICS_PREFIX=$PREFIX
TTE_METRICS_DIR=$DIR
EOF
chmod 0644 /etc/tte-metrics.env

for unit in tte-metrics-collect.service tte-metrics-collect.timer \
	tte-metrics-upload.service tte-metrics-upload.timer \
	tte-metrics-flush.service; do
	install -m 0644 "$here/systemd/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now tte-metrics-collect.timer
systemctl enable --now tte-metrics-upload.timer
# Enabled but not started by hand: its whole job is the ExecStop, which only
# fires if the unit is active, and enabling starts it on the next boot.
systemctl enable tte-metrics-flush.service
systemctl start tte-metrics-flush.service

echo "installed. buffer: $DIR  bucket: s3://$BUCKET/$PREFIX/"
systemctl list-timers 'tte-metrics-*' --no-pager || true
