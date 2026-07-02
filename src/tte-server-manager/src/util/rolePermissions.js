/**
 * Helpers for summarizing a Role's flat permission list against PermissionsMeta.
 */

/**
 * Recursively walks a single PermissionsMeta entry, collapsing it into a
 * `"<prefix>.*"` line if every grantable (non `used: false`) leaf beneath it
 * is present in `grantedSet`. Leaves marked `used: false` are skipped
 * entirely - they never block a wildcard collapse and never appear in output.
 */
function walkRoleMeta(key, meta, idPrefix, grantedSet) {
	const id = idPrefix ? `${idPrefix}.${key}` : key;

	if (typeof meta.value === 'string') {
		if (meta.used === false) return { coveredAll: true, hasGrantable: false, lines: [] };
		const granted = grantedSet.has(meta.value);
		return { coveredAll: granted, hasGrantable: true, lines: granted ? [meta.value] : [] };
	}

	const childResults = Object.entries(meta).map(([childKey, childMeta]) => walkRoleMeta(childKey, childMeta, id, grantedSet));
	const hasGrantable = childResults.some(r => r.hasGrantable);
	const coveredAll = childResults.every(r => r.coveredAll);

	if (hasGrantable && coveredAll) {
		return { coveredAll: true, hasGrantable: true, lines: [`${id}.*`] };
	}
	return { coveredAll, hasGrantable, lines: childResults.flatMap(r => r.lines) };
}

/**
 * Summarizes a role's flat permission list against PermissionsMeta, collapsing
 * any subcategory that is fully granted into a single `"<prefix>.*"` entry.
 * Returns a sorted, flat array mixing literal permission strings and `*`-collapsed ones.
 */
export function summarizeRolePermissions(permissions, permissionsMeta) {
	const grantedSet = permissions instanceof Set ? permissions : new Set(permissions);
	const lines = Object.entries(permissionsMeta)
		.flatMap(([key, meta]) => walkRoleMeta(key, meta, undefined, grantedSet).lines);

	return lines.sort();
}

/**
 * A user "has" a role if every permission that role grants is present in the
 * user's own flat permission list - roles aren't stored per-user, they're
 * derived by matching. Roles with no permissions never match.
 */
function roleMatches(role, grantedSet) {
	return (role.permissions || []).length > 0 && role.permissions.every(p => grantedSet.has(p));
}

/**
 * Returns the subset of `roles` that `permissions` satisfies.
 */
export function getMatchedRoles(permissions, roles) {
	const grantedSet = permissions instanceof Set ? permissions : new Set(permissions);
	return (roles || []).filter(role => roleMatches(role, grantedSet));
}

/**
 * Returns the permissions in `permissions` that aren't explained by any role
 * the user qualifies for - i.e. permissions granted outside of role coverage.
 */
export function getUncoveredPermissions(permissions, roles) {
	const grantedSet = permissions instanceof Set ? permissions : new Set(permissions);
	const covered = new Set(getMatchedRoles(grantedSet, roles).flatMap(role => role.permissions));
	return Array.from(grantedSet).filter(p => !covered.has(p));
}

/**
 * Returns a new flat permission array with `role`'s permissions merged in.
 */
export function addRolePermissions(permissions, role) {
	return Array.from(new Set([...(permissions || []), ...(role.permissions || [])]));
}

/**
 * Returns a new flat permission array with `role` removed. Permissions from
 * `role` are only stripped if no other role the user still qualifies for
 * also requires them - removing one role won't silently break another.
 */
export function removeRolePermissions(permissions, role, allRoles) {
	const grantedSet = permissions instanceof Set ? permissions : new Set(permissions);
	const otherMatchedRoles = (allRoles || []).filter(r => r.roleId !== role.roleId && roleMatches(r, grantedSet));
	const stillNeeded = new Set(otherMatchedRoles.flatMap(r => r.permissions));
	const roleValues = new Set(role.permissions || []);

	return Array.from(grantedSet).filter(p => !roleValues.has(p) || stillNeeded.has(p));
}
