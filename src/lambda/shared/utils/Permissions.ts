import type { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDao } from "../aws/DynamoDB.js";
import { CWLogger } from "../aws/CloudWatch.js";
import { Parsers } from "./Parsers.js";
import { Assert } from "./Assert.js";
import { CW_LOG_GENERAL } from "../constants.js";
import { PERM_TABLE, SYSTEM_TABLE } from "../vars.js";

export interface UserPermissionData {
	uid?: string;
	permissions?: string[];
	resourceAccess?: string[];
}

export class PermissionsDao {
	private static readonly dynamoDao = new DynamoDao();
	private static readonly userCache = new Map<string, UserPermissionData>();
	private static readonly PERMISSION_CACHE_VERSION_UID = "cache#permissions";
	private static readonly PERMISSION_CACHE_VERSION_POLL_MS = Number(
		process.env.PERMISSION_CACHE_VERSION_POLL_MS || 30 * 1000,
	);

	private static lastSeenCacheVersion: string | null = null;
	private static lastVersionCheckAt = 0;

	/**
	 * Refresh cache version if needed
	 * Invalidates user cache if version has changed
	 */
	private static async RefreshCacheVersionIfNeeded(): Promise<void> {
		const now = Date.now();
		if (
			PermissionsDao.lastSeenCacheVersion !== null &&
			now - PermissionsDao.lastVersionCheckAt < PermissionsDao.PERMISSION_CACHE_VERSION_POLL_MS
		) {
			return;
		}

		PermissionsDao.lastVersionCheckAt = now;
		const cacheVersionItem = await PermissionsDao.dynamoDao.GetItem(
			SYSTEM_TABLE,
			PermissionsDao.PERMISSION_CACHE_VERSION_UID,
		);
		const currentVersion = String(cacheVersionItem?.version || "0");

		if (PermissionsDao.lastSeenCacheVersion === null) {
			PermissionsDao.lastSeenCacheVersion = currentVersion;
			return;
		}

		if (PermissionsDao.lastSeenCacheVersion !== currentVersion) {
			PermissionsDao.dropCache();
			PermissionsDao.lastSeenCacheVersion = currentVersion;
		}
	}

	/**
	 * Bump permission cache version to invalidate all user caches
	 * @returns New cache version identifier
	 */
	public static async BumpPermissionCacheVersion(): Promise<string> {
		const newVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const updatedAt = new Date().toISOString();

		const updated = await PermissionsDao.dynamoDao.UpdateItem(SYSTEM_TABLE, PermissionsDao.PERMISSION_CACHE_VERSION_UID, {
			updates: {
				version: newVersion,
				updatedAt,
			},
		});

		if (!updated) {
			throw new Error("Failed to bump permission cache version");
		}

		PermissionsDao.dropCache();
		PermissionsDao.lastSeenCacheVersion = newVersion;
		PermissionsDao.lastVersionCheckAt = Date.now();

		return newVersion;
	}

	/**
	 * Validate user has permission for resource/action
	 * @param event - API Gateway event (contains requestContext.authorizer)
	 * @param permission - Permission to validate
	 * @throws Error if permission denied
	 */
	public static async ValidatePermission(event: APIGatewayProxyEvent, permission: string): Promise<void> {
		Assert.IsTruthyString(permission, "validatePermission requires permission value");
		Assert.IsTruthy(event, "validatePermission requires a Gateway event");

		const userSub = Parsers.GetUserSub(event);
		if (!userSub) {
			await CWLogger.Action(CW_LOG_GENERAL, {
				userId: userSub ?? "unknown",
				action: "attempt-perm-check",
				status: "401",
				resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
				details: { permRequired: permission },
			});

			throw new Error("Unauthorized: No user context");
		}

		const permitted = await PermissionsDao.CheckPermission(userSub, permission);
		if (!permitted) {
			await CWLogger.Action(CW_LOG_GENERAL, {
				userId: userSub ?? "unknown",
				action: "attempt-perm-check",
				status: "403",
				resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
				details: { permRequired: permission },
			});

			throw new Error(`Permission denied to <${userSub}> for resource <${event.httpMethod} ${event.resource}>`);
		}
	}

	/**
	 * Check if user has specific permission
	 * @param userSub - User subject identifier
	 * @param permission - Permission to check
	 * @returns True if user has permission, false otherwise
	 */
	public static async CheckPermission(userSub: string, permission: string): Promise<boolean> {
		Assert.IsTruthyString(userSub, "userSub required");
		Assert.IsTruthyString(permission, "permission required");

		await PermissionsDao.RefreshCacheVersionIfNeeded();

		if (!PermissionsDao.userCache.has(userSub)) {
			const userData = (await PermissionsDao.dynamoDao.GetItem(PERM_TABLE, `user#${userSub}`)) as
				| UserPermissionData
				| null;
			PermissionsDao.userCache.set(userSub, userData || {});
		}

		const item = PermissionsDao.userCache.get(userSub);

		if (!item || !item.permissions) return false;

		const existingPerms = new Set(item.permissions || []);
		return existingPerms.has(permission);
	}

	/**
	 * Validate user has access to resource
	 * @param event - API Gateway event (contains requestContext.authorizer)
	 * @param resource - Resource to validate (e.g., 'instance::i-123', 'server::srv-456')
	 * @throws Error if permission denied
	 */
	public static async ValidateResourceAccess(event: APIGatewayProxyEvent, resource: string): Promise<void> {
		Assert.IsTruthyString(resource, "validateResourceAccess requires resource value");
		Assert.IsTruthy(event, "validateResourceAccess requires a Gateway event");

		const userSub = Parsers.GetUserSub(event);
		if (!userSub) {
			await CWLogger.Action(CW_LOG_GENERAL, {
				userId: userSub ?? "unknown",
				action: "attempt-resource-check",
				status: "401",
				resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
				details: { resourceRequested: resource },
			});

			throw new Error("Unauthorized: No user context");
		}

		const permitted = await PermissionsDao.CheckResourceAccess(userSub, resource);
		if (!permitted) {
			await CWLogger.Action(CW_LOG_GENERAL, {
				userId: userSub ?? "unknown",
				action: "attempt-resource-check",
				status: "403",
				resource: `${event.httpMethod ?? "unknown method"}: ${event.path ?? "unknown path"}`,
				details: { resourceRequested: resource },
			});

			throw new Error(`Permission denied to <${userSub}> for resource [${resource}]`);
		}
	}

	/**
	 * Check if user has access to resource
	 * @param userSub - User subject identifier
	 * @param resource - Resource to check (e.g., 'instance::i-123')
	 * @returns True if user has resource access, false otherwise
	 */
	public static async CheckResourceAccess(userSub: string, resource: string): Promise<boolean> {
		Assert.IsTruthyString(userSub, "userSub required");
		Assert.IsTruthyString(resource, "resource required");

		await PermissionsDao.RefreshCacheVersionIfNeeded();

		if (!PermissionsDao.userCache.has(userSub)) {
			const userData = (await PermissionsDao.dynamoDao.GetItem(PERM_TABLE, `user#${userSub}`)) as
				| UserPermissionData
				| null;
			PermissionsDao.userCache.set(userSub, userData || {});
		}

		const item = PermissionsDao.userCache.get(userSub);

		if (!item || !item.resourceAccess) return false;

		const existingResourcePerms = new Set(item.resourceAccess || []);
		return existingResourcePerms.has(resource);
	}

	/**
	 * Clear all cached user permission data
	 */
	public static dropCache(): void {
		PermissionsDao.userCache.clear();
	}
}
