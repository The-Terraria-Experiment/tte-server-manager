#!/bin/bash
#
# Interactive entry point for setup.sh. Runs on YOUR machine (needs a local
# ssh/scp), NOT on the instance -- it prompts for the instance IP and any
# values you want to override, stages instance-scripts/ over scp, then opens
# an SSH session that runs setup.sh and drops you into a shell on the box
# once it finishes (or fails -- you land in the shell either way to look).
#
# Usage:
#   ./remote-setup.sh
#
# Everything is prompted for, with a default shown in [brackets] -- hit enter
# to accept it. SSH user/key and the REST password are remembered in
# ~/.tte-setup-remote.env (mode 600) so repeat runs against new instances only
# really need a fresh IP. The instance IP is deliberately never remembered --
# defaulting it silently would risk re-running setup against the wrong box.
#
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATE_FILE="$HOME/.tte-setup-remote.env"
REMOTE_ENV_PATH="/tmp/tte-setup-env"

if [ -f "$STATE_FILE" ]; then
	if bash -n "$STATE_FILE" 2>/dev/null; then
		# shellcheck disable=SC1090
		source "$STATE_FILE"
	else
		echo "warning: $STATE_FILE is corrupted, ignoring it -- you'll be re-prompted" >&2
		rm -f "$STATE_FILE"
	fi
fi

ask() {
	# ask VAR "prompt text" "default"
	# Prompt is printed explicitly (not via read -p) -- read -p's built-in
	# prompt is silently swallowed when stdin isn't a real tty in some shells.
	local __var=$1 __prompt=$2 __default=${3:-}
	local __suffix="" __input
	[ -n "$__default" ] && __suffix=" [$__default]"
	printf '%s%s: ' "$__prompt" "$__suffix" >&2
	read -r __input
	# Some Windows terminals deliver CRLF-terminated input to bash's `read`;
	# `read -r` only strips the trailing \n, so a literal \r is silently left
	# on the end of the value -- invisible in any terminal, but it turns a
	# perfectly correct-looking path into one that doesn't exist on disk.
	__input=${__input%$'\r'}
	# Windows' "Copy as path" wraps the result in quotes; unlike quotes typed on
	# a real command line (stripped by the shell parser before a command runs),
	# quotes pasted into a plain `read` are kept as literal characters -- so
	# strip one matching pair here rather than let it corrupt e.g. an -i path.
	case "$__input" in
		\"*\") __input=${__input#\"}; __input=${__input%\"} ;;
		\'*\') __input=${__input#\'}; __input=${__input%\'} ;;
	esac
	printf -v "$__var" '%s' "${__input:-$__default}"
}

ask_secret() {
	# ask_secret VAR "prompt text" "existing-value"
	local __var=$1 __prompt=$2 __existing=${3:-}
	local __suffix="" __input
	[ -n "$__existing" ] && __suffix=" [leave blank to reuse saved password]"
	printf '%s%s: ' "$__prompt" "$__suffix" >&2
	read -r -s __input
	echo >&2
	__input=${__input%$'\r'}
	if [ -z "$__input" ] && [ -n "$__existing" ]; then
		printf -v "$__var" '%s' "$__existing"
	else
		printf -v "$__var" '%s' "$__input"
	fi
}

echo "== TTE instance setup =="
echo

ask IP "Instance IP"
[ -n "$IP" ] || { echo "an instance IP is required" >&2; exit 1; }

ask SSH_USER "SSH user" "${SSH_USER:-ubuntu}"
ask SSH_KEY "SSH key path (blank = ssh's default identity)" "${SSH_KEY:-}"
if [ -n "$SSH_KEY" ] && [ ! -f "$SSH_KEY" ]; then
	echo "warning: bash can't see a file at that path -- ssh almost certainly won't either." >&2
	echo "  captured value (${#SSH_KEY} chars), exact bytes:" >&2
	printf '%s' "$SSH_KEY" | od -An -c | sed 's/^/    /' >&2
	echo "  if that shows anything other than the path you expect (extra chars," >&2
	echo "  wrong slashes, etc.), that's the bug. Re-run and retype it by hand" >&2
	echo "  (not paste) to rule out anything your clipboard is carrying along." >&2
	exit 1
fi
ask_secret REST_PASSWORD "TShock REST password (must match Secrets Manager)" "${REST_PASSWORD:-}"
[ -n "$REST_PASSWORD" ] || { echo "a REST password is required" >&2; exit 1; }

TTE_ROOT_OVERRIDE=""
TTE_TSHOCK_BUCKET_OVERRIDE=""
TTE_TSHOCK_KEY_OVERRIDE=""
TTE_LOGS_BUCKET_OVERRIDE=""
TTE_CONFIG_BUCKET_OVERRIDE=""
TTE_INSTANCE_TABLE_OVERRIDE=""
TTE_VALID_ROOTS_OVERRIDE=""
TTE_WORLD_PATH_NICKNAMES_OVERRIDE=""
TTE_REST_PORT_OVERRIDE=""
TTE_REST_USER_OVERRIDE=""
TTE_REST_GROUP_OVERRIDE=""
TTE_DOTNET_MAJOR_OVERRIDE=""

