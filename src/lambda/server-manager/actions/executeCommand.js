/**
 * Execute command on TShock server via REST API
 */

const { callTShockAPI } = require('./tshockApi');
const { successResponse, validationError } = require('../shared/utils/response');

async function handle(event) {
  const serverId = event.pathParameters?.id;
  const body = JSON.parse(event.body || '{}');
  const { command } = body;
  
  if (!serverId) {
    return validationError('Server ID is required');
  }
  
  if (!command) {
    return validationError('Command is required');
  }

  // TODO: Call TShock API to execute command
  // Endpoint: POST /v3/server/rawcmd with token from Secrets Manager
  const result = await callTShockAPI(serverId, '/v3/server/rawcmd', { cmd: command });

  return successResponse({ result });
}

module.exports = { handle };
