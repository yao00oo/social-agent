import { TaskStep, TaskContext, DecisionResult } from "../types";

const ALWAYS_ASK_USER_TYPES = new Set(["user_decision"]);
const ALWAYS_AUTO_TYPES = new Set(["notification", "info_retrieval"]);

export class DecisionRouter {
  route(step: TaskStep, context: TaskContext): DecisionResult {
    // Rule 1: user_decision always asks user
    if (ALWAYS_ASK_USER_TYPES.has(step.type)) {
      return {
        action: "ask_user",
        reason: "步骤需要用户决策",
        userPrompt: {
          question: step.description,
          options: step.options,
          allowFreeInput: true,
        },
      };
    }

    // Rule 2: notification and info_retrieval are always auto
    if (ALWAYS_AUTO_TYPES.has(step.type)) {
      return {
        action: "auto_execute",
        reason: "自动执行步骤",
      };
    }

    // Rule 3: contact_outreach and phone_call default to auto
    if (step.type === "contact_outreach" || step.type === "phone_call") {
      return {
        action: "auto_execute",
        reason: "自动联系对方",
      };
    }

    // Default: auto execute
    return {
      action: "auto_execute",
      reason: "默认自动执行",
    };
  }

  /**
   * Called when a step result indicates the agent needs user input
   * (e.g., contact rejected, low confidence, unexpected response)
   */
  routeEscalation(
    step: TaskStep,
    context: TaskContext,
    reason: string
  ): DecisionResult {
    return {
      action: "ask_user",
      reason,
      userPrompt: {
        question: reason,
        options: ["继续尝试", "换个方案", "取消任务"],
        allowFreeInput: true,
      },
    };
  }
}
