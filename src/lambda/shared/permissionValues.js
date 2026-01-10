const PERMISSIONS = {
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
		}
	}
}

module.exports = { PERMISSIONS };