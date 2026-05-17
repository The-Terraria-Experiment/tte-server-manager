import { DynamoDao } from "../aws/DynamoDB.js";
import { SYSTEM_TABLE, WORLD_CREATE_KEY } from "../vars.js";

export class CleanupUtil {
	public static async ClearWorldCreationStatus(instanceID: string): Promise<void>
	{
		const DB = new DynamoDao();

		await DB.DeleteItem(SYSTEM_TABLE, `${WORLD_CREATE_KEY}#${instanceID}`);
	}
}
