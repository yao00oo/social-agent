import { v4 as uuid } from "uuid";
import { ConversationEvaluator } from "../planner/ConversationEvaluator";
import { SlotExtractor } from "../planner/SlotExtractor";
import { MessageComposer } from "../planner/MessageComposer";
import { TaskStateManager } from "../state/TaskStateManager";
import { ChannelGateway } from "../gateway/ChannelGateway";
import { SocketManager } from "../socket";
import {
  GoalContext,
  ContactInfo,
  UnifiedMessage,
  EvaluationResult,
} from "../types";

/** Max advance() calls per task to prevent infinite loops */
const MAX_LOOP_COUNT = 30;

export class ConversationLoop {
  constructor(
    private evaluator: ConversationEvaluator,
    private slotExtractor: SlotExtractor,
    private messageComposer: MessageComposer,
    private state: TaskStateManager,
    private gateway: ChannelGateway,
    private socketManager: SocketManager
  ) {}

  // ==========================================================================
  // Main ReAct loop — called after every event
  // ==========================================================================

  async advance(
    taskId: string,
    latestEvent?: { type: string; content: string; from: string }
  ): Promise<void> {
    const { goalContext, contacts, messageHistories } =
      await this.loadFullState(taskId);

    if (!goalContext) {
      console.error("[ConversationLoop] No goalContext for task", taskId);
      return;
    }

    // Safety: prevent infinite loops
    goalContext.loopCount = (goalContext.loopCount || 0) + 1;
    if (goalContext.loopCount > MAX_LOOP_COUNT) {
      console.error(`[ConversationLoop] Max loop count reached for task ${taskId}`);
      goalContext.conversationPhase = "failed";
      await this.saveGoalContext(taskId, goalContext);
      this.socketManager.emitTaskError(taskId, "对话循环次数超限，任务中止");
      return;
    }

    console.log(
      `[ConversationLoop] advance() task=${taskId} loop=${goalContext.loopCount}` +
        (latestEvent ? ` event=${latestEvent.type} from=${latestEvent.from}` : "")
    );

    // ① AI Evaluate — the brain decides what to do
    const evaluation = await this.evaluator.evaluate(
      goalContext,
      messageHistories,
      latestEvent
    );

    console.log(
      `[ConversationLoop] AI decision: ${evaluation.nextAction} (sentiment=${evaluation.sentiment}, achieved=${evaluation.goalAchieved}) reason=${evaluation.nextActionReason}`
    );

    // ② Apply slot updates from evaluator
    this.applySlotUpdates(goalContext, evaluation);

    // ③ Execute the decided action
    switch (evaluation.nextAction) {
      case "message_contact":
        await this.doMessageContact(taskId, goalContext, contacts, evaluation);
        break;

      case "ask_user":
        await this.doAskUser(taskId, goalContext, evaluation);
        break;

      case "auto_decide":
        // AI decided autonomously — save and loop again
        await this.saveGoalContext(taskId, goalContext);
        await this.advance(taskId);
        break;

      case "handle_rejection":
        await this.doHandleRejection(taskId, goalContext, contacts, evaluation);
        break;

      case "send_final_confirmation":
        await this.doSendFinalConfirmation(taskId, goalContext, contacts, evaluation);
        break;

      case "goal_achieved":
        await this.doGoalAchieved(taskId, goalContext);
        break;

      case "goal_failed":
        await this.doGoalFailed(taskId, goalContext, evaluation);
        break;

      default:
        console.warn(`[ConversationLoop] Unknown action: ${evaluation.nextAction}`);
        await this.saveGoalContext(taskId, goalContext);
    }
  }

  // ==========================================================================
  // Event handlers — entry points that trigger advance()
  // ==========================================================================

