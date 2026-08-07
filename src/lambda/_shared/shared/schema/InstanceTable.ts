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
	/**
	 * Which environments this instance is registered in — the replacement for the old
	 * `EC2_INSTANCE_IDS` / `AUTO_SHUTOFF_SERVER_IDS_*` env vars. An array rather than a single
	 * value because the EC2 fleet is physically shared, so an instance may legitimately serve both.
	 *
	 * Absent or empty means "registered nowhere": the row can exist without a registration, because
	 * setup.sh's register step seeds validRoots/metricsConfig on a fresh box before any admin has
	 * chosen which environments it belongs to.
	 */
	envs?: string[],
	/** EC2 Name tag captured at registration. Display fallback for when DescribeInstances can't see the instance. */
	name?: string,
	registeredAt?: string,
	registeredBy?: string,
	validRoots?: Record<string, string>,
	worldPaths?: string[],
	metricsConfig?: InstanceMetricsConfigEntry
};
