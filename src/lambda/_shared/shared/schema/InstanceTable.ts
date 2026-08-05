import type { MetricsConfig } from "../utils/InstanceMetrics.js";

/**
 * Desired state for the on-instance metrics collector, plus who applied it.
 * Stored rather than read live so the UI can render without an SSM round trip
 * (and so a stopped instance still shows its config), and so a rebuilt box can
 * pick its settings back up during setup.
 */
export type InstanceMetricsConfigEntry = MetricsConfig & {
	appliedAt?: string,
	appliedBy?: string
};

export type InstanceDataEntry = {
	uid?: string,
	updatedAt?: string,
	validRoots?: Record<string, string>,
	worldPaths?: string[],
	metricsConfig?: InstanceMetricsConfigEntry
};
