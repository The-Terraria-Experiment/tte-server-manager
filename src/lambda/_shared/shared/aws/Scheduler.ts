import {
	ActionAfterCompletion,
	ConflictException,
	CreateScheduleCommand,
	FlexibleTimeWindowMode,
	SchedulerClient,
	UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";

/**
 * One-time ("disposable") EventBridge schedules — the timer primitive for staged, per-resource
 * countdowns.
 *
 * This replaces using an SQS queue's DelaySeconds as a timer. A queue is at-least-once and redelivers
 * until a consumer acks, which is right for work but catastrophic for a timer: a handler that times
 * out gets its "timer" redelivered forever. These schedules fire exactly once
 * ({@link https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule.html} —
 * MaximumRetryAttempts 0) and delete themselves afterwards, so a failure stops instead of looping.
 */

/**
 * Floor for how far ahead a schedule may be set. Scheduler rejects `at()` times in the past, and
 * callers compute times from env-tunable delays that could round to zero.
 */
const MIN_LEAD_SECONDS = 60;

/** Schedule names accept only these characters; callers build names from ids that may not comply. */
const UNSAFE_NAME_CHARS = /[^0-9a-zA-Z-_.]/g;

/** Formats an epoch offset as the `at(...)` expression Scheduler expects: UTC, second precision, no `Z`. */
function toAtExpression(firesAtMs: number): string {
	return `at(${new Date(firesAtMs).toISOString().replace(/\.\d{3}Z$/, "")})`;
}

/** Normalizes an arbitrary string into a legal schedule-name fragment. */
export function toScheduleNameFragment(value: string): string {
	return value.replace(UNSAFE_NAME_CHARS, "-");
}

export class SchedulerDao {
	private static instance: SchedulerDao | null = null;
	private readonly client!: SchedulerClient;

	constructor(region = process.env.AWS_REGION) {
		if (SchedulerDao.instance) {
			return SchedulerDao.instance;
		}

		this.client = new SchedulerClient({ region: region || "us-east-2" });
		SchedulerDao.instance = this;
	}

	/**
	 * Creates a one-time schedule that invokes `targetArn` with `payload` after `delaySeconds`, then
	 * deletes itself.
	 *
	 * Names are expected to be deterministic (one per resource+stage), so re-scheduling the same step
	 * replaces the pending timer rather than stacking a second one — an existing name is updated in
	 * place. That invariant is what makes it impossible to accumulate a backlog of pending
	 * invocations the way an unacked queue can.
	 */
	public async UpsertOneTimeSchedule(params: {
		name: string;
		delaySeconds: number;
		targetArn: string;
		roleArn: string;
		payload: unknown;
		description?: string;
	}): Promise<{ name: string; expression: string }> {
		const { name, delaySeconds, targetArn, roleArn, payload, description } = params;

		if (!name) {
			throw new Error("name is required");
		}
		if (!targetArn) {
			throw new Error("targetArn is required");
		}
		if (!roleArn) {
			throw new Error("roleArn is required");
		}

		const leadSeconds = Math.max(delaySeconds, MIN_LEAD_SECONDS);
		const expression = toAtExpression(Date.now() + leadSeconds * 1000);

		const input = {
			Name: name,
			GroupName: "default",
			ScheduleExpression: expression,
			ScheduleExpressionTimezone: "UTC",
			FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
			ActionAfterCompletion: ActionAfterCompletion.DELETE,
			...(description ? { Description: description } : {}),
			Target: {
				Arn: targetArn,
				RoleArn: roleArn,
				Input: JSON.stringify(payload ?? {}),
				// Fire-once: a failed timer must not be retried. The handler is driven by persisted
				// state, so the next scheduled step (or the recurring tick) recovers instead.
				RetryPolicy: { MaximumRetryAttempts: 0 },
			},
		};

		try {
			await this.client.send(new CreateScheduleCommand(input));
		} catch (error) {
			if (!(error instanceof ConflictException)) {
				throw error;
			}
			// A timer for this step is already pending; the newest decision wins.
			await this.client.send(new UpdateScheduleCommand(input));
		}

		return { name, expression };
	}
}
