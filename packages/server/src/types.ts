// ===== Channel & Contact Types =====

export type Channel = "sms" | "voice" | "telegram" | "email";

export interface ContactInfo {
  id: string;
  name: string;
  channels: {
    sms?: string;
    telegram?: string;
    email?: string;
    voice?: string;
  };
  preferred: Channel;
}

// ===== Unified Message =====

export interface UnifiedMessage {
  id: string;
  taskId: string;
  stepId: string;
  direction: "inbound" | "outbound";
  channel: Channel;
  from: string;
  to: string;
  content: {
    type: "text" | "audio";
    body: string;
  };
  timestamp: Date;
}

// ===== Task & Step Types =====

export type StepType =
  | "contact_outreach"
  | "user_decision"
  | "info_retrieval"
  | "phone_call"
  | "notification";

export type StepStatus =
  | "pending"
  | "executing"
  | "waiting_response"
  | "waiting_user"
  | "done"
  | "failed";

export type TaskStatus =
  | "created"
  | "planning"
  | "executing"
  | "waiting_user"
  | "waiting_reply"
  | "completed"
  | "failed";

export interface TaskStep {
  id: string;
  type: StepType;
  description: string;
  target?: string;
  channel?: Channel;
  goal?: string;
  options?: string[];
  dependsOn?: string[];
  status: StepStatus;
  result?: StepResult;
  order: number;
}

export interface TaskPlan {
  taskId: string;
  instruction: string;
  steps: TaskStep[];
  context: Record<string, any>;
}

export interface StepResult {
  status: "success" | "failed" | "needs_user_input";
  extracted: Record<string, any>;
  summary: string;
}

// ===== Gateway Types =====

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface CallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

// ===== Decision Router Types =====

export interface DecisionResult {
  action: "auto_execute" | "ask_user";
  reason: string;
  userPrompt?: {
    question: string;
    options?: string[];
    allowFreeInput: boolean;
  };
}

// ===== Task Context =====

export interface TaskContext {
  taskId: string;
  userId: string;
  instruction: string;
  contacts: ContactInfo[];
  stepResults: Record<string, StepResult>;
  [key: string]: any;
}

// ===== Socket.IO Event Types =====

export interface ServerToClientEvents {
  "step:started": (data: { taskId: string; stepId: string; description: string; type: StepType }) => void;
  "step:message_sent": (data: { taskId: string; stepId: string; message: string; to: string }) => void;
  "step:reply_received": (data: { taskId: string; stepId: string; from: string; message: string }) => void;
  "step:need_decision": (data: {
    taskId: string;
    stepId: string;
    question: string;
    options?: string[];
    allowFreeInput: boolean;
  }) => void;
  "step:completed": (data: { taskId: string; stepId: string; summary: string }) => void;
  "task:completed": (data: { taskId: string; summary: Record<string, any> }) => void;
  "task:error": (data: { taskId: string; error: string }) => void;
}

export interface ClientToServerEvents {
  "user:decision": (data: { taskId: string; stepId: string; choice: string }) => void;
  "task:create": (data: { instruction: string }) => void;
}

// ===== LLM Reply Analysis =====

export interface ReplyAnalysis {
  intent: "agree" | "reject" | "question" | "unclear" | "off_topic";
  extracted_data: Record<string, any>;
  goal_achieved: boolean;
  next_action: "reply" | "escalate" | "end";
  suggested_reply?: string;
}

// ===== Goal + Slots Engine Types =====

export type GoalType =
  | "scheduling"
  | "notification"
  | "inquiry"
  | "introduction"
  | "consultation"
  | "custom";

export type SlotSource =
  | "user_preference"
  | "contact_negotiate"
  | "agent_decide"
  | "context";

export type ConversationPhase =
  | "analyzing"
  | "gathering"
  | "confirming"
  | "executing_post"
  | "completed"
  | "failed";

export type Sentiment =
  | "positive"
  | "neutral"
  | "hesitant"
  | "negative"
  | "rejection";

export type NextAction =
  | "message_contact"
  | "ask_user"
  | "auto_decide"
  | "handle_rejection"
  | "send_final_confirmation"
  | "goal_achieved"
  | "goal_failed";

export interface EvaluationResult {
  sentiment: Sentiment;
  goalAchieved: boolean;
  goalAchievedReason: string;
  nextAction: NextAction;
  nextActionReason: string;
  messageHint?: string;
  userQuestion?: string;
  userOptions?: string[];
  slotUpdates: Array<{ key: string; value: any; source: string }>;
  newRequirements?: string[];
}

export interface SlotDefinition {
  key: string;
  description: string;
  required: boolean;
  source: SlotSource;
  confirmWithUser: boolean;
  value?: any;
  confirmed?: boolean;
  filledBy?: string;
  extractionHint?: string;
}

export interface GoalContext {
  goal: {
    type: GoalType;
    description: string;
    originalInstruction: string;
  };
  slots: SlotDefinition[];
  parties: Array<{
    name: string;
    role: "initiator" | "target";
    contactId?: string;
    channel?: Channel;
    channelAddress?: string;
  }>;
  /** @deprecated Kept for backwards compat; ReAct loop uses EvaluationResult.nextAction instead */
  conversationPhase: ConversationPhase;
  pendingConfirmations: string[];
  postActions: Array<{
    type: string;
    params: Record<string, any>;
  }>;
  activeConversations: Record<
    string,
    {
      stepId: string;
      targetName: string;
      slotsBeingCollected: string[];
      messageCount: number;
      status: "active" | "completed" | "failed";
    }
  >;
  /** Number of consecutive advance() calls in this task (safety counter) */
  loopCount?: number;
}

export interface GoalAnalysisResult {
  goalType: GoalType;
  goalDescription: string;
  slots: Array<{
    key: string;
    description: string;
    required: boolean;
    source: SlotSource;
    confirmWithUser: boolean;
    value?: any;
    extractionHint?: string;
  }>;
  parties: Array<{
    name: string;
    role: "initiator" | "target";
  }>;
  postActions: Array<{
    type: string;
    params: Record<string, any>;
  }>;
}

export interface SlotExtractionResult {
  extracted: Array<{
    key: string;
    value: any;
    confidence: number;
  }>;
  conversationDone: boolean;
  needsFollowUp: boolean;
  followUpReason?: string;
}
