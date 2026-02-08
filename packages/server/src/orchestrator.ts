import { v4 as uuid } from "uuid";
import { TaskPlanner } from "./planner/TaskPlanner";
import { ConversationExecutor } from "./executor/ConversationExecutor";
import { DecisionRouter } from "./router/DecisionRouter";
import { ChannelGateway } from "./gateway/ChannelGateway";
import { TaskStateManager } from "./state/TaskStateManager";
import { TaskContext, UnifiedMessage, ContactInfo, GoalContext } from "./types";
import { SocketManager } from "./socket";
import { DemoSimulator } from "./demo/DemoSimulator";
import { GoalAnalyzer } from "./planner/GoalAnalyzer";
import { ConversationLoop } from "./engine/ConversationLoop";

export class Orchestrator {
  private goalAnalyzer?: GoalAnalyzer;
  private conversationLoop?: ConversationLoop;

  constructor(
    private planner: TaskPlanner,
    private executor: ConversationExecutor,
    private router: DecisionRouter,
    private gateway: ChannelGateway,
    private state: TaskStateManager,
    private socketManager: SocketManager,
    goalAnalyzer?: GoalAnalyzer,
    conversationLoop?: ConversationLoop
  ) {
    this.goalAnalyzer = goalAnalyzer;
    this.conversationLoop = conversationLoop;

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

    // --- Demo mode: always use old flow ---
    if (DemoSimulator.isDemoMode()) {
      console.log("[Demo] Using demo simulator for planning");
      const steps = DemoSimulator.generatePlan(instruction);
      if (steps) {
        await this.state.addSteps(task.id, steps);
        await this.state.updateTaskContext(task.id, { contacts, instruction });
        await this.state.updateTaskStatus(task.id, "executing");
        await this.executeNextStep(task.id);
        return task;
      }
    }

    // --- New Goal + Slots flow ---
    if (this.goalAnalyzer && this.conversationLoop) {
      try {
        console.log("[Orchestrator] Using Goal+Slots engine");

        const analysis = await this.goalAnalyzer.analyze(instruction, contacts);

        // Build GoalContext
        const goalContext: GoalContext = {
          goal: {
            type: analysis.goalType,
            description: analysis.goalDescription,
            originalInstruction: instruction,
          },
          slots: analysis.slots.map((s) => ({
            key: s.key,
            description: s.description,
            required: s.required,
            source: s.source,
            confirmWithUser: s.confirmWithUser,
            value: s.value,
            confirmed: s.value !== undefined ? !s.confirmWithUser : undefined,
            filledBy: s.value !== undefined ? "context" : undefined,
            extractionHint: s.extractionHint,
          })),
          parties: analysis.parties.map((p) => {
            const contact = contacts.find(
              (c) => c.name.toLowerCase() === p.name.toLowerCase()
            );
            return {
              name: p.name,
              role: p.role,
              contactId: contact?.id,
              channel: contact?.preferred,
              channelAddress: contact
                ? contact.channels[contact.preferred] ||
                  contact.channels.sms
                : undefined,
            };
          }),
          conversationPhase: "gathering",
          pendingConfirmations: [],
          postActions: analysis.postActions,
          activeConversations: {},
        };

        // Store context
        await this.state.updateTaskContext(task.id, {
          contacts,
          instruction,
          goalContext,
        });

        await this.state.updateTaskStatus(task.id, "executing");

        // Start conversation loop
        await this.conversationLoop.advance(task.id);

        return task;
      } catch (error) {
        console.error(
          "[Orchestrator] Goal+Slots engine failed, falling back to old flow:",
          error
        );
        // Fall through to old flow
      }
    }

    // --- Fallback: old TaskPlanner flow ---
    const plan = await this.planner.plan(
      instruction,
      userId,
      contacts.map((c) => c.name)
    );

    await this.state.addSteps(task.id, plan.steps);
    await this.state.updateTaskContext(task.id, { contacts, instruction });
    await this.state.updateTaskStatus(task.id, "executing");
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

        const context = (task.context as Record<string, any>) || {};
        let summary: Record<string, any>;

        if (DemoSimulator.isDemoMode()) {
          summary = DemoSimulator.getCompletionSummary(task.instruction, context);
          summary.instruction = task.instruction;
          summary.stepsCompleted = steps.filter((s) => s.status === "done").length;
          summary.totalSteps = steps.length;
          summary.results = steps
            .filter((s) => s.status === "done" && s.result)
            .map((s) => ({ description: s.description, result: s.result }));
          summary.context = context;
        } else {
          summary = this.buildCompletionSummary(task);
        }

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
      if (!allDepsDone) return;
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

    // --- Demo mode: simulate the step ---
    if (DemoSimulator.isDemoMode()) {
      await this.executeDemoStep(taskId, nextStep, task);
      return;
    }

    // --- Real mode ---
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
      await this.state.updateStepStatus(taskId, nextStep.id, "done", {
        status: "success",
        extracted: {},
        summary: nextStep.description,
      });
      this.socketManager.emitStepCompleted(taskId, nextStep.id, nextStep.description);
      await this.executeNextStep(taskId);
    }
  }

  /**
   * Demo mode: simulate a step with delays to make it feel real.
   */
  private async executeDemoStep(taskId: string, nextStep: any, task: any) {
    const instruction = task.instruction;

    if (nextStep.type === "contact_outreach") {
      // Generate and "send" outbound message
      const outboundText = DemoSimulator.generateOutboundMessage(
        { goal: nextStep.goal, target: nextStep.target, description: nextStep.description },
        instruction,
        true
      );

      // Simulate short send delay
      await this.delay(800);

      const outboundMsg: UnifiedMessage = {
        id: uuid(),
        taskId,
        stepId: nextStep.id,
        direction: "outbound",
        channel: "sms",
        from: "agent",
        to: nextStep.target || "",
        content: { type: "text", body: outboundText },
        timestamp: new Date(),
      };
      await this.state.associateMessage(outboundMsg, taskId, nextStep.id);

      this.socketManager.emitMessageSent(taskId, nextStep.id, {
        message: outboundText,
        to: nextStep.target || "",
      });

      // Check if there's a simulated reply
      const simReply = DemoSimulator.getSimulatedReply(nextStep.description, instruction);

      if (simReply) {
        await this.state.updateStepStatus(taskId, nextStep.id, "waiting_response");
        await this.state.updateTaskStatus(taskId, "waiting_reply");

        // Schedule simulated reply after delay
        setTimeout(async () => {
          try {
            const inboundMsg: UnifiedMessage = {
              id: uuid(),
              taskId,
              stepId: nextStep.id,
              direction: "inbound",
              channel: "sms",
              from: nextStep.target || "contact",
              to: "agent",
              content: { type: "text", body: simReply.reply },
              timestamp: new Date(),
            };
            await this.state.associateMessage(inboundMsg, taskId, nextStep.id);

            this.socketManager.emitReplyReceived(taskId, nextStep.id, {
              from: nextStep.target || "联系人",
              message: simReply.reply,
            });

            // Mark step as done
            await this.state.updateStepStatus(taskId, nextStep.id, "done", {
              status: "success",
              extracted: { reply: simReply.reply },
              summary: `${nextStep.target} 回复: ${simReply.reply}`,
            });

            this.socketManager.emitStepCompleted(
              taskId,
              nextStep.id,
              `${nextStep.target} 回复: ${simReply.reply}`
            );

            await this.state.updateTaskStatus(taskId, "executing");
            await this.executeNextStep(taskId);
          } catch (err) {
            console.error("[Demo] Simulated reply error:", err);
          }
        }, simReply.delay);
      } else {
        // No simulated reply, complete immediately
        await this.state.updateStepStatus(taskId, nextStep.id, "done", {
          status: "success",
          extracted: {},
          summary: nextStep.description,
        });
        this.socketManager.emitStepCompleted(taskId, nextStep.id, nextStep.description);
        await this.executeNextStep(taskId);
      }
    } else if (nextStep.type === "info_retrieval") {
      // Simulate info lookup
      await this.delay(1500);

      await this.state.updateStepStatus(taskId, nextStep.id, "done", {
        status: "success",
        extracted: { info: "搜索完成" },
        summary: nextStep.description,
      });
      this.socketManager.emitStepCompleted(taskId, nextStep.id, nextStep.description);
      await this.executeNextStep(taskId);
    } else if (nextStep.type === "notification") {
      await this.delay(500);

      await this.state.updateStepStatus(taskId, nextStep.id, "done", {
        status: "success",
        extracted: {},
        summary: nextStep.description,
      });
      this.socketManager.emitStepCompleted(taskId, nextStep.id, nextStep.description);
      await this.executeNextStep(taskId);
    } else {
      // Fallback
      await this.state.updateStepStatus(taskId, nextStep.id, "done", {
        status: "success",
        extracted: {},
        summary: nextStep.description,
      });
      this.socketManager.emitStepCompleted(taskId, nextStep.id, nextStep.description);
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

    message.taskId = task.id;
    message.stepId = activeStep.id;
    await this.state.associateMessage(message, task.id, activeStep.id);

    this.socketManager.emitReplyReceived(task.id, activeStep.id, {
      from: message.from,
      message: message.content.body,
    });

    // --- Check if this task uses the new Goal+Slots engine ---
    const taskContext = (task.context as Record<string, any>) || {};
    if (taskContext.goalContext && this.conversationLoop) {
      console.log("[Orchestrator] Routing inbound message to ConversationLoop");
      await this.conversationLoop.handleContactReply(
        task.id,
        message,
        activeStep.id
      );
      return;
    }

    // --- Old flow ---
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

    // Fetch real message history for this step
    const stepMessages = await this.state.getStepMessages(activeStep.id);
    const messageHistory = stepMessages.map((m) => ({
      direction: m.direction,
      body: m.body,
    }));

    const result = await this.executor.handleReply(message, stepData, context, messageHistory);

    // Check if this is a "continue conversation" result (agent sent follow-up, waiting for next reply)
    if (result.status === "success" && result.extracted?._continueConversation) {
      // Agent sent a follow-up message, keep step in waiting_response state
      const followUp = result.extracted._followUpSent;
      if (followUp) {
        // Store the follow-up as an outbound message
        const followUpMsg: UnifiedMessage = {
          id: uuid(),
          taskId: task.id,
          stepId: activeStep.id,
          direction: "outbound",
          channel: (activeStep.channel as any) || "sms",
          from: process.env.TWILIO_PHONE_NUMBER || "agent",
          to: message.from,
          content: { type: "text", body: followUp },
          timestamp: new Date(),
        };
        await this.state.associateMessage(followUpMsg, task.id, activeStep.id);

        this.socketManager.emitMessageSent(task.id, activeStep.id, {
          message: followUp,
          to: stepData.target || "",
        });
      }
      // Keep waiting for the next reply
      await this.state.updateStepStatus(task.id, activeStep.id, "waiting_response");
      await this.state.updateTaskStatus(task.id, "waiting_reply");
      return;
    }

    if (result.status === "success") {
      await this.state.updateStepStatus(task.id, activeStep.id, "done", result);
      await this.state.updateTaskContext(task.id, result.extracted);

      this.socketManager.emitStepCompleted(task.id, activeStep.id, result.summary);

      const taskFull = await this.state.getTask(task.id);
      const completedSteps = taskFull.steps
        .filter((s) => s.status === "done")
        .map((s) => ({ description: s.description, result: s.result as any }));
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

      await this.state.updateTaskStatus(task.id, "executing");
      await this.executeNextStep(task.id);
    } else if (result.status === "needs_user_input") {
      await this.state.updateStepStatus(task.id, activeStep.id, "waiting_user");
      await this.state.updateTaskStatus(task.id, "waiting_user");

      const escalation = this.router.routeEscalation(stepData, context, result.summary);

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
    // --- Check if this task uses the new Goal+Slots engine ---
    const task = await this.state.getTask(taskId);
    const taskContext = (task.context as Record<string, any>) || {};
    if (taskContext.goalContext && this.conversationLoop) {
      console.log("[Orchestrator] Routing user decision to ConversationLoop");
      await this.conversationLoop.handleUserDecision(taskId, stepId, choice);
      return;
    }

    // --- Old flow ---
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

    const matched = allContacts
      .filter((c) => instruction.toLowerCase().includes(c.name.toLowerCase()))
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

    // In demo mode, create virtual contacts if none found
    if (matched.length === 0 && DemoSimulator.isDemoMode()) {
      const names = ["张三", "李磊", "王磊", "李四", "王五"];
      for (const name of names) {
        if (instruction.includes(name)) {
          matched.push({
            id: `demo-${name}`,
            name,
            channels: { sms: "+8613800000001", voice: undefined, telegram: undefined, email: undefined },
            preferred: "sms",
          });
        }
      }
      // Fallback for group notifications
      if (matched.length === 0 && instruction.match(/小组|团队|项目组/)) {
        matched.push({
          id: "demo-group",
          name: "小组成员",
          channels: { sms: "+8613800000099", voice: undefined, telegram: undefined, email: undefined },
          preferred: "sms",
        });
      }
    }

    return matched;
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
      .map((s: any) => ({ description: s.description, result: s.result }));

    return {
      instruction: task.instruction,
      stepsCompleted: results.length,
      totalSteps: steps.length,
      results,
      context,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
