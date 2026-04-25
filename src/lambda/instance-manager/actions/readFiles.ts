import type { Context } from "aws-lambda";
import type { AuthorizedEvent } from "../../../shared/types/APIGatewayTypes.js";
import { FUNC_NAMES } from "../shared/constants.js";
import { CWLogger } from "../shared/aws/CloudWatch.js";
import { DynamoDao } from "../shared/aws/DynamoDB.js";
import { S3Dao } from "../shared/aws/S3.js";
import { ResponseUtil } from "../shared/utils/APIResponse.js";
import { Permissions } from "../shared/utils/Permissions.js";
import { Parsers } from "../shared/utils/Parsers.js";

const S3 = new S3Dao();
const DB = new DynamoDao();

export const readFiles = async (event: AuthorizedEvent, context: Context) => {
	void context;

	const instanceId = event.pathParameters?.id;
    if (!instanceId) {
        return ResponseUtil.NotFoundError("Instance ID");
    }

	await Permissions.ValidateResourceAccess(event, `instance::${instanceId}`);

	const bucketName = process.env.S3_FILESTORE_NAME;
    if (!bucketName) {
        throw new Error("S3_FILESTORE_NAME environment variable not set");
    }

	const files = await S3.ListObjects(bucketName, `${instanceId}/`);
	const instanceData = await DB.GetItem(process.env.INSTANCE_TABLE_NAME as string, `inst#${instanceId}`);
	const pathRoots = instanceData?.validRoots || [];
	const worldPaths = instanceData?.worldPaths || [];

	await CWLogger.Action(FUNC_NAMES.INST_MGR, {
		userId: Parsers.GetUserSub(event),
		action: "read-files",
		status: "ok",
		resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
		details: { files, pathRoots, worldPaths },
	});

	return ResponseUtil.Success({ files, pathRoots, worldPaths });
};
