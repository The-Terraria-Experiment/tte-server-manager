/**
 * Stop EC2 instance
 */

const { stopInstance } = require('../../shared/utils/aws');
const { successResponse, validationError } = require('../../shared/utils/response');

async function handle(event) {
  const instanceId = event.pathParameters?.id;
  
  if (!instanceId) {
    return validationError('Instance ID is required');
  }

  // TODO: Stop instance
  await stopInstance(instanceId);

  return successResponse({ message: 'Instance stopping', instanceId });
}

module.exports = { handle };
