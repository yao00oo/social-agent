import { chat } from "../llm/client";
import { TaskStep, StepResult, TaskContext, UnifiedMessage } from "../types";
import { ChannelGateway } from "../gateway/ChannelGateway";

export class VoiceExecutor {
  constructor(private gateway: ChannelGateway) {}

  async startStep(
    step: TaskStep,
    context: TaskContext
  ): Promise<{ message?: string; waitingForReply: boolean }> {
    const targetContact = context.contacts?.find(
      (c) => c.name === step.target || c.id === step.target
    );

    if (!targetContact) {
      console.error(`[VoiceExecutor] Contact not found: ${step.target}`);
      return { waitingForReply: false };
    }

    const phone = targetContact.channels.voice || targetContact.channels.sms;
    if (!phone) {
      console.error(`[VoiceExecutor] No phone number for: ${step.target}`);
      return { waitingForReply: false };
    }

    const agentPrompt = this.buildAgentPrompt(step, context);
    const callGoal = step.goal || step.description;

    const result = await this.gateway.makeCall(phone, agentPrompt, callGoal);

    if (!result.success) {
      console.error(`[VoiceExecutor] Call failed: ${result.error}`);
      return { waitingForReply: false };
    }

    return {
      message: `正在给 ${step.target} 打电话...`,
      waitingForReply: true,
    };
  }

  async handleReply(
    message: UnifiedMessage,
    step: TaskStep,
    context: TaskContext
  ): Promise<StepResult> {
    const transcript = message.content.body;

    // Analyze transcript with LLM
    const analysis = await this.analyzeTranscript(step, transcript);

    return {
      status: analysis.success ? "success" : "needs_user_input",
      extracted: analysis.extracted,
      summary: analysis.summary,
    };
  }

  private buildAgentPrompt(step: TaskStep, context: TaskContext): string {
    return `你是一个智能助理，正在代替用户打电话。

你的目标是：${step.goal || step.description}

背景信息：
- 你代表的用户：${context.userId}
- 通话对象：${step.target}
- 任务上下文：${JSON.stringify(context.stepResults || {})}

要求：
- 礼貌、友好、简洁
- 先自我介绍（XX 的智能助理）
- 直奔主题
- 对方同意后确认关键信息
- 对方拒绝时礼貌结束`;
  }

  private async analyzeTranscript(
    step: TaskStep,
    transcript: string
  ): Promise<{ success: boolean; extracted: Record<string, any>; summary: string }> {
    const prompt = `分析以下电话通话记录，判断是否达成目标。

通话目标：${step.goal || step.description}
通话记录：
${transcript}

输出 JSON 格式：
{
  "success": boolean,
  "extracted": { ... },
  "summary": "通话摘要"
}`;

    try {
      const response = await chat(prompt, transcript, { json: true });
      return JSON.parse(response);
    } catch {
      return {
        success: false,
        extracted: {},
        summary: "通话记录分析失败",
      };
    }
  }
}
