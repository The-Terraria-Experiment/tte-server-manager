#!/bin/sh
#
# Pushes the local metric buffer to S3 and prunes old local files. May run on a
# timer, on shutdown via tte-metrics-flush, or on demand from the web UI (which
# reaches it through `tte-metrics-ctl upload`).
#
# Signs its own S3 PUTs with SigV4 rather than shelling out to `aws s3 sync`.
# The AWS CLI is Python: ~0.7-1.5s of CPU and 60-100MB RSS per invocation, which
# on a single-core box is a second TShock does not get. Signing here costs
# ~20-40ms and ~3MB across a handful of openssl forks -- see the README's "Cost
# of an upload". Credentials come from IMDS, which is the same place the CLI was
# already getting them, so this needs no new configuration or IAM.
#
# The buffer mirrors the S3 key layout exactly, so a local path maps to a key by
# string substitution alone:
#
#   $DIR/YYYY/MM/DD/HH.jsonl  ->  s3://$BUCKET/$PREFIX/$INSTANCE_ID/YYYY/MM/DD/HH.jsonl
#
# Usage:
#   tte-metrics-upload              upload everything changed since the last run
#   tte-metrics-upload --selftest   PUT a probe object and exit; proves signing
#                                   and IAM work without touching the buffer
#
# Set TTE_METRICS_UPLOADER=cli to fall back to `aws s3 sync`. That path is kept
# only as an escape hatch for the first deploy of the signer -- if uploads start
# failing on a box, flipping that one env var restores the previous behaviour
# without a reinstall.
#
set -eu

DIR=${TTE_METRICS_DIR:-/var/lib/tte-metrics}
BUCKET=${TTE_METRICS_BUCKET:-}
PREFIX=${TTE_METRICS_PREFIX:-metrics}
RETAIN_DAYS=${TTE_METRICS_RETAIN_DAYS:-2}
REGION=${TTE_METRICS_REGION:-}
UPLOADER=${TTE_METRICS_UPLOADER:-sigv4}

SELFTEST=0
case "${1:-}" in
	"")          ;;
	--selftest)  SELFTEST=1 ;;
	*)           echo "usage: tte-metrics-upload [--selftest]" >&2; exit 2 ;;
esac

die() { echo "tte-metrics-upload: $*" >&2; exit 1; }

[ -n "$BUCKET" ] || die "TTE_METRICS_BUCKET is not set (expected in /etc/tte-metrics.env)"

# Local paths become S3 keys by stripping "$DIR/", so a trailing slash here
# would leave a leading slash on every key and silently create a different
# object layout than the one the readers expect.
while [ "$DIR" != "/" ] && [ "${DIR%/}" != "$DIR" ]; do DIR=${DIR%/}; done

mkdir -p "$DIR"

# The stamp records "everything present was in S3 as of this moment". It is
# taken BEFORE any upload so that a file written while the run is in flight gets
# re-sent next time rather than being skipped, and it replaces the real stamp
# only if every single PUT succeeded -- see the prune comment at the bottom.
STAMP="$DIR/.uploaded"
STAMP_NEW="$DIR/.uploaded.new"

RESP=$(mktemp)
trap 'rm -f "$RESP" "$STAMP_NEW"' EXIT INT TERM

# --- instance identity --------------------------------------------------------

IMDS=http://169.254.169.254
IMDS_TOKEN=""

imds_token() {
	curl -sf -m 2 -X PUT "$IMDS/latest/api/token" \
		-H "X-aws-ec2-metadata-token-ttl-seconds: 60"
}

imds_get() {
	curl -sf -m 2 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" "$IMDS/latest/meta-data/$1"
}

IMDS_TOKEN=$(imds_token) || die "could not reach IMDS -- is this an EC2 instance?"

# Instance ID and region are immutable for the life of the box, so they are
# cached on the volume and cost nothing after the first run. The IAM ROLE NAME
# is deliberately not cached: an instance profile can be swapped, and a stale
# role name yields a 404 from the credentials endpoint that looks like an IMDS
# outage. It is one extra local GET.
read_cached() {
	if [ -s "$1" ]; then read -r _cached < "$1"; else _cached=""; fi
}

