<template>
	<div class="contents">
		<StatusTile
			class="grow gradient-tile"
			:perm-required="PERMISSIONS.server.player.inventory.snapshots.read"
			:loading="sessionsLoading"
		>
			<template #header>
				<Icon icon="camera" color="text-gray-6" size="5" />
				<p class="text-gray-6 ml-2 text-lg">Inventory Snapshots</p>
			</template>
			<template #content>
				<div class="px-4 pb-4">
					<div class="bg-gray-1 px-4 pb-4 pt-2 rounded-md">
						<div class="flex items-center justify-between mb-2">
							<p class="font-main font-bold text-gray-8">ARCHIVING</p>
							<p v-if="!archiveConfigured" class="font-main text-sm text-gray-6 italic">Not configured</p>
						</div>

						<!-- <p class="font-main text-sm text-gray-6 mb-3">
							Records every captured inventory to long-term storage, organized by server session and
							player. Independent of the item rules &mdash; captures are kept whether or not anything
							is being enforced. Retained for 30 days.
						</p> -->

						<div class="flex flex-col sm:flex-row sm:justify-between">
							<div class="flex flex-wrap gap-2 items-center">
								<div
									class="flex items-center px-2 py-1 rounded-md"
									:class="canWrite ? 'bg-blue-0 cursor-pointer hover:bg-blue-1' : 'bg-gray-3'"
									@click="canWrite && (draft.enabled = !draft.enabled)"
								>
									<Checkbox class="h-4 w-4" :value="draft.enabled" />
									<span class="ml-2 font-main font-bold text-white-1">Archive snapshots</span>
								</div>
								<div
									v-for="kind in KINDS"
									:key="kind.id"
									class="flex items-center px-2 py-1 rounded-md"
									:class="canWrite && draft.enabled ? 'bg-blue-0 cursor-pointer hover:bg-blue-1' : 'bg-gray-3'"
									@click="canWrite && draft.enabled && toggleKind(kind.id)"
								>
									<Checkbox class="h-4 w-4" :value="draft.kinds.includes(kind.id)" :disabled="!(canWrite && draft.enabled)" />
									<span class="ml-2 font-main font-bold text-white-1">{{ kind.label }}</span>
								</div>
							</div>

							<FlexButton
								v-if="canWrite"
								class="h-max mt-4 sm:mt-0"
								:variant="BTN_VARIANT.SECONDARY"
								leftIcon="checkmark"
								leftIconSize="4"
								:disabled="savingArchive || !archiveDirty"
								:loading="savingArchive"
								@input="saveArchive"
							>
								SAVE
							</FlexButton>
						</div>
					</div>

					<div class="bg-gray-1 px-4 pb-4 pt-2 rounded-md mt-4">
						<div class="flex items-center justify-between mb-2">
							<p class="font-main font-bold text-gray-8">SERVER SESSIONS</p>
							<FlexButton
								class="px-2!"
								:variant="BTN_VARIANT.SECONDARY"
								leftIcon="arrow-rotate-right"
								leftIconSize="4"
								:disabled="sessionsLoading"
								:loading="sessionsLoading"
								@input="fetchSessions"
							/>
						</div>

						<p v-if="!sessionsLoading && !sessions.length" class="font-main text-gray-6 italic">
							No archived snapshots for this server yet.
						</p>

						<div v-if="sessions.length" class="max-h-64 overflow-auto rounded-md">
							<div class="min-w-max">
								<div class="grid sessions-grid font-main font-bold text-gray-8 text-sm sticky top-0 bg-gray-4">
									<div class="px-3 py-2">Session started</div>
									<div class="px-3 py-2">State</div>
									<div class="px-3 py-2"></div>
								</div>
								<div
									v-for="(sessionId, i) in sessions"
									:key="sessionId"
									class="grid sessions-grid items-center cursor-pointer font-mono text-sm text-white-0 hover:bg-gray-5"
									:class="i % 2 ? 'bg-gray-4' : 'bg-gray-3'"
									@click="openSession(sessionId)"
								>
									<div class="px-3 py-2">{{ formatSessionStart(sessionId) }}</div>
									<div class="px-3 py-2 font-bold" :class="sessionId === currentSessionID ? 'text-teal-4' : 'text-gray-7'">
										{{ sessionId === currentSessionID ? 'live' : 'ended' }}
									</div>
									<div class="px-3 py-2 flex items-center justify-end">
										<Spinner v-if="playersLoading && openSessionId === sessionId" class="h-4 w-4 text-teal-4" />
										<Icon v-else icon="external" color="text-white-1" size="4" />
									</div>
								</div>
							</div>
						</div>
					</div>
					<div v-if="canCapture" class="bg-gray-1 px-4 pb-4 pt-2 rounded-md mt-4">
						<p class="font-main font-bold text-gray-8 mb-2">ALL PLAYERS SNAPSHOT</p>
						<!-- <p class="font-main text-sm text-gray-6 mb-3">
							Capture every online player's inventory at this instant and download it as a file, or load
							a previously downloaded export to browse it here. Independent of archiving above &mdash;
							this is a one-off snapshot, not a stored record.
						</p> -->

						<div class="flex flex-col sm:flex-row sm:items-center gap-2">
							<FlexButton
								class="w-max"
								:variant="BTN_VARIANT.SECONDARY"
								leftIcon="download"
								leftIconSize="4"
								:disabled="exportBusy || !onlinePlayers.length"
								:loading="exportBusy"
								@input="captureExport"
							>
								{{ exportBusy ? 'CAPTURING…' : 'CAPTURE ALL & DOWNLOAD' }}
							</FlexButton>

							<FilePicker
								class=""
								v-model="importFile"
								accept="application/json,.json"
								:multiple="false"
								customLabel="CHOOSE SNAPSHOT TO VIEW"
							/>

							<p v-if="!exportBusy && !onlinePlayers.length" class="font-main text-sm text-gray-7 italic">
								No players online to capture.
							</p>
						</div>
					</div>
				</div>
			</template>
		</StatusTile>
		<!-- Browses a locally-loaded export from CAPTURE ALL & DOWNLOAD, entirely client-side. -->
		<Popup
			headerText="IMPORTED SNAPSHOT"
			bodyClass="h-11/12 w-11/12"
			:open="importPopupOpen"
			@xClicked="closeImportPopup"
		>
			<div class="p-2 contents sm:flex flex-col sm:flex-row gap-2 h-full min-h-0">
				<div class="w-full sm:w-72 shrink-0 flex flex-col gap-2 min-h-0 p-2 sm:p-0">
					<div class="bg-gray-2 border border-gray-5 rounded-xl p-2 flex flex-col min-h-0 max-h-1/4 sm:max-h-full">
						<p class="font-main font-bold text-gray-6 mb-2">PLAYERS</p>
						<p v-if="importData" class="font-main text-xs text-gray-7 mb-2">
							Captured {{ new Date(importData.capturedAt).toLocaleString() }}
						</p>
						<p v-if="importData?.truncated" class="font-main text-xs text-orange-4 italic mb-2">
							This capture hit the plugin's player cap — some players may be missing.
						</p>
						<p v-if="!importData?.players?.length" class="font-main text-gray-7 italic text-sm">
							No players in this export.
						</p>
						<div class="overflow-auto min-h-0 max-h-48 sm:max-h-full">
							<div
								v-for="player in importData?.players ?? []"
								:key="player.name"
								class="px-2 py-1 rounded cursor-pointer font-mono text-sm truncate"
								:class="player.name === importSelectedPlayer ? 'bg-blue-0 text-white-1' : 'text-white-0 hover:bg-gray-5'"
								@click="importSelectedPlayer = player.name"
							>
								{{ player.name }}
							</div>
						</div>
					</div>
				</div>

				<div class="grow overflow-auto min-h-0 px-2 pb-2 sm:p-0">
					<InventoryGrid :inventory="importSnapshot?.inventory ?? null">
						<template #header>
							<div class="flex items-center justify-between mb-2">
								<div class="flex items-center">
									<Icon v-if="importSelectedPlayer" icon="user" color="text-gray-6" size="4" />
									<p class="font-main font-bold text-gray-6 ml-2">
										{{ importSelectedPlayer ? importSelectedPlayer.toUpperCase() : 'IMPORTED SNAPSHOT' }}
									</p>
								</div>
								<p v-if="importData" class="font-main text-sm text-gray-7">
									{{ importData.instanceName || importData.instanceId }}
								</p>
							</div>
						</template>
						<template #status>
							<p v-if="importData && !importSnapshot" class="font-main text-gray-7 italic px-1 py-2">
								Select a player.
							</p>
						</template>
					</InventoryGrid>
				</div>
			</div>
		</Popup>

		<Popup
			:headerText="popupHeader"
			bodyClass="h-11/12 w-11/12"
			:open="popupOpen"
			@xClicked="popupOpen = false"
		>
			<div class="p-2 contents sm:flex flex-col sm:flex-row gap-2 h-full min-h-0">
				<!--
					Players and their captures share one scrolling column. Both lists are short, and the
					grid beside them needs every pixel it can get -- 350 slots at 34px is not negotiable.
				-->
				<div class="w-full sm:w-72 shrink-0 flex flex-col gap-2 min-h-0 p-2 sm:p-0">
					<div class="bg-gray-2 border border-gray-5 rounded-xl p-2 flex flex-col min-h-0 max-h-1/4 sm:max-h-full">
						<p class="font-main font-bold text-gray-6 mb-2">PLAYERS</p>
						<p v-if="sessionMeta?.worldFilePath" class="font-main text-xs text-gray-7 mb-2 break-all">
							{{ sessionMeta.worldFilePath.split('/').pop() }}
						</p>
						<p v-if="!playersLoading && !players.length" class="font-main text-gray-7 italic text-sm">
							No captures in this session.
						</p>
						<div class="overflow-auto min-h-0 max-h-24 sm:max-h-full">
							<div
								v-for="player in players"
								:key="player"
								class="px-2 py-1 rounded cursor-pointer font-mono text-sm truncate"
								:class="player === selectedPlayer ? 'bg-blue-0 text-white-1' : 'text-white-0 hover:bg-gray-5'"
								@click="selectPlayer(player)"
							>
								{{ player }}
							</div>
						</div>
					</div>

					<div v-if="selectedPlayer" class="bg-gray-2 border border-gray-5 rounded-xl p-2 flex flex-col grow min-h-0 max-h-1/4 overflow-y-auto sm:max-h-full">
						<p class="font-main font-bold text-gray-6 mb-2">CAPTURES</p>
						<div class="overflow-auto min-h-0 max-h-24 sm:max-h-full">
							<div
								v-for="capture in captures"
								:key="capture.snapshotId"
								class="px-2 py-1 rounded cursor-pointer font-mono text-xs flex items-center justify-between gap-2"
								:class="capture.snapshotId === selectedCapture?.snapshotId ? 'bg-blue-0 text-white-1' : 'text-white-0 hover:bg-gray-5'"
								@click="selectCapture(capture)"
							>
								<span>{{ new Date(capture.capturedAt).toLocaleString() }}</span>
								<span :class="capture.kind === 'leave' ? 'text-orange-4' : 'text-teal-4'">{{ capture.kind }}</span>
							</div>
						</div>
						<p v-if="capturesTruncated" class="font-main text-xs text-orange-4 italic mt-2">
							Too many captures to list; the most recent are not shown.
						</p>
					</div>
				</div>

				<div class="grow overflow-auto min-h-0 px-2 pb-2 sm:p-0">
					<InventoryGrid :inventory="snapshot?.player ?? null" :flagged-slots="flaggedSlots">
						<template #header>
							<div class="flex items-center justify-between mb-2">
								<div :class="['flex items-center']">
									<Icon v-if="selectedPlayer" icon="user" color="text-gray-6" size="4" />
									<p class="font-main font-bold text-gray-6 ml-2">
										{{ selectedPlayer ? selectedPlayer.toUpperCase() : 'SNAPSHOT' }}
									</p>
								</div>
								<p v-if="snapshot" class="font-main text-sm text-gray-7">
									{{ new Date(snapshot.capturedAt).toLocaleString() }} &mdash; {{ snapshot.kind }}
								</p>
							</div>
						</template>
						<template #status>
							<p v-if="snapshotLoading" class="font-main text-gray-7 italic px-1 py-2">Loading snapshot…</p>
							<p v-else-if="snapshotError" class="font-main text-red-5 px-1 py-2">{{ snapshotError }}</p>
							<p v-else-if="!snapshot" class="font-main text-gray-7 italic px-1 py-2">
								Select a player, then a capture.
							</p>
							<template v-else>
								<!--
									Distinct from "checked and clean". A capture taken while the rules were off was
									never judged, and presenting that as a pass would be a claim nobody made.
								-->
								<p v-if="!snapshot.evaluated" class="font-main text-gray-7 italic px-1 py-2">
									Item rules were not active when this was captured.
								</p>
								<p v-else-if="snapshot.offending?.length" class="font-main text-red-5 px-1 py-2">
									{{ snapshot.offending.length }} item{{ plural(snapshot.offending.length) }} broke the
									rules in force at capture time.
								</p>
								<p v-if="snapshot.stale" class="font-main text-orange-4 px-1 py-2 text-sm italic">
									SSC was disabled, so the state displayed is what was last synced with the server at capture time and may possibly be incorrect
								</p>
							</template>
						</template>
					</InventoryGrid>
				</div>
			</div>
		</Popup>
	</div>
