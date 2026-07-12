const pfx = "Allows users to ";
export const PermissionsMeta = {
	access: {value: "access", description: pfx + "access to the site as a whole"},
	server: {
		list: {value: "server.list", description: "", used: false},
		world: {
			list: {value: "server.world.list", description: pfx + "view available existing worlds"},
			create: {value: "server.world.create", description: pfx + "generate a new Terraria world"},
			launch: {value: "server.world.launch", description: pfx + "launch existing Terraria worlds"},
			delete: {value: "server.world.delete", description: "", used: false},
		},
		tshock: {
			execute: {value: "server.tshock.execute", description: pfx + "execute TShock commands"},
		},
		config: {
			read: {value: "server.config.read", description: pfx + "read TShock config files (both the main one and plugin configs)"},
			write: {value: "server.config.write", description: pfx + "edit TShock config files (both the main one and plugin configs)"},
		},
		status: {
			read: {value: "server.status.read", description: pfx + "view the online status of any running Terraria server"},
			stop: {value: "server.status.stop", description: pfx + "stop any running Terraria server"},
			autoshutoff: {
				cancel: {value: "server.status.autoshutoff.cancel", description: pfx + "cancel an in-progress auto shutoff"},
				pause: {value: "server.status.autoshutoff.pause", description: pfx + "pause auto shutoff arbitrarily"},
			}
		},
		player: {
			read: {value: "server.player.read", description: pfx + "read detailed information about online players on Terraria servers", used: false},
			ban: {value: "server.player.ban", description: pfx + "ban online players from Terraria servers, as well as manage existing bans"},
			kick: {value: "server.player.kick", description: pfx + "kick online players from Terraria servers"},
			kill: {value: "server.player.kill", description: pfx + "kill online players on Terraria servers"},
			mute: {value: "server.player.mute", description: pfx + "mute online players on Terraria servers"},
			inventory: {
				read: {value: "server.player.inventory.read", description: pfx + "read all information about an online player's Terraria inventory", used: false},
			},
		},
		logs: {
			players: {
				read: {value: "server.logs.players.read", description: pfx + "fetch and browse player logs"},
				ips: {
					read: {value: "server.logs.players.ips.read", description: pfx + "view the IP address data of player logs"},
				},
			},
			tshock: {
				read: {value: "server.logs.tshock.read", description: pfx + "view and search TShock logs"},
			}
		},
	},
	instance: {
		list: {value: "instance.list", description: pfx + "fetch the list of available instances"},
		status: {
			read: {value: "instance.status.read", description: pfx + "view the online status of instances"},
			start: {value: "instance.status.start", description: pfx + "launch instances"},
			stop: {value: "instance.status.stop", description: pfx + "shut down instances"},
			restart: {value: "instance.status.restart", description: pfx + "reboot instances"},
		},
		metrics: {
			read: {value: "instance.metrics.read", description: "", used: false},
		},
		files: {
			read: {value: "instance.files.read", description: pfx + "view and download all files on the instance"},
			write: {value: "instance.files.write", description: pfx + "upload, delete, and sync instance files"},
			paths: {
				read: {value: "instance.files.paths.read", description: pfx + "view the instance filepath safelist"},
				write: {value: "instance.files.paths.write", description: pfx + "edit the instance filepath safelist"},
			},
		},
	},
	users: {
		list: {value: "users.list", description: "", used: false},
		delete: {value: "users.delete", description: pfx + "delete other user accounts"},
		permissions: {
			read: {value: "users.permissions.read", description: pfx + "view the permissions granted to each site user"},
			write: {value: "users.permissions.write", description: pfx + "edit permissions for site users"},
		},
		logs: {
			read: {value: "users.logs.read", description: "", used: false},
		},
	},
	system: {
		dropcache: {value: "system.dropcache", description: pfx + "drop internal system caches"},
		notice: {
			create: {value: "system.notice.create", description: pfx + "create site-wide notifications"},
			clear: {value: "system.notice.clear", description: pfx + "remove site-wide notifications"},
			bypass: {value: "system.notice.bypass", description: pfx + "bypass the lockdown imposed by notifications that disable the site"},
		},
	},
};
/**
 * Converts a single PermissionsMeta entry into a CheckboxList node. Leaves are
 * identified by having a string `value`; everything else is a parent node
 * whose children are its own entries.
 */
function metaToNode(key, meta, idPrefix, checkedSet, readonly) {
	const id = idPrefix ? `${idPrefix}.${key}` : key;

	if (typeof meta.value === 'string') {
		const checked = checkedSet.has(meta.value);
		const unused = meta.used === false;
		return {
			id,
			value: checked,
			// Unused permissions stay read-only so new ones can't be granted, but
			// an already-granted "ghost" permission remains editable so it can be
			// removed. The `unused` flag drives the "Show unused permissions" filter.
			disabled: readonly || (unused && !checked),
			unused,
			payload: { ...meta, label: key }
		};
	}

	return {
		id,
		disabled: readonly,
		children: Object.entries(meta).map(([childKey, childMeta]) => metaToNode(childKey, childMeta, id, checkedSet, readonly)),
		payload: { label: key }
	};
}

/**
 * Builds the CheckboxList node array for a single 1st-descendant group of
 * PermissionsMeta (e.g. PermissionsMeta.server), rooted at `groupKey`.
 * `checkedValues` (array or Set of granted permission strings) seeds which
 * leaves start checked.
 */
export function buildPermissionTree(metaGroup, groupKey, checkedValues = [], readonly = false) {
	const checkedSet = checkedValues instanceof Set ? checkedValues : new Set(checkedValues);
	return metaToNode(groupKey, metaGroup, undefined, checkedSet, readonly).children;
}

/**
 * todo:
 * - cascading checkbox list
 * - roles are not defining (users are not saved with roles, they have a role if they have the permissions for it)
 * - when applying a role to a user, it will simply fill in the remaining perms needed for that role
 * - show additional perms outside role rules (keep role definitions narrow and prefer more roles over expansive roles)
 * - when updating a role, auto-update perms for all users who currently qualify for that role
 * - get a batch save method for pete's sake
 * - resource permissions will be mostly the same
 */