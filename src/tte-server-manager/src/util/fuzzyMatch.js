function levenshteinDistance(a, b) {
	if (a === b) return 0;
	if (!a) return b.length;
	if (!b) return a.length;

	const dp = Array(b.length + 1).fill(0);
	for (let j = 0; j <= b.length; j++) dp[j] = j;

	for (let i = 1; i <= a.length; i++) {
		let prev = dp[0];
		dp[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const temp = dp[j];
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[j] = Math.min(
				dp[j] + 1, // deletion
				dp[j - 1] + 1, // insertion
				prev + cost, // substitution
			);
			prev = temp;
		}
	}
	return dp[b.length];
}

export function similarity(a, b) {
	const dist = levenshteinDistance(a, b);
	const maxLen = Math.max(a.length, b.length);
	return maxLen === 0 ? 1 : 1 - dist / maxLen;
}
