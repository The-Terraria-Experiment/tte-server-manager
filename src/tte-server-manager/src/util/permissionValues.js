export const PERMISSIONS = {
	access: "access",
	server: {
		list: "server.list",
		world: {
			list: "server.world.list",
			create: "server.world.create",
			delete: "server.world.delete",
			launch: "server.world.launch",
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
			stop: "server.status.stop",
			autoshutoff: {
				cancel: "server.status.autoshutoff.cancel",
				pause: "server.status.autoshutoff.pause",
			},
		},
		player: {
			read: "server.player.read",
			ban: "server.player.ban",
			kick: "server.player.kick",
			kill: "server.player.kill",
			mute: "server.player.mute",
			inventory: {
				read: "server.player.inventory.read",
				rules: {
					read: "server.player.inventory.rules.read",
					write: "server.player.inventory.rules.write",
				},
				violations: {
					read: "server.player.inventory.violations.read",
				},
			},
		},
		logs: {
			players: {
				read: "server.logs.players.read",
				ips: {
					read: "server.logs.players.ips.read",
				},
			},
			tshock: {
				read: "server.logs.tshock.read",
			}
		}
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
			write: "instance.metrics.write",
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
		delete: "users.delete",
		permissions: {
			read: "users.permissions.read",
			write: "users.permissions.write",
		},
		logs: {
			read: "users.logs.read",
		}
	},
	system: {
		dropcache: "system.dropcache",
		notice: {
			create: "system.notice.create",
			clear: "system.notice.clear",
			bypass: "system.notice.bypass",
		},
		instances: {
			list: {
				read: "system.instances.list.read",
				write: "system.instances.list.write",
			}
		}
	}
}
