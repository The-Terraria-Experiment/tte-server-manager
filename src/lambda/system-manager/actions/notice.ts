import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { SYSTEM_TABLE } from "../shared/vars.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";

type NoticeBody = {
	message?: string;
	disableSite?: boolean;
};

export const notice = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as NoticeBody;
	const sysMsgKey = process.env.SYS_MSG_KEY;
	if (!sysMsgKey) {
		throw new Error("Missing SYS_MSG_KEY");
	}
	const DB = new DynamoDao();

	await DB.UpdateItem(SYSTEM_TABLE, sysMsgKey, {
		updates: {
			enabled: !body.disableSite,
			message: body.message,
		},
	});

	return ResponseUtil.Success({ success: true });
};