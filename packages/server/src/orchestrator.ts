import { v4 as uuid } from "uuid";
import { TaskPlanner } from "./planner/TaskPlanner";
import { ConversationExecutor } from "./executor/ConversationExecutor";
import { DecisionRouter } from "./router/DecisionRouter";
import { ChannelGateway } from "./gateway/ChannelGateway";
import { TaskStateManager } from "./state/TaskStateManager";
import { TaskContext, UnifiedMessage, ContactInfo } from "./types";
import { SocketManager } from "./socket";

export class Orchestrator {
  constructor(
    private planner: TaskPlanner,
    private executor: ConversationExecutor,
    private router: DecisionRouter,
    private gateway: ChannelGateway,
    private state: TaskStateManager,
    private socketManager: SocketManager
  ) {
    // Listen for state changes and forward to socket
    this.state.on("stateChange", (event) => {
      this.socketManager.broadcastStateChange(event);
    });
  }

  async handleInstruction(userId: string, instruction: string) {
    // 1. Create task
    const task = await this.state.createTask(instruction, userId);

    // 2. Update status to planning
    await this.state.updateTaskStatus(task.id, "planning");

    // 3. Look up contacts mentioned in instruction
    const contacts = await this.resolveContacts(userId, instruction);

    // 4. Plan the task
    const plan = await this.planner.plan(
      instruction,
      userId,
      contacts.map((c) => c.name)
    );

    // 5. Store steps
    await this.state.addSteps(task.id, plan.steps);

    // 6. Store contacts in task context
    await this.state.updateTaskContext(task.id, { contacts });

    // 7. Update status and start execution
    await this.state.updateTaskStatus(task.id, "executing");

    // 8. Execute first step
    await this.executeNextStep(task.id);

    return task;
  }

  async executeNextStep(taskId: string) {
    const task = await this.state.getTask(taskId);
    const steps = task.steps;

    // Find next pending step
    const nextStep = steps.find((s) => s.status === "pending");

    if (!nextStep) {
      // All steps done, check if task is complete
      const allDone = steps.every((s) => s.status === "done" || s.status === "failed");
      if (allDone) {
        await this.state.updateTaskStatus(taskId, "completed");

        // Build completion summary
        const summary = this.buildCompletionSummary(task);
        this.socketManager.emitTaskCompleted(taskId, summary);
      }
      return;
    }

    // Check dependencies
    if (nextStep.dependsOn) {
      const deps = nextStep.dependsOn as string[];
      const allDepsDone = deps.every((depId) => {
        const dep = steps.find((s) => s.id === depId);
        return dep && dep.status === "done";
      });
      if (!allDepsDone) {
        // Dependencies not met yet, skip for now
        return;
      }
    }

    // Route decision
    const context = this.buildContext(task);
    const decision = this.router.route(
      {
        id: nextStep.id,
        type: nextStep.type as any,
        description: nextStep.description,
        target: nextStep.target || undefined,
        channel: nextStep.channel as any,
        goal: nextStep.goal || undefined,
        options: (nextStep.options as string[]) || undefined,
        dependsOn: (nextStep.dependsOn as string[]) || undefined,
        status: nextStep.status as any,
        order: nextStep.order,
      },
      context
    );

    if (decision.action === "ask_user") {
      await this.state.updateStepStatus(taskId, nextStep.id, "waiting_user");
      await this.state.updateTaskStatus(taskId, "waiting_user");

      this.socketManager.emitNeedDecision(taskId, nextStep.id, {
        question: decision.userPrompt!.question,
        options: decision.userPrompt!.options,
        allowFreeInput: decision.userPrompt!.allowFreeInput,
      });
      return;
    }

    // Auto execute
    await this.state.updateStepStatus(taskId, nextStep.id, "executing");

    this.socketManager.emitStepStarted(taskId, nextStep.id, {
      description: nextStep.description,
      type: nextStep.type as any,
    });

    const stepData = {
      id: nextStep.id,
      type: nextStep.type as any,
      description: nextStep.description,
      target: nextStep.target || undefined,
      channel: nextStep.channel as any,
      goal: nextStep.goal || undefined,
      options: (nextStep.options as string[]) || undefined,
      status: "executing" as const,
      order: nextStep.order,
    };

    const execResult = await this.executor.startStep(stepData, context);

    if (execResult.message) {
      // Record outbound message
      const outboundMsg: UnifiedMessage = {
        id: uuid(),
        taskId,
        stepId: nextStep.id,
        direction: "outbound",
        channel: (nextStep.channel as any) || "sms",
        from: process.env.TWILIO_PHONE_NUMBER || "agent",
        to: this.resolveTargetNumber(context, nextStep.target || ""),
        content: { type: "text", body: execResult.message },
        timestamp: new Date(),
      };
      await this.state.associateMessage(outboundMsg, taskId, nextStep.id);

      this.socketManager.emitMessageSent(taskId, nextStep.id, {
        message: execResult.message,
        to: nextStep.target || "",
      });
    }

    if (execResult.waitingForReply) {
      await this.state.updateStepStatus(taskId, nextStep.id, "waiting_response");
      await this.state.updateTaskStatus(taskId, "waiting_reply");
    } else {
      // Step completed synchronously
      await this.state.updateStepStatus(taskId, nextStep.id, "done", {
        status: "success",
        extracted: {},
        summary: nextStep.description,
      });

      this.socketManager.emitStepCompleted(taskId, nextStep.id, nextStep.description);

      // Continue to next step
      await this.executeNextStep(taskId);
    }
  }

