import { chat } from "../llm/client";
import { SlotDefinition, GoalContext } from "../types";

const COMPOSE_CONTACT_SYSTEM_PROMPT = `你是一个社交消息撰写助手。你帮用户的 AI 助手生成发送给联系人的消息。

## 规则
1. 语气自然友好，像朋友发消息一样
2. 首次联系要简单自我介绍（说明是帮谁来问的）
3. 一次最多问 1 个问题，不要让对方觉得在做问卷
4. 如果是追问，要基于之前的对话自然延续
5. 不要用太正式的语言，可以用口语化表达
6. 消息尽量简短，控制在 50 字以内
7. 提问时给对方具体选项，不要问开放性问题（比如"周六还是周日？"而不是"你什么时候有空？"）
8. 如果有 AI 给出的消息要点提示，按照提示的方向来写

## 输出
直接输出消息文本，不要加引号或其他格式。`;

const COMPOSE_CONFIRMATION_SYSTEM_PROMPT = `你是一个信息确认助手。你帮用户确认收集到的信息。

## 规则
1. 清晰地列出需要确认的信息
2. 用简洁的语言
3. 给出"确认"和"修改"两个选项

## 输出 JSON 格式
{
  "question": "确认以下信息是否正确？",
  "summary": "时间：周六下午3点\\n地点：XX餐厅",
  "options": ["确认，没问题", "需要修改"]
}`;

export class MessageComposer {
  async composeForContact(
    targetName: string,
    slotsToFill: SlotDefinition[],
    goalContext: GoalContext,
    history: Array<{ direction: string; body: string }>,
    isFirstContact: boolean,
    messageHint?: string
  ): Promise<{ message: string; targetSlots: string[] }> {
    const initiatorName =
      goalContext.parties.find((p) => p.role === "initiator")?.name || "我";

    const slotsDesc = slotsToFill
      .slice(0, 2) // Max 2 slots per message
      .map((s) => `- ${s.key}: ${s.description}`)
      .join("\n");

    const historyText =
      history.length > 0
        ? history
            .map(
              (m) =>
                `${m.direction === "outbound" ? "你" : targetName}: ${m.body}`
            )
            .join("\n")
        : "（首次联系）";

    const hintText = messageHint
      ? `\n## AI 消息要点提示\n${messageHint}\n（请按照这个方向来写消息）`
      : "";

    const userMessage = `## 任务
${goalContext.goal.description}

## 联系对象
${targetName}

## 是否首次联系
${isFirstContact ? "是，需要自我介绍（你是帮" + initiatorName + "来联系的AI助手）" : "否，继续之前的对话"}

## 对话历史
${historyText}

## 需要收集的信息
${slotsDesc}
${hintText}

请生成一条简短自然的消息（50字以内）。`;

    const message = await chat(COMPOSE_CONTACT_SYSTEM_PROMPT, userMessage);

    return {
      message: message.trim(),
      targetSlots: slotsToFill.slice(0, 2).map((s) => s.key),
    };
  }

  async composeUserConfirmation(
    goalContext: GoalContext,
    slotsToConfirm: SlotDefinition[]
  ): Promise<{ question: string; options: string[]; summary: string }> {
    const slotsDesc = slotsToConfirm
      .map((s) => `- ${s.description}: ${s.value}`)
      .join("\n");

    const userMessage = `## 任务
${goalContext.goal.description}

## 需要确认的信息
${slotsDesc}

请生成确认消息。`;

    const response = await chat(
      COMPOSE_CONFIRMATION_SYSTEM_PROMPT,
      userMessage,
      { json: true }
    );

    try {
      const result = JSON.parse(response);
      return {
        question: result.question || "请确认以下信息：",
        summary: result.summary || slotsDesc,
        options: result.options || ["确认，没问题", "需要修改"],
      };
    } catch {
      return {
        question: "请确认以下信息是否正确：",
        summary: slotsDesc,
        options: ["确认，没问题", "需要修改"],
      };
    }
  }

  async composeFinalNotification(
    targetName: string,
    goalContext: GoalContext
  ): Promise<string> {
    const filledSlots = goalContext.slots
      .filter((s) => s.value !== undefined)
      .map((s) => `${s.description}: ${s.value}`)
      .join(", ");

    const userMessage = `## 任务
${goalContext.goal.description}

## 已确认的信息
${filledSlots}

## 通知对象
${targetName}

生成一条简短的确认/通知消息，告知对方最终确定的安排。`;

    const message = await chat(COMPOSE_CONTACT_SYSTEM_PROMPT, userMessage);
    return message.trim();
  }
}
