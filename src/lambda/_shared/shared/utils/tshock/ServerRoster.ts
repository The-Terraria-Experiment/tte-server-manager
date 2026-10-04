/**
 * The in-game roster out of a `/v2/server/status?players=true` response, with `playercount` derived
 * from it so the two can never disagree.
 *
 * TShock computes them from different sets. `playercount` is `GetActivePlayerCount()` — slots that
 * are `Active && FinishedHandshake` — while `players` is every non-null `TShock.Players` slot, which
 * includes connections that haven't finished joining: a player mid-connect, a half-open socket, a
 * health-check probe on the game port. So the list could only ever run *ahead* of the count, and the
 * Players tile showed "2 players online" over three chips. Each entry carries TShock's own `active`
 * flag, which is what separates the two.
 *
 * An entry with no `active` field is kept: the contract only requires `nickname`, and a control mod
 * that omits the flag reports only in-game players to begin with. A nameless entry is dropped as
 * well, since a chip with no name can be neither read nor clicked.
 */
export function inGameRoster(status: Record<string, any> | null | undefined): { playercount: number; players: any[] } | null {
	if (!Array.isArray(status?.players)) {
		return null;
	}

	const players = status!.players.filter((player: any) =>
		player?.active !== false && typeof player?.nickname === "string" && player.nickname.length > 0
	);

	return { playercount: players.length, players };
}
