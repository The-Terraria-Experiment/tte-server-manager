/**
 * List all instances with status
 */

const { getInstanceStatus } = require('../../shared/utils/aws');
const { successResponse } = require('../../shared/utils/response');

async function handle(event) {
  // TODO: Get list of instance IDs from env var or DynamoDB
  const instanceIds = (process.env.EC2_INSTANCE_IDS || '').split(',').filter(Boolean);
  
  // TODO: Fetch status for each instance
  const instances = [
    // Example structure:
    // { id: 'i-123', name: 'TTE-Server-1', state: 'running', publicIp: '1.2.3.4' }
  ];

  return successResponse({ instances });
}

module.exports = { handle };
