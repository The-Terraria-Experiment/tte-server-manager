/**
 * Grant permission to a user
 */

const { putDynamoItem } = require('../../shared/utils/dynamo');
const { successResponse, validationError } = require('../../shared/utils/response');

async function handle(event) {
  const body = JSON.parse(event.body || '{}');
  const { targetUserSub, resource, action } = body;
  
  if (!targetUserSub || !resource || !action) {
    return validationError('targetUserSub, resource, and action are required');
  }

  // TODO: Add permission entry to DynamoDB PermissionEntries table
  // PK: tenant#<id>, SK: perm#<resource>#<action>#<userSub>
  
  // TODO: Log this admin action to ToolLogs table

  return successResponse({ message: 'Permission granted', targetUserSub, resource, action });
}

module.exports = { handle };
