/**
 * Calculate the elapsed time since a given Date
 * @param {Date} date - The starting date to measure from
 * @returns {Object} Object containing days, hours, minutes, and seconds elapsed
 */
export function getElapsedTime(date) {
	const now = new Date();
	const elapsed = now - date;

	const seconds = Math.floor(elapsed / 1000) % 60;
	const minutes = Math.floor(elapsed / (1000 * 60)) % 60;
	const hours = Math.floor(elapsed / (1000 * 60 * 60)) % 24;
	const days = Math.floor(elapsed / (1000 * 60 * 60 * 24));

	return {
		days,
		hours,
		minutes,
		seconds,
	};
}
