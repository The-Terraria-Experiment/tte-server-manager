/**
 * Get current user's effective permissions
 */

const { successResponse } = require('../../shared/utils/response');

async function handle(event) {
  const userSub = event.requestContext?.authorizer?.claims?.sub;
  
  // TODO: Query DynamoDB for user's permissions and roles
  // TODO: Expand roles to effective permissions
  
  const permissions = {
    instance: ['read', 'write'],
    server: ['read', 'execute'],
    user: ['read'],
    file: ['read', 'write'],
  };

  return successResponse({ permissions, userSub });
}

module.exports = { handle };
