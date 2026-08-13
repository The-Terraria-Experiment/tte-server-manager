import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { readItemPresetRow } from "../shared/utils/jobs/ItemPresets.js";

/** One preset in full, including its entries — what the editor loads into its draft. */
export const readItemPreset = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const presetId = event.pathParameters?.presetId;
	if (!presetId) {
		return ResponseUtil.ValidationError("Preset ID is required");
	}

	const preset = await readItemPresetRow(presetId);
	if (!preset) {
		return ResponseUtil.NotFoundError("Preset");
	}

	return ResponseUtil.Success({
		preset: {
			presetId: preset.presetId ?? presetId,
			name: preset.name ?? "",
			mode: preset.mode ?? "blacklist",
			groups: preset.groups ?? [],
			entries: preset.entries ?? [],
			createdAt: preset.createdAt ?? null,
			updatedAt: preset.updatedAt ?? null,
			updatedBy: preset.updatedBy ?? null,
		},
	});
};
