/**
 * Get specific user details
 */

const { getDynamoItem } = require('../../shared/utils/dynamo');
const { successResponse, notFoundError } = require('../../shared/utils/response');

async function handle(event) {
  const userSub = event.pathParameters?.id;
  
  if (!userSub) {
    return notFoundError('User ID');
  }

  // TODO: Get user from DynamoDB UserData table
  // const user = await getDynamoItem(process.env.DYNAMO_TABLE_USERS, { PK: `user#${userSub}` });

  return successResponse({ user: { sub: userSub, roles: [] } });
}

module.exports = { handle };
