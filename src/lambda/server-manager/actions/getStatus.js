/**
 * Get specific server status via TShock REST API
 */

const { callTShockAPI } = require('./tshockApi');
const { successResponse, notFoundError } = require('../../shared/utils/response');

async function handle(event) {
  const serverId = event.pathParameters?.id;
  
  if (!serverId) {
    return notFoundError('Server ID');
  }

  // TODO: Get server config/endpoint from DynamoDB
  // TODO: Call TShock API /v2/server/status or similar
  const status = await callTShockAPI(serverId, '/v2/server/status');

  return successResponse({ server: status });
}

module.exports = { handle };
