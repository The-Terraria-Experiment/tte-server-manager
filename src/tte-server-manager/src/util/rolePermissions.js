/**
 * Helpers for summarizing a Role's flat permission list against PermissionsMeta,
 * and for matching/merging a Role's permissions + resourceAccess against a
 * user's own grants.
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
 * A user "has" a role if every permission and every resource token that role
 * grants is present in the user's own flat grants - roles aren't stored
 * per-user, they're derived by matching. A role with no requirements in
 * either array never matches.
 */
function roleMatches(role, grantedPermSet, grantedResourceSet) {
	const permReqs = role.permissions || [];
	const resReqs = role.resourceAccess || [];
	if (permReqs.length === 0 && resReqs.length === 0) return false;
	return permReqs.every(p => grantedPermSet.has(p)) && resReqs.every(r => grantedResourceSet.has(r));
}

/**
 * Returns the subset of `roles` that `permissions`/`resourceAccess` satisfies.
 */
export function getMatchedRoles(permissions, resourceAccess, roles) {
	const grantedPermSet = permissions instanceof Set ? permissions : new Set(permissions);
	const grantedResourceSet = resourceAccess instanceof Set ? resourceAccess : new Set(resourceAccess);
	return (roles || []).filter(role => roleMatches(role, grantedPermSet, grantedResourceSet));
}

/**
 * Returns the permissions in `permissions` that aren't explained by any role
 * the user qualifies for - i.e. permissions granted outside of role coverage.
 */
export function getUncoveredPermissions(permissions, resourceAccess, roles) {
	const grantedPermSet = permissions instanceof Set ? permissions : new Set(permissions);
	const matchedRoles = getMatchedRoles(permissions, resourceAccess, roles);
	const covered = new Set(matchedRoles.flatMap(role => role.permissions || []));
	return Array.from(grantedPermSet).filter(p => !covered.has(p));
}

/**
 * Returns the resource tokens in `resourceAccess` that aren't explained by any
 * role the user qualifies for - i.e. resource grants outside of role coverage.
 */
export function getUncoveredResourceAccess(permissions, resourceAccess, roles) {
	const grantedResourceSet = resourceAccess instanceof Set ? resourceAccess : new Set(resourceAccess);
	const matchedRoles = getMatchedRoles(permissions, resourceAccess, roles);
	const covered = new Set(matchedRoles.flatMap(role => role.resourceAccess || []));
	return Array.from(grantedResourceSet).filter(r => !covered.has(r));
}

/**
 * Returns new flat permissions/resourceAccess arrays with `role`'s grants
 * merged in.
 */
export function addRoleGrants(permissions, resourceAccess, role) {
	return {
		permissions: Array.from(new Set([...(permissions || []), ...(role.permissions || [])])),
		resourceAccess: Array.from(new Set([...(resourceAccess || []), ...(role.resourceAccess || [])])),
	};
}

/**
 * Returns new flat permissions/resourceAccess arrays with `role` removed.
 * Grants from `role` are only stripped if no other role the user still
 * qualifies for also requires them - removing one role won't silently break
 * another.
 */
export function removeRoleGrants(permissions, resourceAccess, role, allRoles) {
	const grantedPermSet = permissions instanceof Set ? permissions : new Set(permissions);
	const grantedResourceSet = resourceAccess instanceof Set ? resourceAccess : new Set(resourceAccess);
	const otherMatchedRoles = (allRoles || []).filter(r => r.roleId !== role.roleId && roleMatches(r, grantedPermSet, grantedResourceSet));

	const stillNeededPerms = new Set(otherMatchedRoles.flatMap(r => r.permissions || []));
	const rolePermValues = new Set(role.permissions || []);
	const stillNeededResources = new Set(otherMatchedRoles.flatMap(r => r.resourceAccess || []));
	const roleResourceValues = new Set(role.resourceAccess || []);

	return {
		permissions: Array.from(grantedPermSet).filter(p => !rolePermValues.has(p) || stillNeededPerms.has(p)),
		resourceAccess: Array.from(grantedResourceSet).filter(r => !roleResourceValues.has(r) || stillNeededResources.has(r)),
	};
}
