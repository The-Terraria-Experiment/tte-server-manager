# Instance metrics collector

Homebrew replacement for the CloudWatch agent's custom metrics. Samples **CPU and
memory only** — the free built-in EC2 metrics (CPU, network, disk I/O, status
checks) are still there and still free, and anything beyond CPU/mem is expected
to be re-added to CloudWatch on demand if a real question ever comes up.

## Why

CloudWatch custom metrics bill per series per month, plus per `PutMetricData`
call and per metric scanned on every dashboard load. A default agent config
emits 30–50 series per instance, which is real money for a Terraria box that's
idle-stopped most of the time. This does the same job for cents.

## How it works

| Piece | What it does |
| --- | --- |
| `tte-metrics-collect.sh` | Reads `/proc/stat` + `/proc/meminfo`, appends one JSON line to `/var/lib/tte-metrics/<YYYY-MM-DDTHH>.jsonl`. No network, no AWS calls. |
| `tte-metrics-upload.sh` | `aws s3 cp` of the current + previous hour's buffer file to S3, then prunes local files older than 2 days. |
| `systemd/*.timer` | Collect every 60s, upload every 5 min. |
| `systemd/tte-metrics-flush.service` | Runs the uploader once on shutdown, so the last few minutes survive auto-shutoff. |

Data lands in the existing logs bucket (`S3_LOGS_BUCKET_NAME`) under its own
prefix, alongside `tshock-console/`:

```
s3://<logs-bucket>/metrics/<instance-id>/YYYY/MM/DD/HH.jsonl
```

Each hour is one object, overwritten in place on each upload rather than
appended as many small objects — the object count stays trivial and the read
side is a plain prefix list.

Line format:

```json
{"t":1752835200,"cpu":12,"mem":41,"memMb":1673}
```

`cpu` and `mem` are integer percent; `memMb` is used MiB. `mem` is derived from
`MemAvailable`, not `MemFree`, so reclaimable page cache doesn't read as used.

## Install

Requires the instance role to allow `s3:PutObject` on
`arn:aws:s3:::<logs-bucket>/metrics/*`. The instance already writes TShock
console logs to this bucket, so this may just be a prefix widening rather than a
new statement — check the existing policy before adding one.

Stage the `metrics/` directory on the box, then:

```bash
sudo TTE_METRICS_BUCKET=<logs-bucket-name> ./install.sh
```

The installer is idempotent; re-run it to pick up script changes.

## Verify

```bash
systemctl list-timers 'tte-metrics-*'
tail -f /var/lib/tte-metrics/$(date -u +%Y-%m-%dT%H).jsonl
journalctl -u tte-metrics-upload -n 50
aws s3 ls "s3://<logs-bucket>/metrics/$(ec2-metadata -i | cut -d' ' -f2)/" --recursive
```

The very first sample after boot is skipped by design — `/proc/stat` counters
are cumulative, so CPU% needs a previous sample to diff against, and reporting
`0` would be a lie rather than a gap.

## Cost

~2 PUTs per 5 min ≈ 17k/month ≈ **$0.09/instance/month**, plus negligible
storage (~130KB/day/instance at 60s sampling). Set an S3 lifecycle rule on the
`metrics/` prefix to expire objects after 30–90 days.

## Trade-off you're accepting

No CloudWatch Alarms on these numbers. Nothing watches them and nothing pages
you. If an alarm on CPU or memory is ever actually load-bearing, put *that one
metric* back on CloudWatch — a single series is pennies — rather than trying to
build alerting here.
