import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { CognitoDao } from "../shared/aws/Cognito.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { USER_ARCHIVE_TABLE, COGNITO_USER_POOL_ID, PERM_TABLE } from "../shared/vars.js";
import { Parsers } from "../shared/utils/core/Parsers.js";
import { ResponseUtil } from "../shared/utils/core/APIResponse.js";
import { Permissions } from "../shared/utils/core/Perms.js";

type DeleteUserBody = {
	userID?: string;
};

interface UserRecord {
	uid?: string;
	sub?: string;
	username?: string;
	displayName?: string;
	createdAt?: string;
	lastLogin?: string;
}

export const deleteUser = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const body = (event.parsedBody || {}) as DeleteUserBody;
	if (!body.userID) {
		return ResponseUtil.ValidationError("Missing required field: userID");
	}

	const requestingUserSub = Parsers.GetUserSub(event);
	if (!requestingUserSub) {
		return ResponseUtil.PermissionDeniedError("Unauthorized: No user context");
	}

	if (body.userID === `user#${requestingUserSub}`) {
		return ResponseUtil.ValidationError("Cannot delete your own account");
	}

	const DB = new DynamoDao();
	const existing = (await DB.GetItem(PERM_TABLE, body.userID)) as UserRecord | null;
	if (!existing) {
		return ResponseUtil.NotFoundError("User");
	}

	// Archive the trimmed record before touching Cognito or the live table, so a failure
	// partway through never leaves us without the retained fields.
	const archived = await DB.PutItem(USER_ARCHIVE_TABLE, {
		uid: body.userID,
		sub: existing.sub ?? null,
		displayName: existing.displayName ?? "",
		createdAt: existing.createdAt ?? null,
		lastLogin: existing.lastLogin ?? null,
		deletedAt: new Date().toISOString(),
	});

	if (!archived) {
		return ResponseUtil.Error("Failed to write archive record", 500, "ARCHIVE_WRITE_FAILED");
	}

	if (existing.username) {
		if (!COGNITO_USER_POOL_ID) {
			return ResponseUtil.Error("Cognito user pool is not configured", 500, "CONFIG_ERROR");
		}

		const cognitoDeleted = await new CognitoDao().AdminDeleteUser(COGNITO_USER_POOL_ID, existing.username);
		if (!cognitoDeleted) {
			return ResponseUtil.Error("Failed to delete Cognito account", 500, "COGNITO_DELETE_FAILED");
		}
	}

	const removed = await DB.DeleteItem(PERM_TABLE, body.userID);
	if (!removed) {
		return ResponseUtil.Error("Failed to remove user record", 500, "DELETE_FAILED");
	}

	await Permissions.BumpPermissionCacheVersion();

	await CWLogger.Action(FUNC_NAMES.USER_MGR, {
		userId: requestingUserSub,
		action: "delete-user",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { deletedUser: body.userID },
	});

	return ResponseUtil.Success({ userID: body.userID, deleted: true });
};
