# Plan: open GNS/UDP so console players can join

Status: **parked** (2026-11-27). The fleet runs TCP-only for now. Pick this up after the 1.4.6 rollout
has settled.

## Why
Terraria 1.4.6 added crossplay. Xbox and PlayStation players reach a dedicated server only through
GNS, Valve's GameNetworkingSockets, which runs over **UDP** on the server port. PC players can join over
TCP or GNS. Our public address (`play.theterrariaexperiment.com`, a Global Accelerator) forwards only
TCP 7777 today, so console players can't reach us.

## What's already done
- The fleet's TShock build (6.2.2-tte1, source in `../TTE/TShock-tte-1.4.6`, branch `tte/terraria-1.4.6`)
  listens on UDP 7777 for GNS by default. It ships the Linux GNS libraries, including OpenSSL 1.1, in
  `runtimes/linux-x64/native/`, so nothing is installed system-wide.
- If the libraries fail to load, the server logs a warning and runs TCP-only.
- `"EnableGNS": false` in `tshock/config.json`, plus a restart, turns GNS off. That is the kill switch
  for everything below.

## How PC clients choose a transport (this is what makes it risky)
A 1.4.6 PC client starts a GNS/UDP connect and a TCP connect at the same time and keeps whichever
succeeds first (`Netplay.UDPClientLoop` / `TcpConnectLoop`, decompiled). GNS's `Connect` blocks until its
handshake completes and throws otherwise. Today UDP is unreachable, so TCP always wins. **Once UDP is
open, some PC players land on GNS instead, and which ones changes on every join.** TShock has run the
GNS path far less than TCP: its own Linux socket handling and dead-connection detection only cover TCP.

## Work

### 0. Fix the GNS server-full hang and crash first (blocker)
An adversarial review of the fork (2026-11-27) found two remotely triggerable bugs that only matter once
UDP 7777 is reachable. Both come from vanilla 1.4.6 code that TSAPI's removed `OnConnectionAccepted`
override used to bypass:
- **Hang:** when the server is full, vanilla `ProcessPendingConnections` kicks a new GNS connection with
  `KickClient`, which sends packet 2 but never closes the socket. It stays in the static
  `GNS_Socket.Connections` dictionary and nothing reads it. After about 512 messages,
  `AvailableBuffers.Take()` (a `BlockingCollection`) blocks forever inside `GNS_Socket.Update`, which runs
  on the main game loop. The world freezes; REST keeps answering. An attacker can fill the slots with
  idle TCP connections first.
- **Crash:** a GNS client that connects and disconnects within one poll while the server is full makes
  `KickClient` call `GNS_Socket.AsyncSend` on a dead socket. That throws `SocketException` on the server
  loop thread with nothing catching it, so the process exits. An attacker can retry until it wins.
- [ ] Fix: hook `HookEvents.Terraria.Netplay.KickClient` (TSAPI or TShock): run the original inside
  try/catch, then `client.Close()`. About 12 lines. It also closes rejected "server full" TCP sockets,
  which today wait for the GC (low severity).
- [ ] Also: TShock assigns `Netplay.UseGNS = Config.Settings.EnableGNS` unconditionally, which silently
  overrides vanilla's `-nogns` flag. Change it to `&=` (and the same for `UseUPNP`) so `-nogns` works as
  a launch-time kill switch.
- [ ] Also: a failed GNS listen (UDP 7777 already bound) logs nothing. Warn when
  `Netplay.UseGNS && GNS_Socket.ListenSocket == null` after `StartListening` (about 8 lines).
- [ ] Decide the `EnableGNS` default. It is `true` today; until the KickClient fix ships, any box whose
  security group admits UDP 7777 is exposed. The fleet's `ttesm-terraria-server` group had no UDP rule
  as of 2026-11-27.

### 1. Infrastructure (out-of-band, like the rest of the infra)
- [ ] Game-server security group(s): allow inbound **UDP 7777** from `0.0.0.0/0`, matching TCP 7777.
  GA preserves client IPs for EC2 endpoints, so the traffic arrives from players' own addresses.
