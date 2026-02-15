const PERM_TABLE = "ttesm-user-perms";
const FUNC_NAMES = {
	USER_MGR: "ttesm-user-manager-prod",
	INST_MGR: "ttesm-instance-manager-prod",
	SERV_MGR: "ttesm-server-manager-prod",
	COG_LINK: "ttesm-cognito-user-link-prod",
	SYS_MGR: "ttesm-system-manager-prod",
};
const CW_LOG_GENERAL = "ttesm-actions-general";

module.exports = {
	PERM_TABLE,
	FUNC_NAMES,
	CW_LOG_GENERAL,
}