import { chat } from "../llm/client";
import { EvaluationResult, GoalContext } from "../types";

const EVALUATOR_SYSTEM_PROMPT = `你是一个社交任务评估器。你的职责是分析当前对话的完整状态，判断目标是否达成，并决定下一步该做什么。

你会收到：任务目标、所有 slot 状态、完整对话历史、最近发生的事件。

## 你需要输出的字段

1. **sentiment**: 联系人当前态度
   - "positive": 积极配合
   - "neutral": 正常沟通
   - "hesitant": 犹豫、没有明确答复
   - "negative": 有抵触情绪
   - "rejection": 明确拒绝

2. **goalAchieved**: 目标是否真正达成（布尔值）
3. **goalAchievedReason**: 判断理由

4. **nextAction**: 下一步该做什么（最关键的决策）
   - "message_contact": 需要给联系人发消息（协商/确认/回传用户选择/追问）
   - "ask_user": 需要问用户（选择/确认/告知情况）
   - "auto_decide": Agent 自主决定（不打扰用户）
   - "handle_rejection": 联系人拒绝了，尝试替代方案
   - "send_final_confirmation": 双方都同意了，发最终确认消息给联系人
   - "goal_achieved": 任务完成
   - "goal_failed": 任务失败，无法完成

5. **nextActionReason**: 为什么选这个 action
6. **messageHint**: 如果 nextAction 涉及发消息，给出消息要点提示
7. **userQuestion**: 如果 nextAction=ask_user，要问用户什么
8. **userOptions**: 如果 nextAction=ask_user，提供 2-3 个选项供快速选择
9. **slotUpdates**: 根据最新信息需要更新的 slot 值
10. **newRequirements**: 对话中发现的新需求（如"叫上小李"）

## 自主决策规则（返回 auto_decide，不打扰用户）

以下情况 Agent 应自主处理：
- 对方给了明确的时间 → 直接在 slotUpdates 里更新，然后 message_contact 确认
- 对方反问"什么事"/"有啥事" → message_contact 自然回答任务目的
- 对方说了一个合理的地点 → auto_decide 接受
- 对方给了 2 个时间选项，但都在未来 → 选较近的那个（auto_decide）

## 必须问用户的情况（返回 ask_user）

- 对方提议加入新的人（"叫上小李"）
- 对方的选项之间有明显差异需要用户取舍
- 对方提出了超出原始任务的事
- 对方表达了需要直接跟用户沟通的意愿
- 连续 3 轮对话无实质进展

## 完成条件（goalAchieved=true 的前提）

### scheduling（约饭/开会）
全部满足才算完成：
1. 时间：双方都明确同意了一个具体时间
2. 用户的选择/确认已经传达给联系人
3. 联系人的最后一条回复是确认性的（"好的"、"行"、"没问题"、"到时见"等）
4. 不能是 Agent 最后发了消息还没收到回复的状态

### notification（通知/传话）
1. 消息已送达联系人
2. 联系人有任何回应（哪怕只是"好""收到"）

### inquiry（询问/打听）
1. 从联系人回复中拿到了有效答案
2. 答案已告知用户

### 通用规则
- 如果 Agent 发了最终确认消息，且联系人还没回复 → goalAchieved=false，等回复
- 如果联系人最后的消息是疑问句 → goalAchieved=false，需要继续
- 如果已经 goal_achieved，不需要再发任何消息

## handle_rejection 策略
当联系人拒绝时：
1. 分析拒绝原因（时间不行？不想去？太忙？）
2. messageHint 里建议一个替代方案（如换时间、改线上）
3. 如果已经尝试过替代方案还是拒绝 → 返回 ask_user 让用户决定

## 输出 JSON 格式
{
  "sentiment": "positive",
  "goalAchieved": false,
  "goalAchievedReason": "联系人说了后天有空，但用户还没确认",
  "nextAction": "ask_user",
  "nextActionReason": "联系人给了两个选项，需要用户选择",
  "messageHint": null,
  "userQuestion": "Yao 说明天或后天都行，你想约哪天？",
  "userOptions": ["明天", "后天"],
  "slotUpdates": [{"key": "availability", "value": "available", "source": "contact"}],
  "newRequirements": []
}`;

