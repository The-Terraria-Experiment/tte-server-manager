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
| `tte-metrics-collect.sh` | Reads `/proc/stat` + `/proc/meminfo`, appends one JSON line to `/var/lib/tte-metrics/YYYY/MM/DD/HH.jsonl`. No network, no AWS calls, exactly one fork. |
| `tte-metrics-upload.sh` | SigV4-signs an S3 `PUT` per changed buffer file with `curl` + `openssl`, then prunes local files. |
| `tte-metrics-ctl.sh` | Control surface: `status`, `apply`, `upload`. What the web UI drives over SSM. |
| `systemd/*.timer` | Collect and upload on configurable intervals. |
| `systemd/tte-metrics-flush.service` | Runs the uploader once on shutdown, so the last few minutes survive auto-shutoff. |

Data lands in the existing logs bucket (`S3_LOGS_BUCKET_NAME`) under its own
prefix, alongside `tshock-console/`:

```
s3://<logs-bucket>/metrics/<instance-id>/YYYY/MM/DD/HH.jsonl
```

The local buffer mirrors that key layout exactly, so a local path becomes its S3
key by stripping the buffer root — no path translation, and no per-hour
bookkeeping. Each hour is one object, overwritten in place as it fills rather
than appended as many small objects, so the object count stays trivial and the
read side is a plain prefix list.

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

The uploader **signs its own S3 requests** rather than shelling out to the AWS
CLI. The CLI is Python — roughly 0.7–1.5s of CPU and 60–100MB RSS per invocation
— which was by a wide margin the most expensive thing this collector did, on
boxes where some of the fleet is single-core.

| | `aws s3 sync` | SigV4 + `curl` |
| --- | --- | --- |
| CPU per run | 0.7–1.5s | ~20–40ms |
| Peak RSS | 60–100MB | ~3MB |
| Processes | 1 (Python) | ~16 short-lived |
| IAM required | `s3:PutObject` + `s3:ListBucket` | `s3:PutObject` |
| Run with nothing to upload | still lists the destination | 0 requests |

Signing is `openssl dgst` for the SHA-256 and the HMAC chain, and one `curl` PUT
per changed file. The upload unit still runs at `Nice=19` with idle CPU and I/O
scheduling — it costs nothing to keep, and it means even the short burst lands
on cycles TShock isn't using.

If the scheduled upload is still too much, `--upload-mode=manual` disables the
timer entirely.

### What replaced `sync`'s change detection

`aws s3 sync` compared against the remote listing, which is the only reason the
instance role ever needed `s3:ListBucket`. Instead there is a stamp file,
`/var/lib/tte-metrics/.uploaded`:

- it is touched **before** any upload, so a file written mid-run is re-sent next
  time rather than skipped;
- it is advanced **only if every PUT in the run succeeded**;
- the next run uploads exactly `find … -newer .uploaded`.

A partial failure therefore re-sends a few already-uploaded objects on the next
run. That is deliberate: PUTs are idempotent and cost milliseconds, whereas
advancing the stamp past a file that never landed would let the retention prune
delete it. Completed hours are immutable, so in steady state each run uploads
exactly one object — the current hour — and a run with nothing to do makes no S3
request at all.

### Verifying the signing

Hand-rolled SigV4 fails at *runtime*, not at install, and a signature bug looks
exactly like an IAM problem. So there's a probe:

```bash
sudo tte-metrics-ctl upload --selftest
```

It PUTs one tiny object to `metrics/<instance-id>/.selftest` and reports the
HTTP status, touching neither the buffer nor the stamp. Run it once on any newly
provisioned box before trusting the timer. On failure the uploader prints S3's
own error body, which is what distinguishes the three plausible causes:
`SignatureDoesNotMatch` (signing bug), `AccessDenied` (IAM), and
`RequestTimeTooSkewed` (clock — SigV4 rejects >15 min drift, so chrony must be
running).

The same probe is reachable from the **SELF-TEST** button on the Metrics
Collector tile (Instance page), and from the API as
`POST /instance/{id}/metrics/upload?selftest=true`. A failed probe comes back as
a `409 SELFTEST_FAILED` naming the S3 error code rather than a generic 500 —
the failure *is* the result, so it is reported rather than thrown.

### Escape hatch

`TTE_METRICS_UPLOADER=cli` in `/etc/tte-metrics.env` switches back to
`aws s3 sync`. It exists so the first deploy of the signer can be reverted with
one env var instead of a reinstall; that path needs `s3:ListBucket` again.

## Manual upload mode

In `manual` mode nothing is uploaded on a schedule. Samples reach S3 only:

1. **on shutdown**, via `tte-metrics-flush.service`, and
2. **on demand**, via `tte-metrics-ctl upload` (the UI's "Upload now" button).

Between those points the data exists **only on the instance's EBS volume**. A
clean stop flushes it; a *terminate* loses it. That's the trade-off the mode
exists to offer.

Two things make this safe that wouldn't be under a 5-minute timer, and both are
load-bearing:

- The uploader considers **every** buffer file, not just the current and
  previous hour. A manual-mode gap can be arbitrarily many hours long.
- Pruning runs **only after every PUT in the run succeeded**. Pruning by mtime
  alone — as this used to do — would silently delete metrics that had never
  reached S3.

`tte-metrics-flush.service` is therefore enabled in both modes, and is enabled
whenever collection is.

## Install

Requires the instance role to allow `s3:PutObject` on
`arn:aws:s3:::<logs-bucket>/metrics/*` — and nothing else. The instance already
writes TShock console logs to this bucket, so this may just be a prefix widening
rather than a new statement; check the existing policy before adding one.

Credentials come from IMDS, which is where the AWS CLI was already getting them,
so there is no profile, key file or region to configure. The uploader reads the
region from IMDS too and caches it next to the instance ID; `TTE_METRICS_REGION`
overrides it if you ever need to.

Needs `curl` and `openssl` on the box (both are present on a stock Ubuntu AMI).

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
sudo tte-metrics-ctl upload --selftest
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
