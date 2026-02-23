const PERM_TABLE = process.env.PERM_TABLE || "ttesm-user-perms";
const FUNC_NAMES = {
	USER_MGR: "ttesm-user-manager",
	INST_MGR: "ttesm-instance-manager",
	SERV_MGR: "ttesm-server-manager",
	COG_LINK: "ttesm-cognito-user-link",
	SYS_MGR: "ttesm-system-manager",
};
const CW_LOG_GENERAL = "ttesm-actions-general";

module.exports = {
	PERM_TABLE,
	FUNC_NAMES,
	CW_LOG_GENERAL,
}