  async handleContactReply(
    taskId: string,
    message: UnifiedMessage,
    stepId: string
  ): Promise<void> {
    const task = await this.state.getTask(taskId);
    const context = (task.context as Record<string, any>) || {};
    const goalContext = context.goalContext as GoalContext;
    if (!goalContext) return;

    // Find conversation for this step
    const conv = Object.values(goalContext.activeConversations).find(
      (c) => c.stepId === stepId
    );
    if (conv) conv.messageCount++;

    // Use SlotExtractor to pull structured data from the reply
    const stepMessages = await this.state.getStepMessages(stepId);
    const messageHistory = stepMessages.map((m) => ({
      direction: m.direction,
      body: m.body,
    }));

    const unfilledSlots = goalContext.slots.filter(
      (s) => s.value === undefined
    );

    if (unfilledSlots.length > 0) {
      const extraction = await this.slotExtractor.extract(
        message.content.body,
        messageHistory,
        unfilledSlots,
        goalContext
      );

      for (const e of extraction.extracted) {
        const slot = goalContext.slots.find((s) => s.key === e.key);
        if (slot) {
          slot.value = e.value;
          slot.filledBy = conv?.targetName || "contact";
          slot.confirmed = false; // Not confirmed until evaluator says so
          console.log(
            `[ConversationLoop] Extracted slot "${slot.key}" = "${e.value}" (confidence: ${e.confidence})`
          );
        }
      }
    }

    await this.saveGoalContext(taskId, goalContext);

    // Update task status back to executing before advancing
    await this.state.updateTaskStatus(taskId, "executing");

    // Let the ReAct loop decide what happens next — pass the event so evaluator knows what just happened
    const contactName = conv?.targetName || "联系人";
    await this.advance(taskId, {
      type: "contact_reply",
      from: contactName,
      content: message.content.body,
    });
  }

  async handleUserDecision(
    taskId: string,
    stepId: string,
    choice: string
  ): Promise<void> {
    const task = await this.state.getTask(taskId);
    const context = (task.context as Record<string, any>) || {};
    const goalContext = context.goalContext as GoalContext;
    if (!goalContext) return;

    // Find which conversation this decision belongs to
    const conv = Object.entries(goalContext.activeConversations).find(
      ([, c]) => c.stepId === stepId
    );

    if (conv) {
      const [, convData] = conv;
      const trimmedChoice = choice.trim();

      // Apply user choice to the slots being collected
      for (const slotKey of convData.slotsBeingCollected) {
        const slot = goalContext.slots.find((s) => s.key === slotKey);
        if (slot) {
          if (slot.value !== undefined) {
            // Slot already has a value from contact — user is confirming or overriding
            const isConfirmation = /^(好|行|可以|确认|没问题|ok|yes|对|嗯|是的|同意)/i.test(trimmedChoice);
            if (isConfirmation) {
              slot.confirmed = true;
            } else {
              // User provided a different value — override
              slot.value = trimmedChoice;
              slot.filledBy = "user";
              slot.confirmed = true;
            }
          } else {
            // Slot was empty — user provides the value
            slot.value = trimmedChoice;
            slot.filledBy = "user";
            slot.confirmed = true;
          }
          console.log(
            `[ConversationLoop] User decision: slot "${slot.key}" = "${slot.value}" (confirmed: ${slot.confirmed})`
          );
        }
      }
      convData.status = "completed";
    }

    // Mark step done
    await this.state.updateStepStatus(taskId, stepId, "done", {
      status: "success",
      extracted: { user_choice: choice },
      summary: `用户: ${choice}`,
    });
    this.socketManager.emitStepCompleted(taskId, stepId, `用户: ${choice}`);

    await this.state.updateTaskStatus(taskId, "executing");
    await this.saveGoalContext(taskId, goalContext);

    // Let the ReAct loop decide what happens next — pass the event so evaluator knows what the user just said
    await this.advance(taskId, {
      type: "user_decision",
      from: "用户",
      content: choice,
    });
  }

  // ==========================================================================
  // Action implementations
  // ==========================================================================