</template>

<script>
import Checkbox from '@/components/common/Checkbox.vue';
import FilePicker from '@/components/common/FilePicker.vue';
import FlexButton from '@/components/common/FlexButton.vue';
import Icon from '@/components/common/Icon.vue';
import Popup from '@/components/common/Popup.vue';
import InventoryGrid from './basic/players/InventoryGrid.vue';
import { useServerStore } from '@/stores/serverStore';
import { useSpriteStore } from '@/stores/spriteStore';
import { BTN_VARIANT } from '@/util/constants';
import { plural } from '@/util/format';
import { PERMISSIONS } from '@/util/permissionValues';
import { downloadJson, slugForFilename } from '@/util/download';

/** Stamped on every export so a future format change can tell an old file from a new one. */
const EXPORT_FORMAT = "tte-inventory-snapshot-export";
const EXPORT_VERSION = 1;

const KINDS = [
	{ id: "join", label: "On join" },
	{ id: "leave", label: "On leave" },
];

/** `2026-08-13T18-22-10Z-000007` back into a Date. The id is the session's own start time. */
const parseSessionStart = (sessionId) => {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z/.exec(sessionId ?? "");
	if (!match) return null;
	const [, y, mo, d, h, mi, s] = match.map(Number);
	return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
};

const formatSession = (sessionId) => {
	const date = parseSessionStart(sessionId);
	return date ? date.toLocaleString() : null;
};

