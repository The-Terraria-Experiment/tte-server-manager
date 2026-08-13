import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { listItemPresets, toPresetSummary } from "../shared/utils/jobs/ItemPresets.js";

/**
 * The site-wide preset library, as summaries.
 *
 * Entries are deliberately omitted — the editor fetches those one preset at a time, when the operator
 * actually loads one. Returning them here would put the whole library on the wire every time the
 * rules editor is opened, to render a dropdown of names.
 */
export const readItemPresets = async (event: AuthorizedEvent, context: Context) => {
	void event;
	void context;

	const presets = await listItemPresets();

	return ResponseUtil.Success({ entries: presets.map(toPresetSummary) });
};