  /** Send a message to a contact (negotiate, follow up, relay user choice, etc.) */
  private async doMessageContact(
    taskId: string,
    goalContext: GoalContext,
    contacts: ContactInfo[],
    evaluation: EvaluationResult
  ): Promise<void> {
    const targetParty = goalContext.parties.find((p) => p.role === "target");
    if (!targetParty) {
      console.error("[ConversationLoop] No target party");
      await this.doGoalFailed(taskId, goalContext, evaluation);
      return;
    }

    const targetName = targetParty.name;
    const contact = contacts.find(
      (c) =>
        c.name.toLowerCase() === targetName.toLowerCase() ||
        c.id === targetParty.contactId
    );

    if (!contact) {
      this.socketManager.emitTaskError(taskId, `找不到联系人 ${targetName} 的联系方式`);
      await this.doGoalFailed(taskId, goalContext, evaluation);
      return;
    }

    // Check if we have an existing conversation or need a new step
    const convKey = targetName;
    const existingConv = goalContext.activeConversations[convKey];
    const isFirstContact = !existingConv || existingConv.status !== "active";

    // Get history
    let history: Array<{ direction: string; body: string }> = [];
    if (existingConv?.stepId) {
      const msgs = await this.state.getStepMessages(existingConv.stepId);
      history = msgs.map((m) => ({ direction: m.direction, body: m.body }));
    }

    // Compose message — use evaluator's hint if available
    const unfilledSlots = goalContext.slots.filter(
      (s) => s.value === undefined && s.required
    );
    const { message } = await this.messageComposer.composeForContact(
      targetName,
      unfilledSlots,
      goalContext,
      history,
      isFirstContact,
      evaluation.messageHint
    );

    // Create or reuse step
    let stepId: string;
    if (existingConv?.stepId && existingConv.status === "active") {
      stepId = existingConv.stepId;
    } else {
      stepId = uuid();
      await this.state.addSteps(taskId, [
        {
          id: stepId,
          type: "contact_outreach",
          description: `与 ${targetName} 沟通`,
          target: targetName,
          channel: contact.preferred || "sms",
          goal: goalContext.goal.description,
          status: "executing",
          order: Object.keys(goalContext.activeConversations).length,
        },
      ]);
    }

    // Send
    const sendResult = await this.gateway.send(contact, message);
    if (!sendResult.success) {
      this.socketManager.emitTaskError(
        taskId,
        `发送消息给 ${targetName} 失败: ${sendResult.error}`
      );
      return;
    }

    // Store outbound message
    await this.storeOutboundMessage(taskId, stepId, contact, message);

    // Emit UI events
    if (isFirstContact) {
      this.socketManager.emitStepStarted(taskId, stepId, {
        description: `正在与 ${targetName} 沟通`,
        type: "contact_outreach",
      });
    }
    this.socketManager.emitMessageSent(taskId, stepId, {
      message,
      to: targetName,
    });

    // Track conversation
    goalContext.activeConversations[convKey] = {
      stepId,
      targetName,
      slotsBeingCollected: unfilledSlots.map((s) => s.key),
      messageCount: (existingConv?.messageCount || 0) + 1,
      status: "active",
    };

    // Wait for reply
    await this.state.updateStepStatus(taskId, stepId, "waiting_response");
    await this.state.updateTaskStatus(taskId, "waiting_reply");
    await this.saveGoalContext(taskId, goalContext);
  }

  /** Ask the user a question via socket UI */
  private async doAskUser(
    taskId: string,
    goalContext: GoalContext,
    evaluation: EvaluationResult
  ): Promise<void> {
    const question =
      evaluation.userQuestion ||
      evaluation.nextActionReason ||
      "请确认当前情况";
    const options = evaluation.userOptions;

    // Figure out which slots this relates to
    // Include filled-but-unconfirmed slots (user is being asked to confirm them)
    const relevantSlotKeys = evaluation.slotUpdates.length > 0
      ? evaluation.slotUpdates.map((u) => u.key)
      : goalContext.slots
          .filter((s) => s.required && !s.confirmed)
          .map((s) => s.key);

    const stepId = uuid();
    await this.state.addSteps(taskId, [
      {
        id: stepId,
        type: "user_decision",
        description: question,
        status: "waiting_user",
        order: 999,
      },
    ]);

    await this.state.updateStepStatus(taskId, stepId, "waiting_user");
    await this.state.updateTaskStatus(taskId, "waiting_user");

    goalContext.activeConversations[`user_${stepId}`] = {
      stepId,
      targetName: "user",
      slotsBeingCollected: relevantSlotKeys,
      messageCount: 0,
      status: "active",
    };
    await this.saveGoalContext(taskId, goalContext);

    this.socketManager.emitNeedDecision(taskId, stepId, {
      question,
      options,
      allowFreeInput: true,
    });
  }

