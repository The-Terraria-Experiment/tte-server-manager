/**
 * Returns all leaf values in an arbitrarily nested object
 * @param {Object} object Object to traverse
 */
export default function leaves(object) {
	const result = [];

	function traverse(value) {
		// Handle null and primitives
		if (value === null || typeof value !== "object") {
			result.push(value);
			return;
		}

		// Handle arrays
		if (Array.isArray(value)) {
			if (value.length === 0) {
				result.push(value);
			} else {
				value.forEach(traverse);
			}
			return;
		}

		// Handle objects
		const keys = Object.keys(value);
		if (keys.length === 0) {
			result.push(value);
		} else {
			keys.forEach((key) => traverse(value[key]));
		}
	}

	traverse(object);
	return result;
}
