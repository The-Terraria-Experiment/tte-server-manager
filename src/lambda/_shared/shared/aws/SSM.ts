import { GetCommandInvocationCommand, SSMClient, SendCommandCommand } from "@aws-sdk/client-ssm";
import { CWLogger } from "./CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";
import { Delay } from "../utils/Delay.js";

export interface SsmCommandResult {
	status: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	commandID?: string;
}

export class SsmDao {
	private readonly ssmClient: SSMClient;

	constructor(region = process.env.AWS_REGION) {
		this.ssmClient = new SSMClient({ region: region || "us-east-2" });
	}

	public async ExecuteCommand(instanceId: string, commands: string[]): Promise<{ commandId: string }> {
		const command = new SendCommandCommand({
			InstanceIds: [instanceId],
			DocumentName: "AWS-RunShellScript",
			Parameters: {
				commands,
			},
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-execute-ssm-command",
			resource: null,
			details: { instanceId, commands },
		});

		const response = await this.ssmClient.send(command);
		return {
			commandId: response.Command?.CommandId ?? "",
		};
	}

	public async ExecuteDocument(
		instanceId: string,
		documentName: string,
		parameters: Record<string, string[]>,
	): Promise<{ commandId: string }> {
		const command = new SendCommandCommand({
			InstanceIds: [instanceId],
			DocumentName: documentName,
			Parameters: parameters,
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-execute-ssm-document",
			resource: null,
			details: { instanceId, documentName, parameters },
		});

		const response = await this.ssmClient.send(command);
		return {
			commandId: response.Command?.CommandId ?? "",
		};
	}

	public async GetCommandResult(commandId: string, instanceId: string): Promise<SsmCommandResult> {
		const command = new GetCommandInvocationCommand({
			CommandId: commandId,
			InstanceId: instanceId,
		});

		await CWLogger.CAction(2, CW_LOG_GENERAL, {
			userId: null,
			action: "shared-aws-get-ssm-command-result",
			resource: null,
			details: { instanceId, commandId },
		});

		const response = await this.ssmClient.send(command);
		return {
			status: response.Status ?? "Unknown",
			exitCode: response.ResponseCode ?? -1,
			stdout: response.StandardOutputContent || "",
			stderr: response.StandardErrorContent || "",
		};
	}

	public async PollForCommandCompletion(commandID: string, instanceID: string, intervalMs: number = 1000, max: number = 30): Promise<SsmCommandResult>
	{
		for (let i = 0; i < max; i++) {
			await new Delay(intervalMs);
			const result = await this.GetCommandResult(commandID, instanceID);
			if (result.status === "Success") {
				return result;
			}

			if (["Failed", "Cancelled", "TimedOut", "Cancelling"].includes(result.status)) {
				throw new Error(`SSM command ${commandID} ${result.status}: ${result.stderr || result.stdout}`);
			}
		}

		throw new Error(`SSM command ${commandID} timed out`);
	}

	public async ExecuteCommandGetResult(instanceID: string, commands: string[], pollInterval: number = 1000, maxPolls: number = 30): Promise<SsmCommandResult>
	{
		const { commandId } = await this.ExecuteCommand(instanceID, commands);
		const result = await this.PollForCommandCompletion(commandId, instanceID, pollInterval, maxPolls);
		
		return {
			...result,
			commandID: commandId
		}
	}

	public async ExecuteDocumentGetResult(
		instanceID: string,
		documentName: string,
		parameters: Record<string, string[]>,
		pollInterval: number = 1000,
		maxPolls: number = 30,
	): Promise<SsmCommandResult> {
		const { commandId } = await this.ExecuteDocument(instanceID, documentName, parameters);
		const result = await this.PollForCommandCompletion(commandId, instanceID, pollInterval, maxPolls);

		return {
			...result,
			commandID: commandId,
		};
	}
}
