/**
 * List all users in the system
 */

const { queryDynamo } = require('../../shared/utils/dynamo');
const { successResponse } = require('../../shared/utils/response');

async function handle(event) {
  // TODO: Query DynamoDB UserData table for all users
  // Return list with sub, email, roles, etc.
  
  const users = [
    // Example: { sub: 'uuid', email: 'user@example.com', roles: ['admin'] }
  ];

  return successResponse({ users });
}

module.exports = { handle };
