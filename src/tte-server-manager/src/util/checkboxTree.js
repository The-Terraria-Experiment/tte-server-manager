/**
 * Helpers for the recursive checkbox-tree control structure used by CheckboxList.vue.
 * Node shape: { id, value: boolean, disabled?, payload? } for leaves,
 * or { id, children: Node[], disabled?, payload? } for parents (whose own
 * value is derived from their children rather than stored directly).
 */

/**
 * Effective value of a single node: boolean for leaves, true/false/null
 * (null = indeterminate) for parents based on their children.
 */
export function getNodeValue(node) {
	if (node.children) {
		return getAggregateValue(node.children);
	}
	return node.value === true;
}

/**
 * Tri-state aggregate of a list of sibling nodes: true if all are checked,
 * false if all are unchecked, null if mixed.
 */
export function getAggregateValue(children) {
	if (!children.length) return false;

	let hasTrue = false;
	let hasFalse = false;

	for (const child of children) {
		const value = getNodeValue(child);
		if (value === true) hasTrue = true;
		else hasFalse = true;

		if (value === null || (hasTrue && hasFalse)) return null;
	}

	return hasTrue;
}

/**
 * Returns a new node with the given boolean value cascaded down to every
 * leaf beneath it (or set directly if it is already a leaf).
 */
export function setNodeValue(node, value) {
	if (node.children) {
		return { ...node, children: node.children.map(child => setNodeValue(child, value)) };
	}
	return { ...node, value };
}

/**
 * Flattens a node list down to its leaf checkboxes as { id, value } pairs.
 */
export function flattenLeaves(nodes, result = []) {
	for (const node of nodes) {
		if (node.children) {
			flattenLeaves(node.children, result);
		} else {
			result.push({ id: node.id, value: node.value === true });
		}
	}
	return result;
}

/**
 * Returns a copy of the tree containing only leaves matching `predicate`,
 * dropping any parent node left with no children once its leaves are filtered.
 */
export function filterLeaves(nodes, predicate) {
	const result = [];
	for (const node of nodes) {
		if (node.children) {
			const filteredChildren = filterLeaves(node.children, predicate);
			if (filteredChildren.length) {
				result.push({ ...node, children: filteredChildren });
			}
		} else if (predicate(node)) {
			result.push(node);
		}
	}
	return result;
}

/**
 * Re-applies edits from a (possibly filtered) `updatedNodes` tree back onto
 * `originalNodes`, leaving nodes absent from `updatedNodes` (e.g. ones hidden
 * by filterLeaves) untouched instead of dropping them.
 */
export function mergeTreeUpdates(originalNodes, updatedNodes) {
	const updatedById = new Map(updatedNodes.map(node => [node.id, node]));
	return originalNodes.map(node => {
		const updated = updatedById.get(node.id);
		if (!updated) return node;
		if (node.children) {
			return { ...node, children: mergeTreeUpdates(node.children, updated.children || []) };
		}
		return updated;
	});
}