  async handleInboundMessage(message: UnifiedMessage) {
    const found = await this.state.findTaskByInboundMessage(
      message.from,
      message.channel
    );

    if (!found) {
      console.log(`[Orchestrator] No active task for message from ${message.from}`);
      return;
    }

    const { task, step: activeStep } = found;

    // Store message
    message.taskId = task.id;
    message.stepId = activeStep.id;
    await this.state.associateMessage(message, task.id, activeStep.id);

    // Notify frontend
    this.socketManager.emitReplyReceived(task.id, activeStep.id, {
      from: message.from,
      message: message.content.body,
    });

    // Process reply
    const context = this.buildContext(task);
    const stepData = {
      id: activeStep.id,
      type: activeStep.type as any,
      description: activeStep.description,
      target: activeStep.target || undefined,
      channel: activeStep.channel as any,
      goal: activeStep.goal || undefined,
      status: activeStep.status as any,
      order: activeStep.order,
    };

    const result = await this.executor.handleReply(message, stepData, context);

    if (result.status === "success") {
      await this.state.updateStepStatus(task.id, activeStep.id, "done", result);
      await this.state.updateTaskContext(task.id, result.extracted);

      this.socketManager.emitStepCompleted(task.id, activeStep.id, result.summary);

      // Check if replan is needed
      const taskFull = await this.state.getTask(task.id);
      const completedSteps = taskFull.steps
        .filter((s) => s.status === "done")
        .map((s) => ({
          description: s.description,
          result: s.result as any,
        }));
      const remainingSteps = taskFull.steps
        .filter((s) => s.status === "pending")
        .map((s) => ({
          id: s.id,
          type: s.type as any,
          description: s.description,
          target: s.target || undefined,
          channel: s.channel as any,
          goal: s.goal || undefined,
          status: s.status as any,
          order: s.order,
        }));

      if (remainingSteps.length > 0) {
        const replanResult = await this.planner.replan({
          instruction: task.instruction,
          completedSteps,
          remainingSteps,
          context: (task.context as Record<string, any>) || {},
        });

        if (replanResult?.needsReplan && replanResult.newSteps) {
          await this.state.addSteps(task.id, replanResult.newSteps);
        }
      }

      // Continue
      await this.state.updateTaskStatus(task.id, "executing");
      await this.executeNextStep(task.id);
    } else if (result.status === "needs_user_input") {
      await this.state.updateStepStatus(task.id, activeStep.id, "waiting_user");
      await this.state.updateTaskStatus(task.id, "waiting_user");

      const escalation = this.router.routeEscalation(
        stepData,
        context,
        result.summary
      );

      this.socketManager.emitNeedDecision(task.id, activeStep.id, {
        question: escalation.userPrompt!.question,
        options: escalation.userPrompt!.options,
        allowFreeInput: escalation.userPrompt!.allowFreeInput,
      });
    } else {
      await this.state.updateStepStatus(task.id, activeStep.id, "failed", result);
      this.socketManager.emitStepCompleted(task.id, activeStep.id, `失败: ${result.summary}`);
      await this.executeNextStep(task.id);
    }
  }

  async handleUserDecision(taskId: string, stepId: string, choice: string) {
    await this.state.updateStepStatus(taskId, stepId, "done", {
      status: "success",
      extracted: { user_choice: choice },
      summary: choice,
    });

    await this.state.updateTaskContext(taskId, {
      [`${stepId}_choice`]: choice,
    });

    this.socketManager.emitStepCompleted(taskId, stepId, `用户选择: ${choice}`);

    await this.state.updateTaskStatus(taskId, "executing");
    await this.executeNextStep(taskId);
  }

  private async resolveContacts(
    userId: string,
    instruction: string
  ): Promise<ContactInfo[]> {
    const allContacts = await this.state.getContacts(userId);

    return allContacts
      .filter((c) => instruction.includes(c.name))
      .map((c) => ({
        id: c.id,
        name: c.name,
        channels: {
          sms: c.sms || undefined,
          voice: c.voice || undefined,
          telegram: c.telegram || undefined,
          email: c.email || undefined,
        },
        preferred: c.preferred as any,
      }));
  }

  private resolveTargetNumber(context: TaskContext, targetName: string): string {
    const contact = context.contacts?.find(
      (c: ContactInfo) => c.name === targetName || c.id === targetName
    );
    return contact?.channels?.sms || contact?.channels?.voice || "";
  }

  private buildContext(task: any): TaskContext {
    const taskContext = (task.context as Record<string, any>) || {};
    const stepResults: Record<string, any> = {};

    for (const step of task.steps || []) {
      if (step.result) {
        stepResults[step.id] = step.result;
      }
    }

    return {
      taskId: task.id,
      userId: task.userId,
      instruction: task.instruction,
      contacts: taskContext.contacts || [],
      stepResults,
      ...taskContext,
    };
  }

  private buildCompletionSummary(task: any): Record<string, any> {
    const context = (task.context as Record<string, any>) || {};
    const steps = task.steps || [];
    const results = steps
      .filter((s: any) => s.status === "done" && s.result)
      .map((s: any) => ({
        description: s.description,
        result: s.result,
      }));

    return {
      instruction: task.instruction,
      stepsCompleted: results.length,
      totalSteps: steps.length,
      results,
      context,
    };
  }
}
