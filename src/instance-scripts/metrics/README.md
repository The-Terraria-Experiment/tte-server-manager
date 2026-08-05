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
| `tte-metrics-collect.sh` | Reads `/proc/stat` + `/proc/meminfo`, appends one JSON line to `/var/lib/tte-metrics/YYYY/MM/DD/HH.jsonl`. No network, no AWS calls. |
| `tte-metrics-upload.sh` | One `aws s3 sync` of the whole buffer tree to S3, then prunes local files. |
| `tte-metrics-ctl.sh` | Control surface: `status`, `apply`, `upload`. What the web UI drives over SSM. |
| `systemd/*.timer` | Collect and upload on configurable intervals. |
| `systemd/tte-metrics-flush.service` | Runs the uploader once on shutdown, so the last few minutes survive auto-shutoff. |

Data lands in the existing logs bucket (`S3_LOGS_BUCKET_NAME`) under its own
prefix, alongside `tshock-console/`:

```
s3://<logs-bucket>/metrics/<instance-id>/YYYY/MM/DD/HH.jsonl
```

The local buffer mirrors that key layout exactly. That's what lets the uploader
push everything in a single `aws s3 sync` instead of one `aws s3 cp` per hour —
see "Cost of an upload" below. Each hour is one object, overwritten in place as
it fills rather than appended as many small objects, so the object count stays
trivial and the read side is a plain prefix list.

Line format:

```json
{"t":1752835200,"cpu":12,"mem":41,"memMb":1673}
```

`cpu` and `mem` are integer percent; `memMb` is used MiB. `mem` is derived from
`MemAvailable`, not `MemFree`, so reclaimable page cache doesn't read as used.

## Turning it on and off

Everything is driven by systemd enablement, so **nothing is ever deleted** to
turn metrics off — the units, scripts and buffered data all stay put and come
back exactly as they were:

```bash
sudo tte-metrics-ctl apply --enabled=false
sudo tte-metrics-ctl apply --enabled=true
sudo tte-metrics-ctl status
```

`apply` takes the whole desired state and is idempotent; omitted flags keep
their current value, so flipping the collector off doesn't discard a tuned
interval. Enable/disable is a symlink on the root volume, so it survives reboots
and the auto-shutoff stop/start cycle with no re-apply.

The same thing is available from the web UI on the Instance page (Metrics
Collector tile), which reaches this script over SSM. Desired state is stored on
the `inst#<id>` Dynamo row so the UI can render without touching the instance at
all, and so a rebuilt box picks its settings back up during `setup.sh`.

| Setting | Flag | Range |
| --- | --- | --- |
| Collector on/off | `--enabled` | `true` / `false` |
| Sample interval | `--collect` | 15–3600s |
| Upload mode | `--upload-mode` | `timer` / `manual` |
| Upload interval | `--upload` | 60–3600s (`timer` mode only) |
| Local retention | `--retain` | 1–30 days |

Bounds are enforced in three places — this script, `METRICS_BOUNDS` in
`_shared/shared/utils/InstanceMetrics.ts`, and the frontend tile. Change one,
change all three.

## Cost of an upload

The AWS CLI is Python: roughly **0.7–1.5s of CPU and 60–100MB RSS per
invocation**. That is, by a wide margin, the most expensive thing this collector
does — the sampler next to it is a few milliseconds of `awk`. Two consequences
shape the design:

- The whole buffer goes up in **one** `aws s3 sync`, never one `cp` per hour, so
  the cost is flat regardless of backlog.
- The upload unit runs at `Nice=19` with idle CPU and I/O scheduling. That
  doesn't make the second of CPU cheaper, it makes it yield — on the single-core
  instances it runs on cycles TShock isn't using.

If the scheduled upload is still too much, `--upload-mode=manual` disables the
timer entirely.

## Manual upload mode

In `manual` mode nothing is uploaded on a schedule. Samples reach S3 only:

1. **on shutdown**, via `tte-metrics-flush.service`, and
2. **on demand**, via `tte-metrics-ctl upload` (the UI's "Upload now" button).

Between those points the data exists **only on the instance's EBS volume**. A
clean stop flushes it; a *terminate* loses it. That's the trade-off the mode
exists to offer.

Two things make this safe that wouldn't be under a 5-minute timer, and both are
load-bearing:

- The uploader syncs **every** buffer file, not just the current and previous
  hour. A manual-mode gap can be arbitrarily many hours long.
- Pruning runs **only after a successful sync** (`set -e` aborts first
  otherwise). Pruning by mtime alone — as this used to do — would silently
  delete metrics that had never reached S3.

`tte-metrics-flush.service` is therefore enabled in both modes, and is enabled
whenever collection is.

## Install

Requires the instance role to allow `s3:PutObject` and `s3:ListBucket` on
`arn:aws:s3:::<logs-bucket>/metrics/*`. (`sync` lists the destination prefix
before copying, which `cp` did not.) The instance already writes TShock console
logs to this bucket, so this may just be a prefix widening rather than a new
statement — check the existing policy before adding one.

Stage the `metrics/` directory on the box, then:

```bash
sudo TTE_METRICS_BUCKET=<logs-bucket-name> ./install.sh
```

The installer is idempotent; re-run it to pick up script changes. A re-run
**preserves** existing settings — caller-provided env vars win, then whatever is
already in `/etc/tte-metrics.env`, then defaults. Seed different defaults on a
first install with `TTE_METRICS_COLLECT_SEC`, `TTE_METRICS_UPLOAD_SEC`,
`TTE_METRICS_UPLOAD_MODE`, `TTE_METRICS_RETAIN_DAYS`, `TTE_METRICS_ENABLED`.

`setup.sh`'s `metrics` step calls this installer and passes through any
`metricsConfig` already on the instance's Dynamo row.

## Verify

```bash
tte-metrics-ctl status
systemctl list-timers 'tte-metrics-*'
tail -f /var/lib/tte-metrics/$(date -u +%Y/%m/%d/%H).jsonl
journalctl -u tte-metrics-upload -n 50
aws s3 ls "s3://<logs-bucket>/metrics/$(ec2-metadata -i | cut -d' ' -f2)/" --recursive
```

The very first sample after boot is skipped by design — `/proc/stat` counters
are cumulative, so CPU% needs a previous sample to diff against, and reporting
`0` would be a lie rather than a gap.

## Cost

~2 PUTs per 5 min ≈ 17k/month ≈ **$0.09/instance/month**, plus negligible
storage (~130KB/day/instance at 60s sampling). Manual mode cuts the PUT count to
whatever you actually trigger. Set an S3 lifecycle rule on the `metrics/` prefix
to expire objects after 30–90 days.

## Trade-off you're accepting

No CloudWatch Alarms on these numbers. Nothing watches them and nothing pages
you. If an alarm on CPU or memory is ever actually load-bearing, put *that one
metric* back on CloudWatch — a single series is pennies — rather than trying to
build alerting here.
