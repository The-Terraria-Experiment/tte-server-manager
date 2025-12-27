/**
 * List all game servers with status
 */

const { successResponse } = require('../../shared/utils/response');

async function handle(event) {
  // TODO: Get list of server configs from DynamoDB or env
  // TODO: Query TShock REST API for status of each server
  
  const servers = [
    // Example structure:
    // { id: 'srv-1', name: 'Main World', status: 'online', players: 3, maxPlayers: 16 }
  ];

  return successResponse({ servers });
}

module.exports = { handle };