/**
 * Browses archived player inventory captures: server session, then player, then capture.
 *
 * The whole tree is read out of S3 prefixes, so nothing is held in the store beyond the session list
 * — a single session of a busy server is tens of megabytes of reports, and the point of the archive
 * is that it outlives what any browser could hold. Each level is fetched when it is opened.
 *
 * The grid itself is `InventoryGrid.vue`, shared with the live `PlayerInventory.vue` popup. That is
 * deliberate: a slot index has to mean the same square in both, or a violation recorded months ago
 * would highlight the wrong item here.
 */
export default {
	components: {
		Checkbox,
		FilePicker,
		FlexButton,
		Icon,
		InventoryGrid,
		Popup,
	},
	data() {
		return {
			PERMISSIONS,
			BTN_VARIANT,
			KINDS,

			serverStore: useServerStore(),
			spriteStore: useSpriteStore(),

			/** Local copy of the archive settings, so the checkboxes are editable before a save. */
			draft: { enabled: false, kinds: ["join"] },
			savingArchive: false,

			popupOpen: false,
			openSessionId: null,
			sessionMeta: null,
			players: [],
			playersLoading: false,

			selectedPlayer: null,
			captures: [],
			capturesTruncated: false,
			capturesLoading: false,

			selectedCapture: null,
			snapshot: null,
			snapshotLoading: false,
			snapshotError: "",

			/** True while `captureAllInventories`'s single request is in flight. */
			exportBusy: false,

			/**
			 * A parsed export file, and the popup browsing it. Held only client-side — no network.
			 * `importFile` is `FilePicker`'s v-model; the watcher below reads it the moment it's set and
			 * resets it back to null once handled, so the picker returns to its default state rather than
			 * showing a stale "1 file(s)" panel behind the popup that just opened.
			 */
			importFile: null,
			importPopupOpen: false,
			importData: null, // { instanceId, instanceName, capturedAt, players: [{ name, inventory }], truncated }
			importSelectedPlayer: null,
		};
	},
	computed: {
		selectedInstance() {
			return this.serverStore.selectedInstanceID;
		},
		canWrite() {
			return this.$checkPermissions(PERMISSIONS.server.player.inventory.snapshots.write);
		},
		/** Gates the whole EXPORT / IMPORT panel — same permission a live inventory read needs. */
		canCapture() {
			return this.$checkPermissions(PERMISSIONS.server.player.inventory.read);
		},
		/** Nicknames currently online, straight off the roster this page already polls. */
		onlinePlayers() {
			return this.serverStore.selectedServerData.players ?? [];
		},
		/** The uploaded export's currently-selected player, or null. */
		importSnapshot() {
			return this.importData?.players.find(player => player.name === this.importSelectedPlayer) ?? null;
		},
		archiveState() {
			return this.serverStore.getSnapshotArchive(this.selectedInstance);
		},
		archiveConfigured() {
			return Boolean(this.archiveState?.configured);
		},
		sessions() {
			return this.archiveState?.sessions ?? [];
		},
		currentSessionID() {
			return this.archiveState?.currentSessionID ?? null;
		},
		sessionsLoading() {
			return this.serverStore.isLoadingSnapshotSessions(this.selectedInstance);
		},
		/** Enables SAVE only once something actually differs from what the server holds. */
		archiveDirty() {
			const stored = this.archiveState?.archive;
			if (!stored) return true;
			return stored.enabled !== this.draft.enabled
				|| [...(stored.kinds ?? [])].sort().join() !== [...this.draft.kinds].sort().join();
		},
		popupHeader() {
			const started = formatSession(this.openSessionId);
			return started ? `SNAPSHOTS — SESSION OF ${started}` : "SNAPSHOTS";
		},
		/**
		 * Positions to ring, from the verdict recorded at capture time rather than from the rules as
		 * they stand now. Re-evaluating here would answer a different question than the one that was
		 * asked, against a list that may have changed several times since.
		 */
		flaggedSlots() {
			const flagged = new Set();
			for (const item of this.snapshot?.offending ?? []) {
				flagged.add(`${item.container}::${item.slot}`);
			}
			return flagged;
		},
	},
	methods: {
		plural,
		formatSessionStart(sessionId) {
			return formatSession(sessionId) ?? sessionId;
		},
		toggleKind(kind) {
			const next = this.draft.kinds.includes(kind)
				? this.draft.kinds.filter(entry => entry !== kind)
				: [...this.draft.kinds, kind];

			// The backend rejects an empty list rather than silently archiving nothing, so the last
			// checkbox does not come off — matching that rule here means the error never has to be shown.
			if (!next.length) return;
			this.draft.kinds = next;
		},
		async fetchSessions() {
			if (!this.selectedInstance) return;

			try {
				const state = await this.serverStore.fetchSnapshotSessions(this.selectedInstance);
				if (state?.archive) {
					this.draft = { enabled: Boolean(state.archive.enabled), kinds: [...(state.archive.kinds ?? ["join"])] };
				}
			} catch (e) {
				this.$alert.error("Failed to load archived snapshot sessions");
				console.error(e);
			}
		},
		async saveArchive() {
			await this.$validatePermissions(PERMISSIONS.server.player.inventory.snapshots.write);
			if (this.savingArchive) return;

			this.savingArchive = true;
			try {
				await this.serverStore.saveArchiveSettings(this.selectedInstance, this.draft);
				this.$alert.success(this.draft.enabled ? "Snapshot archiving enabled" : "Snapshot archiving disabled");
			} catch (e) {
				this.$alert.error(e?.message || "Failed to save archive settings");
				console.error(e);
			} finally {
				this.savingArchive = false;
			}
		},
		async openSession(sessionId) {
			if (this.playersLoading) return;

			this.openSessionId = sessionId;
			this.playersLoading = true;
			this.resetPlayerSelection();
			this.players = [];
			this.sessionMeta = null;

			try {
				const data = await this.serverStore.fetchSnapshotPlayers(this.selectedInstance, sessionId);
				this.players = data.players || [];
				this.sessionMeta = data.session || null;
				this.popupOpen = true;
			} catch (e) {
				this.$alert.error("Failed to load this session's players");
				console.error(e);
			} finally {
				this.playersLoading = false;
			}
		},
		async selectPlayer(player) {
			if (this.capturesLoading) return;

			this.selectedPlayer = player;
			this.captures = [];
			this.capturesTruncated = false;
			this.selectedCapture = null;
			this.snapshot = null;
			this.snapshotError = "";
			this.capturesLoading = true;

			try {
				const data = await this.serverStore.fetchSnapshotList(
					this.selectedInstance,
					this.openSessionId,
					player
				);
				this.captures = data.snapshots || [];
				this.capturesTruncated = Boolean(data.truncated);
			} catch (e) {
				this.$alert.error("Failed to load captures for this player");
				console.error(e);
				return;
			} finally {
				this.capturesLoading = false;
			}

			// Opening a player almost always means wanting their most recent capture, and the list is
			// newest-first, so the first row is the one to show.
			if (this.captures.length) {
				this.selectCapture(this.captures[0]);
			}
		},
		async selectCapture(capture) {
			if (this.snapshotLoading) return;

			this.selectedCapture = capture;
			this.snapshotLoading = true;
			this.snapshotError = "";

			try {
				this.snapshot = await this.serverStore.fetchSnapshot(
					this.selectedInstance,
					this.openSessionId,
					this.selectedPlayer,
					capture
				);
			} catch (e) {
				// Inline rather than an alert: the popup is where the user is looking, and the common
				// case — a capture the 30-day lifecycle rule has since deleted — names its own fix.
				this.snapshot = null;
				this.snapshotError = e?.status === 404
					? "This snapshot is no longer available. Archived captures are kept for 30 days."
					: (e?.message || "Failed to load this snapshot");
			} finally {
				this.snapshotLoading = false;
			}
		},
		resetPlayerSelection() {
			this.selectedPlayer = null;
			this.captures = [];
			this.capturesTruncated = false;
			this.selectedCapture = null;
			this.snapshot = null;
			this.snapshotError = "";
		},
		/**
		 * Reads every online player's live inventory in one call and downloads the lot as one JSON
		 * file. A point-in-time export, not archiving — nothing here touches S3 or the archive row
		 * above, so it works identically whether or not archiving is configured.
		 */
		async captureExport() {
			this.$validatePermissions(PERMISSIONS.server.player.inventory.read);
			if (this.exportBusy) return;

			// A pre-check against the roster this page already polls, purely to skip a pointless
			// request — the capture itself asks the plugin who is online, not this list.
			if (!this.onlinePlayers.length) {
				this.$alert.warning("No players are online to capture");
				return;
			}

			this.exportBusy = true;

			try {
				const result = await this.serverStore.captureAllInventories(this.selectedInstance);

				if (!result.players.length) {
					this.$alert.error("Failed to capture any player inventories");
					return;
				}

				const instanceName = this.serverStore.instances.find(i => i.id === this.selectedInstance)?.name;
				downloadJson(`inventory-snapshot_${slugForFilename(instanceName || this.selectedInstance)}_${result.capturedAt}.json`, {
					format: EXPORT_FORMAT,
					version: EXPORT_VERSION,
					instanceId: this.selectedInstance,
					instanceName: instanceName || null,
					capturedAt: result.capturedAt,
					players: result.players,
					truncated: result.truncated,
				});

				if (result.truncated) {
					this.$alert.warning(`Captured ${result.players.length} players — hit the plugin's player cap, some may be missing`);
				} else {
					this.$alert.success(`Captured ${result.players.length} player${plural(result.players.length)}`);
				}
			} catch (e) {
				this.$alert.error(e?.message || "Failed to capture inventories");
				console.error(e);
			} finally {
				this.exportBusy = false;
			}
		},
		/**
		 * Loads a previously downloaded export and opens it for browsing. Entirely local — parsing a
		 * file the operator picked is not a network read, so this needs no permission check of its own
		 * beyond the panel already being gated on `inventory.read` to reach the picker at all.
		 *
		 * Driven by the `importFile` watcher rather than a native `@change`: `FilePicker`'s `:multiple`
		 * is `false` here — an export is one JSON document, and picking several would wrongly imply
		 * this views more than one at once — so it hands back a single `File` (or null), never an array.
		 * Its own "PICKED FILE" panel is what shows the operator something happened, so there's nothing
		 * left for this method to render before the popup opens.
		 */
		onImportFile(file) {
			if (!file) return;

			const reader = new FileReader();
			reader.onload = () => {
				let parsed;
				try {
					parsed = JSON.parse(reader.result);
				} catch {
					this.$alert.error("That file isn't valid JSON");
					this.importFile = null;
					return;
				}

				if (!Array.isArray(parsed?.players) || !parsed.players.every(p => p?.name && p?.inventory?.containers)) {
					this.$alert.error("That file doesn't look like an inventory snapshot export");
					this.importFile = null;
					return;
				}

				this.importData = parsed;
				this.importSelectedPlayer = parsed.players[0]?.name ?? null;
				this.importPopupOpen = true;
				// Reset now that the popup has the data, so the picker is ready for the next file rather
				// than showing a stale "1 file(s)" panel behind the popup.
				this.importFile = null;
				// Idempotent, and the grid needs it the moment the popup opens.
				this.spriteStore.loadAtlas();
			};
			reader.onerror = () => {
				this.$alert.error("Failed to read the file");
				this.importFile = null;
			};
			reader.readAsText(file);
		},
		closeImportPopup() {
			this.importPopupOpen = false;
			this.importData = null;
			this.importSelectedPlayer = null;
		},
	},
	mounted() {
		if (this.selectedInstance && this.$checkPermissions(PERMISSIONS.server.player.inventory.snapshots.read)) {
			this.fetchSessions();
			// Idempotent, and the grid needs it the moment a capture is opened.
			this.spriteStore.loadAtlas();
		}
	},
	watch: {
		selectedInstance(value) {
			this.popupOpen = false;
			this.openSessionId = null;
			this.players = [];
			this.resetPlayerSelection();
			if (value && this.$checkPermissions(PERMISSIONS.server.player.inventory.snapshots.read)) {
				this.fetchSessions();
			}
		},
		/**
		 * `importFile` is `FilePicker`'s v-model, so this fires both when the operator picks a file and
		 * when `onImportFile` resets it back to null when done — guarded to only act on the former.
		 */
		importFile(value) {
			if (value) this.onImportFile(value);
		},
	},
};
</script>

<style scoped>
.sessions-grid {
	grid-template-columns: minmax(12rem, 2fr) minmax(5rem, 1fr) minmax(3rem, auto);
}
</style>
