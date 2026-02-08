import { chat } from "../llm/client";
import { GoalAnalysisResult, ContactInfo } from "../types";

const GOAL_ANALYZER_SYSTEM_PROMPT = `你是一个智能任务分析器。用户会给你一个社交指令，你需要分析出：

1. **goal（目标）**：这个指令想达成什么
2. **slots（信息槽）**：完成目标需要收集哪些信息
3. **parties（参与方）**：涉及哪些人
4. **postActions（后置动作）**：完成后需要做什么

## Goal Types
- scheduling: 约饭、约会议、约活动（需要协商时间/地点）
- notification: 通知、转达消息（单向传递信息）
- inquiry: 询问、打听（收集信息）
- introduction: 介绍、引荐（连接两个人）
- consultation: 咨询、请教（向他人请教问题）
- custom: 其他

## Slot Source 规则（非常重要）
每个 slot 必须指定 source，决定从哪里获取值：

- **context**: 可以直接从用户指令中提取的信息。如"周六约X" → time 的 source 是 context，value 是 "周六"
- **contact_negotiate**: 需要和联系人沟通协商的。如"约X吃饭" → time 的 source 是 contact_negotiate（要问对方什么时候有空）
- **user_preference**: 需要问用户本人偏好的。如约饭的 location 通常是 user_preference（用户选在哪吃）
- **agent_decide**: Agent 可以自己决定的，通常是格式性的东西

## confirmWithUser 规则
- 涉及时间、金钱、重要决定的 slot → confirmWithUser: true
- 从联系人那里协商得到的结果 → confirmWithUser: true
- 纯通知类信息 → confirmWithUser: false

## 分析示例

"帮我约X吃饭" →
- goal: scheduling
- slots: [
    { key: "time", description: "吃饭时间", required: true, source: "contact_negotiate", confirmWithUser: true },
    { key: "location", description: "餐厅/地点", required: false, source: "user_preference", confirmWithUser: false }
  ]
- parties: [{ name: "X", role: "target" }]

"周六约X吃饭" →
- goal: scheduling
- slots: [
    { key: "time", description: "吃饭时间", required: true, source: "context", value: "周六", confirmWithUser: false },
    { key: "location", description: "餐厅/地点", required: false, source: "user_preference", confirmWithUser: false }
  ]

"告诉X明天开会改到3点" →
- goal: notification
- slots: [
    { key: "message_content", description: "通知内容", required: true, source: "context", value: "明天开会改到3点", confirmWithUser: false }
  ]

"问X周末有没有空吃饭" →
- goal: scheduling
- slots: [
    { key: "availability", description: "对方是否有空", required: true, source: "contact_negotiate", confirmWithUser: true, extractionHint: "注意对方可能回复具体时间或者说没空" },
    { key: "time", description: "具体时间", required: true, source: "contact_negotiate", confirmWithUser: true },
    { key: "location", description: "地点", required: false, source: "user_preference", confirmWithUser: false }
  ]

请以 JSON 格式输出，格式如下：
{
  "goalType": "scheduling",
  "goalDescription": "约X吃饭",
  "slots": [...],
  "parties": [{ "name": "X", "role": "target" }],
  "postActions": [{ "type": "create_calendar_event", "params": {} }]
}`;

export class GoalAnalyzer {
  async analyze(
    instruction: string,
    contacts: ContactInfo[]
  ): Promise<GoalAnalysisResult> {
    const contactNames = contacts.map((c) => c.name).join(", ");

    const userMessage = `用户指令: "${instruction}"
已知联系人: [${contactNames}]

请分析这个指令的目标、所需信息槽、参与方和后置动作。`;

    const response = await chat(GOAL_ANALYZER_SYSTEM_PROMPT, userMessage, {
      json: true,
    });

    try {
      const result = JSON.parse(response) as GoalAnalysisResult;
      return this.validateAndNormalize(result);
    } catch (error) {
      console.error("[GoalAnalyzer] Failed to parse LLM response:", error);
      return this.fallbackAnalysis(instruction, contacts);
    }
  }

  private validateAndNormalize(result: GoalAnalysisResult): GoalAnalysisResult {
    const validGoalTypes = [
      "scheduling",
      "notification",
      "inquiry",
      "introduction",
      "consultation",
      "custom",
    ];
    if (!validGoalTypes.includes(result.goalType)) {
      result.goalType = "custom";
    }

    const validSources = [
      "user_preference",
      "contact_negotiate",
      "agent_decide",
      "context",
    ];
    for (const slot of result.slots) {
      if (!validSources.includes(slot.source)) {
        slot.source = "context";
      }
      if (slot.confirmWithUser === undefined) {
        slot.confirmWithUser = false;
      }
      if (slot.required === undefined) {
        slot.required = true;
      }
    }

    if (!result.parties) {
      result.parties = [];
    }
    if (!result.postActions) {
      result.postActions = [];
    }

    return result;
  }

  private fallbackAnalysis(
    instruction: string,
    contacts: ContactInfo[]
  ): GoalAnalysisResult {
    const parties = contacts.map((c) => ({
      name: c.name,
      role: "target" as const,
    }));

    return {
      goalType: "custom",
      goalDescription: instruction,
      slots: [
        {
          key: "message_content",
          description: "要传达的内容",
          required: true,
          source: "context",
          confirmWithUser: false,
          value: instruction,
        },
      ],
      parties,
      postActions: [],
    };
  }
}
