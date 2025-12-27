/**
 * Restart EC2 instance (stop then start)
 */

const { stopInstance, startInstance } = require('../../shared/utils/aws');
const { successResponse, validationError } = require('../../shared/utils/response');

async function handle(event) {
  const instanceId = event.pathParameters?.id;
  
  if (!instanceId) {
    return validationError('Instance ID is required');
  }

  // TODO: Stop instance, wait for stopped state, then start
  // Consider using SSM reboot command instead for faster restart

  return successResponse({ message: 'Instance restarting', instanceId });
}

module.exports = { handle };
