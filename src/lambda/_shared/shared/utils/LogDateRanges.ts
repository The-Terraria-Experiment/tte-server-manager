/**
 * Pure date-range helpers for daily-rotating log files. No knowledge of any particular log
 * source (TShock, system services, etc.) — safe to reuse for any log type keyed by calendar date.
 */

export function isoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** Today plus `daysBack` prior calendar days (UTC), most recent first. */
export function getRecentDates(daysBack = 1): string[] {
	const dates: string[] = [];
	for (let i = 0; i <= daysBack; i++) {
		dates.push(isoDate(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
	}
	return dates;
}

/** Every calendar date (UTC) between startDate and endDate (inclusive), most recent first. */
export function enumerateDateRangeDesc(startDate: string, endDate: string): string[] {
	const dates: string[] = [];
	const cursor = new Date(`${endDate}T00:00:00Z`);
	const start = new Date(`${startDate}T00:00:00Z`);
	while (cursor >= start) {
		dates.push(isoDate(cursor));
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}
	return dates;
}
