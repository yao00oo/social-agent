import { TaskStep, StepResult, TaskContext, UnifiedMessage } from "../types";
import { TextExecutor } from "./TextExecutor";
import { VoiceExecutor } from "./VoiceExecutor";
import { ChannelGateway } from "../gateway/ChannelGateway";

export class ConversationExecutor {
  private textExecutor: TextExecutor;
  private voiceExecutor: VoiceExecutor;

  constructor(private gateway: ChannelGateway) {
    this.textExecutor = new TextExecutor(gateway);
    this.voiceExecutor = new VoiceExecutor(gateway);
  }

  async startStep(
    step: TaskStep,
    context: TaskContext
  ): Promise<{ message?: string; waitingForReply: boolean }> {
    if (step.type === "phone_call") {
      return this.voiceExecutor.startStep(step, context);
    }

    if (step.type === "contact_outreach" || step.type === "notification") {
      return this.textExecutor.startStep(step, context);
    }

    // info_retrieval: handle synchronously
    if (step.type === "info_retrieval") {
      return { message: undefined, waitingForReply: false };
    }

    return { waitingForReply: false };
  }

  async handleReply(
    message: UnifiedMessage,
    step: TaskStep,
    context: TaskContext,
    messageHistory?: Array<{ direction: string; body: string }>
  ): Promise<StepResult> {
    if (message.channel === "voice") {
      return this.voiceExecutor.handleReply(message, step, context);
    }

    return this.textExecutor.handleReply(message, step, context, messageHistory);
  }
}