export class ConversationEvaluator {
  async evaluate(
    goalContext: GoalContext,
    messageHistories: Record<string, Array<{ direction: string; body: string }>>,
    latestEvent?: { type: string; content: string; from: string }
  ): Promise<EvaluationResult> {
    // Build full context for the AI
    const slotsDesc = goalContext.slots
      .map(
        (s) =>
          `- ${s.key} (${s.description}): ${s.value !== undefined ? `"${s.value}" [来源: ${s.filledBy || "unknown"}, 已确认: ${s.confirmed}]` : "未填"} [required: ${s.required}, source: ${s.source}]`
      )
      .join("\n");

    const partiesDesc = goalContext.parties
      .map((p) => `- ${p.name} (${p.role})`)
      .join("\n");

    const historiesDesc = Object.entries(messageHistories)
      .map(([name, msgs]) => {
        if (msgs.length === 0) return `### ${name}\n（暂无对话）`;
        const formatted = msgs
          .map((m) => `${m.direction === "outbound" ? "Agent" : name}: ${m.body}`)
          .join("\n");
        return `### ${name}\n${formatted}`;
      })
      .join("\n\n");

    const latestEventDesc = latestEvent
      ? `\n## 刚刚发生的事件\n类型: ${latestEvent.type}\n来自: ${latestEvent.from}\n内容: ${latestEvent.content}`
      : "";

    const userMessage = `## 任务目标
类型: ${goalContext.goal.type}
描述: ${goalContext.goal.description}
原始指令: ${goalContext.goal.originalInstruction}

## 参与方
${partiesDesc}

## 信息槽状态
${slotsDesc}

## 对话历史
${historiesDesc}
${latestEventDesc}

## 当前对话轮次
总共已交互 ${goalContext.loopCount || 0} 轮

请分析当前状态，判断目标是否达成，决定下一步动作。`;

    const response = await chat(EVALUATOR_SYSTEM_PROMPT, userMessage, {
      json: true,
    });

    try {
      const result = JSON.parse(response) as EvaluationResult;
      return this.validate(result);
    } catch (error) {
      console.error("[ConversationEvaluator] Failed to parse LLM response:", error);
      // Safe fallback: ask user what to do
      return {
        sentiment: "neutral",
        goalAchieved: false,
        goalAchievedReason: "评估失败，需要人工判断",
        nextAction: "ask_user",
        nextActionReason: "AI 评估出错，请用户确认当前情况",
        userQuestion: "AI 助手遇到了一些困难，请确认任务是否继续？",
        userOptions: ["继续", "取消任务"],
        slotUpdates: [],
      };
    }
  }

  private validate(result: EvaluationResult): EvaluationResult {
    const validActions: EvaluationResult["nextAction"][] = [
      "message_contact",
      "ask_user",
      "auto_decide",
      "handle_rejection",
      "send_final_confirmation",
      "goal_achieved",
      "goal_failed",
    ];
    if (!validActions.includes(result.nextAction)) {
      result.nextAction = "ask_user";
    }

    const validSentiments: EvaluationResult["sentiment"][] = [
      "positive",
      "neutral",
      "hesitant",
      "negative",
      "rejection",
    ];
    if (!validSentiments.includes(result.sentiment)) {
      result.sentiment = "neutral";
    }

    if (!Array.isArray(result.slotUpdates)) {
      result.slotUpdates = [];
    }
    if (!Array.isArray(result.newRequirements)) {
      result.newRequirements = [];
    }
    if (result.goalAchieved === undefined) {
      result.goalAchieved = false;
    }

    return result;
  }
}
