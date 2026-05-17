export const PERMISSIONS = {
	access: "access",
	server: {
		list: "server.list",
		world: {
			list: "server.world.list",
			create: "server.world.create",
			select: "server.world.select",
			delete: "server.world.delete",
		},
		tshock: {
			execute: "server.tshock.execute",
		},
		config: {
			read: "server.config.read",
			write: "server.config.write",
		},
		status: {
			read: "server.status.read",
			start: "server.status.start",
			stop: "server.status.stop",
		},
		player: {
			read: "server.player.read",
			ban: "server.player.ban",
			kick: "server.player.kick",
			kill: "server.player.kill",
			mute: "server.player.mute",
			inventory: {
				read: "server.player.inventory.read",
			},
		},
	},
	instance: {
		list: "instance.list",
		status: {
			read: "instance.status.read",
			start: "instance.status.start",
			stop: "instance.status.stop",
			restart: "instance.status.restart",
		},
		metrics: {
			read: "instance.metrics.read",
		},
		files: {
			read: "instance.files.read",
			write: "instance.files.write",
			paths: {
				read: "instance.files.paths.read",
				write: "instance.files.paths.write",
			},
		},
	},
	users: {
		list: "users.list",
		permissions: {
			read: "users.permissions.read",
			write: "users.permissions.write",
		},
		logs: {
			read: "users.logs.read",
		},
	},
	system: {
		dropcache: "system.dropcache",
		notice: {
			create: "system.notice.create",
			clear: "system.notice.clear",
			bypass: "system.notice.bypass",
		},
	},
} as const;

type PermissionTree = {
	[key: string]: string | PermissionTree;
};

type LeafValues<T> = T extends string
	? T
	: T extends Record<string, unknown>
		? LeafValues<T[keyof T]>
		: never;

export type PermissionValue = LeafValues<typeof PERMISSIONS>;

function flattenPermissionTree(tree: PermissionTree): string[] {
	const flattened: string[] = [];
	for (const value of Object.values(tree)) {
		if (typeof value === "string") {
			flattened.push(value);
		} else {
			flattened.push(...flattenPermissionTree(value));
		}
	}
	return flattened;
}

export const ALL_PERMISSIONS = flattenPermissionTree(PERMISSIONS) as PermissionValue[];

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is PermissionValue {
	return PERMISSION_SET.has(value);
}
