import { chat } from "../llm/client";
import { TaskStep, StepResult, TaskContext, UnifiedMessage, ReplyAnalysis } from "../types";
import { ChannelGateway } from "../gateway/ChannelGateway";
import { MESSAGE_GENERATION_PROMPT, REPLY_ANALYSIS_PROMPT } from "../planner/prompts";

export class TextExecutor {
  constructor(private gateway: ChannelGateway) {}

  async startStep(
    step: TaskStep,
    context: TaskContext
  ): Promise<{ message?: string; waitingForReply: boolean }> {
    const targetContact = context.contacts?.find(
      (c) => c.name === step.target || c.id === step.target
    );

    if (!targetContact) {
      console.error(`[TextExecutor] Contact not found: ${step.target}`);
      return { waitingForReply: false };
    }

    // Generate initial outreach message
    const message = await this.generateMessage(step, context, []);

    // Send via gateway
    const result = await this.gateway.send(targetContact, message, step.channel);

    if (!result.success) {
      console.error(`[TextExecutor] Failed to send: ${result.error}`);
      return { waitingForReply: false };
    }

    return {
      message,
      waitingForReply: step.type === "contact_outreach",
    };
  }

  async handleReply(
    inboundMessage: UnifiedMessage,
    step: TaskStep,
    context: TaskContext,
    messageHistory?: Array<{ direction: string; body: string }>
  ): Promise<StepResult> {
    const replyText = inboundMessage.content.body;

    // Build conversation history string from real messages
    const historyStr = this.formatHistory(messageHistory || [], replyText);

    // Analyze the reply with real history
    const analysis = await this.analyzeReply(step, context, replyText, historyStr);

    console.log(`[TextExecutor] Reply analysis: intent=${analysis.intent}, goal_achieved=${analysis.goal_achieved}, next_action=${analysis.next_action}`);

    if (analysis.goal_achieved) {
      return {
        status: "success",
        extracted: analysis.extracted_data,
        summary: `${step.target} 回复: ${replyText}`,
      };
    }

    if (analysis.next_action === "escalate") {
      return {
        status: "needs_user_input",
        extracted: analysis.extracted_data,
        summary: `${step.target} 的回复需要用户判断: ${replyText}`,
      };
    }

    if (analysis.next_action === "reply" && analysis.suggested_reply) {
      // Send follow-up message
      const targetContact = context.contacts?.find(
        (c) => c.name === step.target || c.id === step.target
      );

      if (targetContact) {
        await this.gateway.send(targetContact, analysis.suggested_reply, step.channel);
      }

      // Return a special status so orchestrator knows to keep waiting
      // instead of escalating to user
      return {
        status: "success" as any,
        extracted: { ...analysis.extracted_data, _continueConversation: true, _followUpSent: analysis.suggested_reply },
        summary: `继续与 ${step.target} 沟通中`,
      };
    }

    // "end" action — conversation ended without achieving goal
    if (analysis.next_action === "end") {
      return {
        status: "success",
        extracted: analysis.extracted_data,
        summary: `与 ${step.target} 的对话结束: ${replyText}`,
      };
    }

    return {
      status: "failed",
      extracted: {},
      summary: `与 ${step.target} 的沟通未能达成目标`,
    };
  }

  private formatHistory(
    messages: Array<{ direction: string; body: string }>,
    currentReply: string
  ): string {
    if (messages.length === 0) {
      return `对方回复: ${currentReply}`;
    }

    const lines = messages.map((m) => {
      const role = m.direction === "outbound" ? "助理" : "对方";
      return `${role}: ${m.body}`;
    });
    // The current reply is already in messages (added by orchestrator before calling),
    // but include it explicitly if not present
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.body !== currentReply) {
      lines.push(`对方: ${currentReply}`);
    }
    return lines.join("\n");
  }

  private async generateMessage(
    step: TaskStep,
    context: TaskContext,
    history: Array<{ role: string; content: string }>
  ): Promise<string> {
    const prompt = MESSAGE_GENERATION_PROMPT
      .replace("{userName}", context.userId || "用户")
      .replace("{targetName}", step.target || "对方")
      .replace("{goal}", step.goal || step.description)
      .replace("{context}", JSON.stringify(context.stepResults || {}))
      .replace(
        "{history}",
        history.length > 0
          ? history.map((h) => `${h.role}: ${h.content}`).join("\n")
          : "（首次联系）"
      );

    return chat(prompt, "请生成短信内容");
  }

  private async analyzeReply(
    step: TaskStep,
    context: TaskContext,
    reply: string,
    historyStr: string
  ): Promise<ReplyAnalysis> {
    const prompt = REPLY_ANALYSIS_PROMPT
      .replace("{goal}", step.goal || step.description)
      .replace("{history}", historyStr)
      .replace("{reply}", reply);

    try {
      const response = await chat(prompt, reply, { json: true });
      return JSON.parse(response) as ReplyAnalysis;
    } catch {
      return {
        intent: "unclear",
        extracted_data: {},
        goal_achieved: false,
        next_action: "escalate",
      };
    }
  }
}
