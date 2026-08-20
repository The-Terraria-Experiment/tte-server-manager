export const BTN_VARIANT = {
	PRIMARY: 'btn_variant_primary',
	SECONDARY: 'btn_variant_secondary',
	DANGER: 'btn_variant_danger',
	SUBTLE: 'btn_variant_subtle'
};
export const ACTIVE_DATE_VARIANT = {
	ELAPSED_COMPACT: "active_date_elapsed_compact",
	COUNTDOWN: "active_date_countdown"
};
export const INSTANCE_STATES = {
	"STARTING": "STARTING",
	"ONLINE": "ONLINE",
	"SHUTTING_DOWN": "SHUTTING DOWN",
	"TERMINATED": "TERMINATED",
	"STOPPING": "STOPPING",
	"OFFLINE": "OFFLINE",
};
/**
 * EC2's own state names, as the instance list and status endpoints report them, mapped to the
 * labels this app shows. Shared rather than component-local so the Instance page and the Overview
 * fleet cards cannot disagree about what a state is called.
 */
export const EC2_STATE_LABELS = {
	"pending": INSTANCE_STATES.STARTING,
	"running": INSTANCE_STATES.ONLINE,
	"shutting-down": INSTANCE_STATES.SHUTTING_DOWN,
	"terminated": INSTANCE_STATES.TERMINATED,
	"stopping": INSTANCE_STATES.STOPPING,
	"stopped": INSTANCE_STATES.OFFLINE,
};
/** Registry rows EC2 no longer knows about. Synthesised by the backend, never returned by AWS. */
export const EC2_STATE_MISSING = "missing";
/** Which instance the user last picked, remembered across sessions. */
export const DEFAULT_INSTANCE_LS_KEY = "last-picked-instance";
export const WORLD_STATES = {
	OFFLINE: "OFFLINE",
	RUNNING: "RUNNING",
	CREATING: "CREATING WORLD",
	LAUNCHING: "LAUNCHING",
	STOPPING: "STOPPING",
	UNKNOWN: "UNKNOWN"
};
