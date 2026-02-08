import { chat } from "../llm/client";
import { SlotExtractionResult, SlotDefinition, GoalContext } from "../types";

const SLOT_EXTRACTOR_SYSTEM_PROMPT = `你是一个信息提取器。从联系人的回复中提取结构化信息。

你会收到：
1. 联系人的回复文本
2. 对话历史
3. 需要提取的目标 slots（信息槽）
4. 当前任务的上下文

## 提取规则

1. 只提取有明确依据的信息，不要猜测
2. 每个提取的值附带 confidence 分数（0-1）：
   - 1.0: 明确说了，如"周六下午3点" → time confidence: 1.0
   - 0.8-0.9: 基本可以确定，如"周末都行" → time confidence: 0.8
   - 0.5-0.7: 有些模糊，如"最近比较忙" → availability confidence: 0.5
   - < 0.5: 不确定，不要提取
3. 判断对话是否已达成目标（conversationDone）
4. 判断是否需要追问（needsFollowUp），以及原因

## 输出格式
{
  "extracted": [
    { "key": "time", "value": "周六下午3点", "confidence": 1.0 },
    { "key": "availability", "value": "available", "confidence": 0.9 }
  ],
  "conversationDone": false,
  "needsFollowUp": true,
  "followUpReason": "对方说了周六有空，但还没确认具体时间"
}

## 注意
- 如果对方拒绝了（如"没空"、"不行"），也要提取，如 availability: "unavailable"
- 如果对方提出反问或新条件，标记 needsFollowUp: true
- 如果所有 required slots 都已提取到高置信度的值，标记 conversationDone: true`;

export class SlotExtractor {
  async extract(
    replyText: string,
    messageHistory: Array<{ direction: string; body: string }>,
    targetSlots: SlotDefinition[],
    goalContext: GoalContext
  ): Promise<SlotExtractionResult> {
    const slotsDescription = targetSlots
      .map(
        (s) =>
          `- ${s.key}: ${s.description} (required: ${s.required})${s.extractionHint ? ` [提示: ${s.extractionHint}]` : ""}`
      )
      .join("\n");

    const historyText = messageHistory
      .map((m) => `${m.direction === "outbound" ? "Agent" : "联系人"}: ${m.body}`)
      .join("\n");

    const userMessage = `## 当前目标
${goalContext.goal.description}

## 对话历史
${historyText}

## 最新回复
联系人: ${replyText}

## 需要提取的信息
${slotsDescription}

## 已有信息
${targetSlots
  .filter((s) => s.value !== undefined)
  .map((s) => `- ${s.key}: ${s.value}`)
  .join("\n") || "（暂无）"}

请提取信息并判断对话状态。`;

    const response = await chat(SLOT_EXTRACTOR_SYSTEM_PROMPT, userMessage, {
      json: true,
    });

    try {
      const result = JSON.parse(response) as SlotExtractionResult;
      return this.validateExtraction(result, targetSlots);
    } catch (error) {
      console.error("[SlotExtractor] Failed to parse LLM response:", error);
      return {
        extracted: [],
        conversationDone: false,
        needsFollowUp: true,
        followUpReason: "无法理解回复内容，需要重新确认",
      };
    }
  }

  private validateExtraction(
    result: SlotExtractionResult,
    targetSlots: SlotDefinition[]
  ): SlotExtractionResult {
    const validSlotKeys = new Set(targetSlots.map((s) => s.key));

    // Filter out extracted values with low confidence or unknown keys
    result.extracted = (result.extracted || []).filter(
      (e) => validSlotKeys.has(e.key) && e.confidence >= 0.7
    );

    if (result.conversationDone === undefined) {
      result.conversationDone = false;
    }
    if (result.needsFollowUp === undefined) {
      result.needsFollowUp = false;
    }

    return result;
  }
}
