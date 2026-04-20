import { GetCommandInvocationCommand, SSMClient, SendCommandCommand } from "@aws-sdk/client-ssm";
import { CWLogger } from "./CloudWatch.js";
import { CW_LOG_GENERAL } from "../constants.js";

export interface SsmCommandResult {
	status: string;
	exitCode: number;
	stdout: string;
	stderr: string;
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
}
