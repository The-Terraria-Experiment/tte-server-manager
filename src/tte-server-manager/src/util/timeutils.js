/**
 * Calculate the elapsed time since a given Date
 * @param {Date} date - The starting date to measure from
 * @returns {Object} Object containing days, hours, minutes, and seconds elapsed
 */
export function getElapsedTime(date) {
	const now = new Date();
	const elapsed = new Date(now - date);

	return getValueAsComponents(elapsed);
}

export function getTimeUntil(date) {
	const now = new Date();
	const timeUntil = new Date(date - now);

	return getValueAsComponents(timeUntil);
}

export function getDateOffset(offset) {
	return new Date(Date.now() + offset);
}

export function getValueAsComponents(date) {
	const value = date.valueOf();

	const seconds = Math.floor(value / 1000) % 60;
	const minutes = Math.floor(value / (1000 * 60)) % 60;
	const hours = Math.floor(value / (1000 * 60 * 60)) % 24;
	const days = Math.floor(value / (1000 * 60 * 60 * 24));

	return {
		days,
		hours,
		minutes,
		seconds,
	};
}