read_cached "$DIR/.instance-id"
IID=$_cached
if [ -z "$IID" ]; then
	IID=$(imds_get instance-id) || IID=""
	[ -n "$IID" ] || die "could not resolve instance id from IMDS"
	printf '%s\n' "$IID" > "$DIR/.instance-id"
fi

if [ -z "$REGION" ]; then
	read_cached "$DIR/.region"
	REGION=$_cached
fi
if [ -z "$REGION" ]; then
	REGION=$(imds_get placement/region) || REGION=""
	[ -n "$REGION" ] || die "could not resolve region from IMDS"
	printf '%s\n' "$REGION" > "$DIR/.region"
fi

# --- CLI escape hatch ---------------------------------------------------------

upload_via_cli() {
	# --exclude/--include are load-bearing: the buffer dir also holds the .cpu
	# delta state, the IMDS caches and the upload stamp, none of which belong in
	# S3. Unlike the signer, this path needs s3:ListBucket to compare against the
	# destination.
	aws s3 sync "$DIR" "s3://$BUCKET/$PREFIX/$IID/" \
		--exclude "*" --include "*.jsonl" \
		--only-show-errors
}

# --- SigV4 --------------------------------------------------------------------

# openssl's dgst output shape has moved between versions ("SHA256(stdin)= x" vs
# "SHA2-256(stdin)= x"); -r pins it to the stable coreutils order ("x *stdin").
# Every result is still asserted to be 64 hex chars, because the failure mode of
# a misparsed digest is a silently invalid signature -- a 403 at 3am rather than
# an error here.
#
# These four helpers are always called through $(...), which runs them in a
# subshell -- so their die() only kills that subshell and the caller would carry
# on with an empty string. Every call site therefore appends its own `|| die`.
# The inner die supplies the specific reason, the outer one actually stops.
assert_hex() {
	case "$1" in
		''|*[!0-9a-f]*) die "openssl produced unexpected output '$1'; refusing to sign" ;;
	esac
	[ ${#1} -eq 64 ] || die "expected a 64-char digest, got ${#1} chars; refusing to sign"
}

sha256_file() {
	_o=$(openssl dgst -sha256 -r "$1") || die "openssl failed hashing $1"
	_o=${_o%% *}
	assert_hex "$_o"
	printf '%s' "$_o"
}

sha256_str() {
	_o=$(printf '%s' "$1" | openssl dgst -sha256 -r) || die "openssl failed hashing a string"
	_o=${_o%% *}
	assert_hex "$_o"
	printf '%s' "$_o"
}

# HMAC with a binary key has to be handed in as hex, which is why the derivation
# chain below stays hex-encoded end to end instead of piping raw bytes between
# forks. Only the first link takes an ASCII key ("AWS4" + secret), hence key: vs
# hexkey: -- that asymmetry is the usual place hand-rolled SigV4 goes wrong.
hmac_hex() {
	_o=$(printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$1" -r) \
		|| die "openssl HMAC failed"
	_o=${_o%% *}
	assert_hex "$_o"
	printf '%s' "$_o"
}

hmac_str() {
	_o=$(printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "key:$1" -r) \
		|| die "openssl HMAC failed"
	_o=${_o%% *}
	assert_hex "$_o"
	printf '%s' "$_o"
}

fetch_credentials() {
	_role=$(imds_get "iam/security-credentials/") || _role=""
	[ -n "$_role" ] || die "no IAM role attached to this instance"

	_creds=$(imds_get "iam/security-credentials/$_role") || _creds=""
	[ -n "$_creds" ] || die "could not read credentials for role '$_role' from IMDS"

	# One awk instead of three seds. None of the three values can contain a
	# space (they are opaque base64-ish tokens sent as HTTP header values), so
	# splitting the result on spaces below is exact.
	_parsed=$(printf '%s' "$_creds" | awk -F'"' '
		/"AccessKeyId"/     { k = $4 }
		/"SecretAccessKey"/ { s = $4 }
		/"Token"/           { t = $4 }
		END { printf "%s %s %s", k, s, t }')

	AWS_KEY_ID=${_parsed%% *}
	_rest=${_parsed#* }
	AWS_SECRET=${_rest%% *}
	AWS_TOKEN=${_rest#* }

	[ -n "$AWS_KEY_ID" ] || die "IMDS credentials had no AccessKeyId"
	[ -n "$AWS_SECRET" ] || die "IMDS credentials had no SecretAccessKey"
	# Instance-role credentials are always STS temporary credentials, so the
	# session token is mandatory -- and x-amz-security-token must be both sent
	# and signed. Omitting it produces a 403 that reads exactly like a missing
	# IAM permission.
	[ -n "$AWS_TOKEN" ] || die "IMDS credentials had no session Token"
}

# The signing key depends only on the date, so it is derived once and reused for
# every object in the run. SIGNING_DATE tracks what it was derived for, so a run
# that straddles UTC midnight re-derives instead of signing with a stale scope.
SIGNING_KEY=""
SIGNING_DATE=""

signing_key_for() {
	if [ "$1" != "$SIGNING_DATE" ]; then
		_k=$(hmac_str "AWS4$AWS_SECRET" "$1")   || die "could not derive kDate"
		_k=$(hmac_hex "$_k" "$REGION")          || die "could not derive kRegion"
		_k=$(hmac_hex "$_k" "s3")               || die "could not derive kService"
		SIGNING_KEY=$(hmac_hex "$_k" "aws4_request") || die "could not derive kSigning"
		SIGNING_DATE=$1
	fi
}

CONTENT_TYPE="application/x-ndjson"
SIGNED_HEADERS="content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token"

# S3 canonical URIs percent-encode everything outside the unreserved set, except
# that "/" stays a separator. Our keys are only ever digits, "/", ".", "-" and
# the instance id, all of which pass through untouched -- so there is no encoder
# here, and this assertion exists to make that assumption fail loudly if the key
# layout ever grows a character that needs one.
assert_key_safe() {
	case "$1" in
		*[!A-Za-z0-9/._-]*) die "key '$1' needs percent-encoding, which this signer does not implement" ;;
	esac
}

# PUTs $1 to key $2. Returns non-zero on any non-2xx so the caller can count
# failures rather than aborting the whole run on the first bad object.
put_object() {
	_src=$1
	_key=$2

	assert_key_safe "$_key"

	_payload_hash=$(sha256_file "$_src") || die "could not hash $_src"

	# One date(1) fork for both forms. Re-read per object rather than once per
	# run: a signature is only valid within 15 minutes of x-amz-date, and a
	# manual-mode backlog on a slow link could take longer than that to drain.
	set -- $(date -u '+%Y%m%dT%H%M%SZ %Y%m%d')
	_amzdate=$1
	_datestamp=$2

	signing_key_for "$_datestamp"

	_host="$BUCKET.s3.$REGION.amazonaws.com"
	_scope="$_datestamp/$REGION/s3/aws4_request"

	# Exact layout matters: line 3 is the empty query string and line 8 is the
	# blank line that terminates the canonical headers block. Header names are
	# lowercase and sorted; the four below already are.
	_canonical_request="PUT
/$_key

content-type:$CONTENT_TYPE
host:$_host
x-amz-content-sha256:$_payload_hash
x-amz-date:$_amzdate
x-amz-security-token:$AWS_TOKEN

$SIGNED_HEADERS
$_payload_hash"

	# Hashed into its own variable first rather than inline in the string below,
	# so a failure is a testable exit status instead of an empty line in the
	# middle of the string to sign.
	_cr_hash=$(sha256_str "$_canonical_request") || die "could not hash the canonical request"

	_string_to_sign="AWS4-HMAC-SHA256
$_amzdate
$_scope
$_cr_hash"

	_sig=$(hmac_hex "$SIGNING_KEY" "$_string_to_sign") || die "could not compute the request signature"

	# -H "Expect:" suppresses curl's automatic 100-continue on bodies over 1KB,
	# which would otherwise add a round trip per object for no benefit.
	# --retry covers S3's transient 500/503 and connection failures; re-sending
	# an identical signed request is safe well inside the 15-minute window.
	_code=$(curl -sS -X PUT "https://$_host/$_key" \
		--data-binary @"$_src" \
		-H "Content-Type: $CONTENT_TYPE" \
		-H "x-amz-content-sha256: $_payload_hash" \
		-H "x-amz-date: $_amzdate" \
		-H "x-amz-security-token: $AWS_TOKEN" \
		-H "Authorization: AWS4-HMAC-SHA256 Credential=$AWS_KEY_ID/$_scope, SignedHeaders=$SIGNED_HEADERS, Signature=$_sig" \
		-H "Expect:" \
		--retry 2 --retry-delay 1 -m 60 \
		-w '%{http_code}' -o "$RESP") || _code="000"

	case "$_code" in
		200|201) return 0 ;;
	esac

	echo "S3 PUT failed for $_key (HTTP $_code)" >&2
	if [ -s "$RESP" ]; then
		# S3's error body names the actual problem (SignatureDoesNotMatch vs
		# AccessDenied vs RequestTimeTooSkewed), which is the difference between
		# a signing bug, an IAM gap and a clock problem.
		head -c 512 "$RESP" >&2
		echo >&2
	fi
	return 1
}

upload_via_sigv4() {
	fetch_credentials

	# Replaces `aws s3 sync`'s comparison against the remote listing, which is
	# the only reason that path needed s3:ListBucket. Completed hours are
	# immutable so they stop being re-sent after their first successful upload;
	# only the current hour is re-sent each run, which is the same write pattern
	# as before.
	if [ -f "$STAMP" ]; then
		_list=$(find "$DIR" -name '*.jsonl' -newer "$STAMP" 2>/dev/null || true)
	else
		_list=$(find "$DIR" -name '*.jsonl' 2>/dev/null || true)
	fi

	if [ -z "$_list" ]; then
		return 0
	fi

	# Split on newlines only, then restore IFS immediately -- put_object relies on
	# default word splitting for its date(1) call, so a newline-only IFS must not
	# still be in effect once the loop body runs. Buffer paths are digits,
	# slashes and ".jsonl" by construction; assert_key_safe re-checks each one.
	_old_ifs=$IFS
	IFS='
'
	# shellcheck disable=SC2086
	set -- $_list
	IFS=$_old_ifs

	_failed=0
	_total=$#

	for _f in "$@"; do
		put_object "$_f" "$PREFIX/$IID/${_f#"$DIR/"}" || _failed=$((_failed + 1))
	done

	if [ "$_failed" -gt 0 ]; then
		die "$_failed of $_total object(s) failed to upload; stamp not advanced and nothing pruned"
	fi

	echo "uploaded $_total object(s) to s3://$BUCKET/$PREFIX/$IID/"
}

# --- selftest -----------------------------------------------------------------

# Proves credentials, signing and IAM all work, without depending on there being
# anything in the buffer and without touching the buffer or the stamp. This is
# the thing to run first on a box that has never uploaded before -- a signing
# bug otherwise surfaces as a 403 on a timer with nobody watching.
if [ "$SELFTEST" -eq 1 ]; then
	if [ "$UPLOADER" = "cli" ]; then
		die "--selftest only applies to the sigv4 uploader (TTE_METRICS_UPLOADER=cli is set)"
	fi

	fetch_credentials

	probe=$(mktemp)
	trap 'rm -f "$RESP" "$STAMP_NEW" "$probe"' EXIT INT TERM
	printf '{"selftest":%s}\n' "$(date -u +%s)" > "$probe"

	if put_object "$probe" "$PREFIX/$IID/.selftest"; then
		echo "selftest OK: signed PUT to s3://$BUCKET/$PREFIX/$IID/.selftest succeeded"
		exit 0
	fi
	die "selftest FAILED -- see the HTTP status above"
fi

# --- run ----------------------------------------------------------------------

touch "$STAMP_NEW"

case "$UPLOADER" in
	sigv4) upload_via_sigv4 ;;
	cli)   upload_via_cli ;;
	*)     die "TTE_METRICS_UPLOADER must be sigv4 or cli, got '$UPLOADER'" ;;
esac

# Everything below only runs once every object is in S3 -- either upload path
# aborts the script otherwise. That ordering is the whole safety property: under
# manual-trigger uploads a buffer file can be days old and still be the only
# copy of that data, so pruning by mtime alone (as this used to do) would
# silently delete metrics that had never reached S3.
mv "$STAMP_NEW" "$STAMP"

find "$DIR" -name '*.jsonl' -mtime "+$RETAIN_DAYS" -delete 2>/dev/null || true

# The dated directories are cheap but unbounded; drop the ones the prune above
# emptied out so the tree doesn't accumulate a folder per day forever.
find "$DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
