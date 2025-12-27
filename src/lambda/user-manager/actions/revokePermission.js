/**
 * Revoke permission from a user
 */

const { successResponse, validationError } = require('../../shared/utils/response');

async function handle(event) {
  const body = JSON.parse(event.body || '{}');
  const { targetUserSub, resource, action } = body;
  
  if (!targetUserSub || !resource || !action) {
    return validationError('targetUserSub, resource, and action are required');
  }

  // TODO: Remove permission entry from DynamoDB PermissionEntries table
  
  // TODO: Log this admin action to ToolLogs table

  return successResponse({ message: 'Permission revoked', targetUserSub, resource, action });
}

module.exports = { handle };
