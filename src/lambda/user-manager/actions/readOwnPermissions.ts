import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { Parsers } from "../shared/utils/Parsers.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { PERM_TABLE } from "../shared/vars.js";

export const readOwnPermissions = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const userSub = Parsers.GetUserSub(event);

	if (!userSub) {
		return ResponseUtil.Success({ entries: [] });
	}

	const DB = new DynamoDao();
	const userPermissions = await DB.GetItem(PERM_TABLE, `user#${userSub}`);

	return ResponseUtil.Success({ entries: userPermissions || [] });
}
