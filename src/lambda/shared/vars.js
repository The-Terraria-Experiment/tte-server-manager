const PERM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-user-perms" : "ttesm-user-perms-stage";
const SYSTEM_TABLE = process.env.ACTIVE_ENV === "prod" ? "ttesm-system" : "ttesm-system-stage";

module.exports = {
	PERM_TABLE,
	SYSTEM_TABLE
}