- [ ] Accelerator `ttesm-main-server`: add a **UDP listener on 7777**. A listener gets its own endpoint
  group, so create one in us-east-2 with the same **TCP 3891** health check as the TCP group. GA can't
  health-check over UDP. Point it at the same instance as the TCP group.
- Cost: the fixed fee is per accelerator (about $18/month), with no per-listener charge listed. Traffic
  is billed per GB at the same rate whether it's TCP or UDP. PC players moving to UDP doesn't change the
  bill; console players add traffic like any other player would.

### 2. Make the public-address switch move both groups (this repo)
The switch (`_shared/shared/utils/instance/PublicAddress.ts`, `GlobalAcceleratorDao.RouteAllTrafficTo`,
`instance-manager/actions/publicAddress.ts`) reads and updates only `GA_ENDPOINT_GROUP_ARN`. With a
second group, a switch would leave TCP and UDP pointing at different boxes.
- [ ] New optional env var `GA_UDP_ENDPOINT_GROUP_ARN` (instance-manager, both aliases), read raw like
  the TCP one. Unset means behave exactly as today.
- [ ] `readPublicAddress`: describe both groups. Report `mixed: true` (plus which group disagrees) when
  their targets differ, so a half-finished switch or a console edit is visible on the tile.
- [ ] Route action: update **UDP first, then TCP**. If the second call fails, return an error that says
  which group moved. A retry is safe because each call replaces the whole list.
- [ ] The player-count check before switching (409 `PLAYERS_CONNECTED`) reads TShock's roster, which
  includes GNS players, so it needs no change. Confirm that during testing.
- [ ] IAM: the instance-manager role's `globalaccelerator:DescribeEndpointGroup`/`UpdateEndpointGroup`
  must cover the new group ARN.
- [ ] Update CLAUDE.md's Global Accelerator gotcha (one TCP listener becomes TCP + UDP, two groups move
  together) and the env var list.
- Deploy: stage, then main, as usual. The prod API deploy for the public-address routes was already
  pending when this was written (see memory `project_public_address_ga`).

### 3. Test (staging box first, never the event server)
Before opening UDP to players:
- [ ] Make sure a test join is actually on GNS. On the box, the tester's IP shows a UDP flow in `ss -un`
  and no TCP connection in `ss -tn`. Reconnect until it lands on GNS.
- [ ] On GNS, check: join and spawn, chat and commands, item pickup and drop, `/kick`, an IP ban against
  the tester's real IP (checks client IP preservation over UDP), leave (SSC saves, "has left" appears
  once, EventNotifier sends `player.leave`, auto-shutoff sees the box go idle), InventoryMonitor reads
  the player.
- [ ] Pull the network on a GNS client (no clean disconnect). The slot should be freed and the leave
  handled within GNS's timeout, not left hanging. This is the path TShock's TCP-only dead-connection
  handling doesn't cover.
- [ ] Switch the public address to another box and back from the site. Both groups should follow and
  the tile should never show `mixed` afterwards.
- [ ] A console player joins (someone with an Xbox or PlayStation).

### 4. Roll out
- [ ] Open UDP outside an event, on a normal play night, and watch the console and `journalctl` for GNS
  errors, stuck slots, and players reporting disconnects.
- [ ] Kill switch if anything misbehaves: `"EnableGNS": false` and restart the server. Removing the GA
  UDP listener also works and needs no restart.

## Risks that only show over time
Long sessions, many simultaneous players, packet loss, GA's UDP flow idle timeout (GNS sends
keepalives, so probably fine), and GNS clients that vanish without disconnecting. None of these show up
in a one-off test, so watch the first few weeks.

## Open questions
- Do we expect console players at all? If not, this whole plan only adds risk for PC players.
- 1.4.6's ServerInfo packet (163) sends every connecting client the host's machine name. On EC2 that's
  `ip-a-b-c-d`, the private IP. It's the same on TCP and not specific to this plan, but worth fixing
  (set a hostname, or patch the packet) if we're widening exposure.
