/**
 * The contract versions this backend is written against — the `contractVersion` at the top of each
 * file in `docs/contracts/`. **Bump these with the documents**; a doc change that doesn't touch this
 * file leaves the check below comparing against the old version.
 *
 * Only the *major* part is compared: a minor bump is additive by definition (see
 * `docs/contracts/README.md`, "Versioning"), so an implementation a minor behind or ahead still works.
 */
export const EXPECTED_CONTRACT_VERSIONS: Readonly<Record<string, string>> = {
	"control-rest": "1.1",
	"inventory-monitor": "1.1",
	"event-push": "1.0",
};

const majorOf = (version: string): number | null => {
	const major = Number(String(version).split(".")[0]);
	return Number.isInteger(major) ? major : null;
};

/**
 * One human-readable line per contract the server reports at a different *major* version than this
 * backend expects, from the `contractVersions` map on `/v2/server/status`. Empty when everything
 * agrees, or when the server reports nothing at all — TShock doesn't, and absent means the 1.0
 * baseline. Contracts this backend doesn't know are ignored rather than flagged.
 */
export function contractWarnings(reported: unknown): string[] {
	if (!reported || typeof reported !== "object" || Array.isArray(reported)) {
		return [];
	}

	const warnings: string[] = [];
	for (const [name, version] of Object.entries(reported as Record<string, unknown>)) {
		const expected = EXPECTED_CONTRACT_VERSIONS[name];
		if (!expected || typeof version !== "string") continue;

		const actualMajor = majorOf(version);
		if (actualMajor !== null && actualMajor !== majorOf(expected)) {
			warnings.push(`${name}: the server implements ${version}, this site expects ${expected}`);
		}
	}
	return warnings;
}
