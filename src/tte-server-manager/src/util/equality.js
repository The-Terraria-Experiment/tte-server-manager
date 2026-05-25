export const deepObjsEqual = (obj1, obj2) => {
	if (obj1 === obj2) {
		return true;
	}

	if (obj1 == null || obj2 == null) {
		return obj1 === obj2;
	}

	if (typeof obj1 !== "object" || typeof obj2 !== "object") {
		return false;
	}

	if (Array.isArray(obj1) !== Array.isArray(obj2)) {
		return false;
	}

	if (obj1 instanceof Date || obj2 instanceof Date) {
		return (
			obj1 instanceof Date &&
			obj2 instanceof Date &&
			obj1.getTime() === obj2.getTime()
		);
	}

	if (obj1 instanceof RegExp || obj2 instanceof RegExp) {
		return (
			obj1 instanceof RegExp &&
			obj2 instanceof RegExp &&
			obj1.toString() === obj2.toString()
		);
	}

	const keys1 = Object.keys(obj1);
	const keys2 = Object.keys(obj2);

	if (keys1.length !== keys2.length) {
		return false;
	}

	for (const key of keys1) {
		if (!Object.prototype.hasOwnProperty.call(obj2, key)) {
			return false;
		}

		if (!deepObjsEqual(obj1[key], obj2[key])) {
			return false;
		}
	}

	return true;
};
