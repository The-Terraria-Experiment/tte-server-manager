/**
 * TShock REST API helper
 */

const { getSecret } = require('../shared/utils/aws');

/**
 * Call TShock REST API with authentication
 */
async function callTShockAPI(serverId, endpoint, data = null) {
  // TODO: Get TShock token from Secrets Manager
  // const token = await getSecret(process.env.TSHOCK_SECRET_NAME);
  
  // TODO: Get server endpoint from DynamoDB or config
  // const serverUrl = `http://${serverIp}:7878`;
  
  // TODO: Make HTTP request with token header
  // const response = await fetch(`${serverUrl}${endpoint}`, {
  //   method: data ? 'POST' : 'GET',
  //   headers: { 'X-Token': token, 'Content-Type': 'application/json' },
  //   body: data ? JSON.stringify(data) : undefined,
  // });
  
  // TODO: Return parsed response
  return { status: 'ok' };
}

module.exports = { callTShockAPI };