  /** Handle rejection — try alternative, or escalate to user */
  private async doHandleRejection(
    taskId: string,
    goalContext: GoalContext,
    contacts: ContactInfo[],
    evaluation: EvaluationResult
  ): Promise<void> {
    if (evaluation.messageHint) {
      // Evaluator suggested an alternative approach — try it
      await this.doMessageContact(taskId, goalContext, contacts, evaluation);
    } else {
      // No alternative — escalate to user
      const fallbackEval: EvaluationResult = {
        ...evaluation,
        nextAction: "ask_user",
        userQuestion:
          evaluation.userQuestion ||
          `联系人拒绝了（${evaluation.nextActionReason}），你想怎么处理？`,
        userOptions: evaluation.userOptions || ["换个时间再约", "算了，取消"],
      };
      await this.doAskUser(taskId, goalContext, fallbackEval);
    }
  }

  /** Send final confirmation to contact, then complete */
  private async doSendFinalConfirmation(
    taskId: string,
    goalContext: GoalContext,
    contacts: ContactInfo[],
    evaluation: EvaluationResult
  ): Promise<void> {
    const targetParty = goalContext.parties.find((p) => p.role === "target");
    if (!targetParty) {
      await this.doGoalAchieved(taskId, goalContext);
      return;
    }

    const contact = contacts.find(
      (c) =>
        c.name.toLowerCase() === targetParty.name.toLowerCase() ||
        c.id === targetParty.contactId
    );

    if (contact) {
      const finalMessage = await this.messageComposer.composeFinalNotification(
        targetParty.name,
        goalContext
      );

      const sendResult = await this.gateway.send(contact, finalMessage);
      if (sendResult.success) {
        const convStepId =
          goalContext.activeConversations[targetParty.name]?.stepId ||
          Object.values(goalContext.activeConversations).find(
            (c) => c.targetName === targetParty.name
          )?.stepId;

        if (convStepId) {
          await this.storeOutboundMessage(
            taskId,
            convStepId,
            contact,
            finalMessage
          );
        }

        this.socketManager.emitMessageSent(taskId, convStepId || "", {
          message: finalMessage,
          to: targetParty.name,
        });

        console.log(
          `[ConversationLoop] Sent final confirmation to ${targetParty.name}`
        );
      }
    }

    await this.doGoalAchieved(taskId, goalContext);
  }

  /** Mark task as completed */
  private async doGoalAchieved(
    taskId: string,
    goalContext: GoalContext
  ): Promise<void> {
    goalContext.conversationPhase = "completed";
    await this.saveGoalContext(taskId, goalContext);
    await this.state.updateTaskStatus(taskId, "completed");

    const results = goalContext.slots
      .filter((s) => s.value !== undefined)
      .map((s) => ({ description: `${s.description}: ${s.value}` }));

    const summaryContacts = goalContext.parties.map((p) => ({ name: p.name }));

    this.socketManager.emitTaskCompleted(taskId, {
      instruction: goalContext.goal.originalInstruction,
      stepsCompleted: results.length,
      totalSteps: goalContext.slots.length,
      results,
      context: {
        contacts: summaryContacts,
        goal: goalContext.goal.description,
        goalType: goalContext.goal.type,
      },
    });

    console.log(`[ConversationLoop] Task ${taskId} completed!`);
  }

