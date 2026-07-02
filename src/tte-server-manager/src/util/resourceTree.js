/**
 * Builds/flattens the CheckboxList-compatible tree for resource permissions,
 * driven by the descriptor registry in resourceDefinitions.js.
 *
 * Node shape matches checkboxTree.js's convention ({id, value, children,
 * payload} for leaves, {id, children, payload} for parents), so
 * getNodeValue/setNodeValue/filterLeaves/mergeTreeUpdates from checkboxTree.js
 * work unchanged on these trees.
 *
 * Two differences from the PermissionsMeta tree mean flattening/serializing
 * needs its own logic instead of reusing checkboxTree.js's flattenLeaves:
 * - A resource leaf's `id` is a structural key only, not itself a resource
 *   string - the token(s) it controls live in `payload.tokens`, since one
 *   leaf (e.g. "Instance Access") can expand to multiple tokens
 *   (instance::id + server::id).
 * - checkboxTree.js's getNodeValue ignores a node's own `value` whenever it
 *   has `children`, so a level with both real children (path roots) and its
 *   own grant (getOwnTokens) represents its "own" grant as a synthetic leaf
 *   child placed beside the real children, rather than an independent value
 *   on the parent.
 * - Each child descriptor's items are wrapped in an intermediate group node
 *   labeled with that descriptor's `groupLabel` (e.g. "Path Roots"), so it's
 *   visually clear what kind of resource those checkboxes represent - rather
 *   than flattening every child type's items directly into the parent's
 *   children, which would make e.g. a bare path root name indistinguishable
 *   from some future unrelated child resource type.
 */

function buildResourceNode(def, item, ctx, checkedSet, disabled, idPrefix, parentItem) {
	const id = `${idPrefix}${def.key}:${def.getId(item)}`;
	const label = def.getLabel(item);
	const ownTokens = def.getOwnTokens ? def.getOwnTokens(item, parentItem) : [];
	const childDefs = def.children || [];
	const childGroups = childDefs
		.map(childDef => ({ childDef, items: childDef.getItems(ctx, item) || [] }))
		.filter(group => group.items.length);

	if (!childGroups.length) {
		return {
			id,
			value: ownTokens.length > 0 && ownTokens.every(t => checkedSet.has(t)),
			disabled,
			payload: { label, tokens: ownTokens },
		};
	}

	const children = [];
	if (ownTokens.length) {
		children.push({
			id: `${id}:own`,
			value: ownTokens.every(t => checkedSet.has(t)),
			disabled,
			payload: { label: def.ownLabel || `(${label} Access)`, tokens: ownTokens },
		});
	}
	childGroups.forEach(({ childDef, items }) => {
		const groupId = `${id}.${childDef.key}`;
		children.push({
			id: groupId,
			disabled,
			payload: { label: childDef.groupLabel || childDef.key },
			children: items.map(childItem => buildResourceNode(childDef, childItem, ctx, checkedSet, disabled, `${groupId}.`, item)),
		});
	});

	return { id, disabled, children, payload: { label } };
}

/**
 * Builds one CheckboxList node array per top-level ResourceDefinitions entry,
 * keyed by that entry's `key`, mirroring buildPermissionTree's per-group shape.
 */
export function buildResourceTree(definitions, context, checkedTokens = [], disabled = false) {
	const checkedSet = checkedTokens instanceof Set ? checkedTokens : new Set(checkedTokens);
	return Object.fromEntries(definitions.map(def => [
		def.key,
		(def.getItems(context) || []).map(item => buildResourceNode(def, item, context, checkedSet, disabled, '', undefined)),
	]));
}

/**
 * Flattens a resource node list down to its leaf checkboxes as
 * { id, value, tokens } entries.
 */
export function flattenResourceLeaves(nodes, result = []) {
	for (const node of nodes) {
		if (node.children) {
			flattenResourceLeaves(node.children, result);
		} else {
			result.push({ id: node.id, value: node.value === true, tokens: node.payload?.tokens || [] });
		}
	}
	return result;
}

/**
 * Collapses a resource node list down to the deduped, flat list of granted
 * resource token strings.
 */
export function resourceTreeToTokens(nodes) {
	return Array.from(new Set(
		flattenResourceLeaves(nodes).filter(leaf => leaf.value).flatMap(leaf => leaf.tokens)
	));
}
