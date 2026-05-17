import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

export const clearnotice = async (event: AuthorizedEvent, context: Context) => {
	void event;
	void context;

	const sysMsgKey = process.env.SYS_MSG_KEY;
	if (!sysMsgKey) {
		throw new Error("Missing SYS_MSG_KEY");
	}
	const DB = new DynamoDao();

	await DB.UpdateItem(SYSTEM_TABLE, sysMsgKey, {
		updates: {
			enabled: true,
			message: "",
		},
	});

	return ResponseUtil.Success({ success: true });
};