/**
 * A collection of simple assertion helpers
 */


function assertIsTruthy(condition, failMessage) {
	if (!Boolean(condition)) {
		throw new Error(failMessage);
	}
}

function assertIsTrue(condition, failMessage) {
	if (condition !== true) {
		throw new Error(failMessage);
	}
}

function assertIsString(value, failMessage) {
	if (typeof value !== 'string' && !(value instanceof String)) {
		throw new Error(failMessage);
	}
}

function assertIsTruthyString(value, failMessage) {
	assertIsTruthy(value, failMessage);
	assertIsString(value, failMessage);
}

function assertObjectHasKey(object, key, failMessage) {
	if (!Object.hasOwn(object, key)) {
		throw new Error(failMessage);
	}
}

function assertObjectHasKeys(object, keys, failMessage) {
	try {
		keys.forEach(key => {
			assertObjectHasKey(object, key);
		});
	} catch {
		throw new Error(failMessage);
	}
}

function assertObjectHasTruthyKey(object, key, failMessage) {
	if (!Object.hasOwn(object, key) || !object[key]) {
		throw new Error(failMessage);
	}
}

function assertObjectHasTruthyKeys(object, keys, failMessage) {
	try {
		keys.forEach(key => {
			assertObjectHasTruthyKey(object, key);
		});
	} catch {
		throw new Error(failMessage);
	}
}

function assertSome(assertions, failMessage) {
	let success = 0;
	assertions.forEach(assertion => {
		try {
			assertion();
			success++;
		} catch (e) {}
	});

	if (!success) {
		throw new Error(failMessage);
	}
}

module.exports = {
	assertIsTruthy,
	assertIsTrue,
	assertIsString,
	assertIsTruthyString,
	assertObjectHasKey,
	assertObjectHasKeys,
	assertObjectHasTruthyKey,
	assertObjectHasTruthyKeys,
	assertSome,
};