  /** Mark task as failed */
  private async doGoalFailed(
    taskId: string,
    goalContext: GoalContext,
    evaluation: EvaluationResult
  ): Promise<void> {
    goalContext.conversationPhase = "failed";
    await this.saveGoalContext(taskId, goalContext);
    await this.state.updateTaskStatus(taskId, "failed");
    this.socketManager.emitTaskError(
      taskId,
      evaluation.nextActionReason || "任务失败"
    );
    console.log(`[ConversationLoop] Task ${taskId} failed: ${evaluation.nextActionReason}`);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private applySlotUpdates(
    goalContext: GoalContext,
    evaluation: EvaluationResult
  ): void {
    for (const update of evaluation.slotUpdates || []) {
      let slot = goalContext.slots.find((s) => s.key === update.key);
      if (!slot) {
        // Evaluator discovered a new slot not in the original plan — create it dynamically
        slot = {
          key: update.key,
          description: update.key,
          required: true,
          source: "contact_negotiate",
          confirmWithUser: false,
          value: undefined,
          confirmed: false,
        };
        goalContext.slots.push(slot);
        console.log(
          `[ConversationLoop] Created dynamic slot "${update.key}"`
        );
      }
      slot.value = update.value;
      slot.filledBy = update.source;
      slot.confirmed = update.source === "user";
      console.log(
        `[ConversationLoop] Evaluator updated slot "${update.key}" = "${update.value}" (source: ${update.source})`
      );
    }
  }

  private async loadFullState(taskId: string): Promise<{
    goalContext: GoalContext | null;
    contacts: ContactInfo[];
    messageHistories: Record<string, Array<{ direction: string; body: string }>>;
  }> {
    const task = await this.state.getTask(taskId);
    const context = (task.context as Record<string, any>) || {};
    const goalContext = (context.goalContext as GoalContext) || null;
    const contacts: ContactInfo[] = context.contacts || [];

    // Build message histories per conversation
    const messageHistories: Record<
      string,
      Array<{ direction: string; body: string }>
    > = {};

    if (goalContext) {
      // Collect user decisions to include in context
      const userDecisions: Array<{ body: string; stepId: string }> = [];

      for (const [key, conv] of Object.entries(
        goalContext.activeConversations
      )) {
        if (!conv.stepId) continue;

        if (conv.targetName === "user") {
          // Track completed user decisions
          if (conv.status === "completed") {
            const msgs = await this.state.getStepMessages(conv.stepId);
            const userReply = msgs.find((m) => m.direction === "inbound");
            if (userReply) {
              userDecisions.push({ body: userReply.body, stepId: conv.stepId });
            }
            // Also check step result for the user's choice
            const steps = (await this.state.getTask(taskId)).steps;
            const step = steps.find((s: any) => s.id === conv.stepId);
            if (step?.result) {
              const result = step.result as any;
              if (result.extracted?.user_choice) {
                userDecisions.push({
                  body: result.extracted.user_choice,
                  stepId: conv.stepId,
                });
              }
            }
          }
        } else {
          const msgs = await this.state.getStepMessages(conv.stepId);
          messageHistories[conv.targetName] = msgs.map((m) => ({
            direction: m.direction,
            body: m.body,
          }));
        }
      }

      // Append user decisions as a special "用户" history so the evaluator sees them
      if (userDecisions.length > 0) {
        messageHistories["用户（发起人）"] = userDecisions.map((d) => ({
          direction: "inbound",
          body: d.body,
        }));
      }
    }

    return { goalContext, contacts, messageHistories };
  }

  private async storeOutboundMessage(
    taskId: string,
    stepId: string,
    contact: ContactInfo,
    body: string
  ): Promise<void> {
    const msg: UnifiedMessage = {
      id: uuid(),
      taskId,
      stepId,
      direction: "outbound",
      channel: contact.preferred || "sms",
      from: process.env.TWILIO_PHONE_NUMBER || "agent",
      to:
        contact.channels[contact.preferred || "sms"] ||
        contact.channels.sms ||
        "",
      content: { type: "text", body },
      timestamp: new Date(),
    };
    await this.state.associateMessage(msg, taskId, stepId);
  }

  private async saveGoalContext(
    taskId: string,
    goalContext: GoalContext
  ): Promise<void> {
    await this.state.updateTaskContext(taskId, { goalContext });
  }
}