ADVANCED=""
ask ADVANCED "Customize bucket/port/account settings? (y/N)" "n"
if [[ "$ADVANCED" =~ ^[Yy] ]]; then
	echo "(blank on any of these keeps setup.sh's own default)"
	ask TTE_ROOT_OVERRIDE               "Root folder on the instance"
	ask TTE_TSHOCK_BUCKET_OVERRIDE       "TShock artifact bucket"
	ask TTE_TSHOCK_KEY_OVERRIDE          "TShock artifact key"
	ask TTE_LOGS_BUCKET_OVERRIDE         "Logs bucket"
	ask TTE_CONFIG_BUCKET_OVERRIDE       "Config bucket"
	ask TTE_INSTANCE_TABLE_OVERRIDE      "Instance DynamoDB table"
	ask TTE_VALID_ROOTS_OVERRIDE         "validRoots (nickname=path,nickname=path)"
	ask TTE_WORLD_PATH_NICKNAMES_OVERRIDE "worldPaths nicknames (csv)"
	ask TTE_REST_PORT_OVERRIDE           "TShock REST port"
	ask TTE_REST_USER_OVERRIDE           "TShock REST username"
	ask TTE_REST_GROUP_OVERRIDE          "TShock REST group"
	ask TTE_DOTNET_MAJOR_OVERRIDE        "Dotnet major version"
fi

# Remember the fleet-wide constants (never the IP -- see header). Values go
# through %q so anything containing quotes, spaces, or $ still round-trips
# safely through the later `source` -- a raw heredoc broke on exactly this
# once already (an unbalanced quote pasted into SSH_KEY corrupted the file
# badly enough that sourcing it was a syntax error, not just a bad value).
umask 077
{
	printf 'SSH_USER=%q\n' "$SSH_USER"
	printf 'SSH_KEY=%q\n' "$SSH_KEY"
	printf 'REST_PASSWORD=%q\n' "$REST_PASSWORD"
} > "$STATE_FILE"
chmod 600 "$STATE_FILE"

# Built as a local file and pushed over scp rather than passed inline on the
# ssh command line -- keeps the password out of `ps` on the remote box and out
# of local shell history.
LOCAL_ENV=$(mktemp)
chmod 600 "$LOCAL_ENV"
cleanup() { rm -f "$LOCAL_ENV"; }
trap cleanup EXIT

{
	echo "TTE_USER=$SSH_USER"
	echo "TTE_REST_PASSWORD=$REST_PASSWORD"
	[ -n "$TTE_ROOT_OVERRIDE" ]               && echo "TTE_ROOT=$TTE_ROOT_OVERRIDE"
	[ -n "$TTE_TSHOCK_BUCKET_OVERRIDE" ]       && echo "TTE_TSHOCK_BUCKET=$TTE_TSHOCK_BUCKET_OVERRIDE"
	[ -n "$TTE_TSHOCK_KEY_OVERRIDE" ]          && echo "TTE_TSHOCK_KEY=$TTE_TSHOCK_KEY_OVERRIDE"
	[ -n "$TTE_LOGS_BUCKET_OVERRIDE" ]         && echo "TTE_LOGS_BUCKET=$TTE_LOGS_BUCKET_OVERRIDE"
	[ -n "$TTE_CONFIG_BUCKET_OVERRIDE" ]       && echo "TTE_CONFIG_BUCKET=$TTE_CONFIG_BUCKET_OVERRIDE"
	[ -n "$TTE_INSTANCE_TABLE_OVERRIDE" ]      && echo "TTE_INSTANCE_TABLE=$TTE_INSTANCE_TABLE_OVERRIDE"
	[ -n "$TTE_VALID_ROOTS_OVERRIDE" ]         && echo "TTE_VALID_ROOTS=$TTE_VALID_ROOTS_OVERRIDE"
	[ -n "$TTE_WORLD_PATH_NICKNAMES_OVERRIDE" ] && echo "TTE_WORLD_PATH_NICKNAMES=$TTE_WORLD_PATH_NICKNAMES_OVERRIDE"
	[ -n "$TTE_REST_PORT_OVERRIDE" ]           && echo "TTE_REST_PORT=$TTE_REST_PORT_OVERRIDE"
	[ -n "$TTE_REST_USER_OVERRIDE" ]           && echo "TTE_REST_USER=$TTE_REST_USER_OVERRIDE"
	[ -n "$TTE_REST_GROUP_OVERRIDE" ]          && echo "TTE_REST_GROUP=$TTE_REST_GROUP_OVERRIDE"
	[ -n "$TTE_DOTNET_MAJOR_OVERRIDE" ]        && echo "TTE_DOTNET_MAJOR=$TTE_DOTNET_MAJOR_OVERRIDE"
} > "$LOCAL_ENV"

SSH_OPTS=()
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")

echo
echo "==> staging instance-scripts/ on $SSH_USER@$IP"
# Clear the destination first. scp -r into an EXISTING directory nests the source
# inside it (/tmp/tte/instance-scripts/...) instead of replacing it, which leaves
# the /tmp/tte/setup/setup.sh we actually execute frozen at whatever the first
# run copied -- edits made since then silently never reach the box.
ssh "${SSH_OPTS[@]}" "$SSH_USER@$IP" "rm -rf /tmp/tte"
scp -q "${SSH_OPTS[@]}" -r "$HERE/.." "$SSH_USER@$IP:/tmp/tte"

echo "==> copying env"
scp -q "${SSH_OPTS[@]}" "$LOCAL_ENV" "$SSH_USER@$IP:$REMOTE_ENV_PATH"
ssh "${SSH_OPTS[@]}" "$SSH_USER@$IP" "chmod 600 $REMOTE_ENV_PATH"

echo "==> connecting to $IP"
echo
ssh -t "${SSH_OPTS[@]}" "$SSH_USER@$IP" '
	sudo bash -c "set -a; source '"$REMOTE_ENV_PATH"'; set +a; rm -f '"$REMOTE_ENV_PATH"'; /tmp/tte/setup/setup.sh"
	exec bash -l
'
