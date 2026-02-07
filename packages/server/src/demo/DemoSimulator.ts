/**
 * Demo Simulator - 模拟完整的任务执行流程，不需要任何外部 API。
 * 当 DEMO_MODE=true 时，跳过 LLM/Twilio 调用，用预设脚本驱动流程。
 */

import { v4 as uuid } from "uuid";
import { TaskStep, StepResult } from "../types";

interface DemoScript {
  trigger: RegExp;
  contactName: string;
  steps: Array<{
    type: string;
    description: string;
    target?: string;
    goal?: string;
    options?: string[];
    simulatedReply?: string;
    replyDelay?: number; // ms
  }>;
  completionSummary: Record<string, any>;
}

const DEMO_SCRIPTS: DemoScript[] = [
  {
    trigger: /约.*晚餐|吃饭/,
    contactName: "张三",
    steps: [
      {
        type: "contact_outreach",
        description: "给张三发短信询问晚餐时间",
        target: "张三",
        goal: "询问张三本周是否有空一起吃晚餐，了解他的时间偏好",
        simulatedReply: "周六晚上可以，周日也行，你看哪天方便？",
        replyDelay: 3000,
      },
      {
        type: "user_decision",
        description: "张三周六周日都有空，你选哪天？",
        options: ["周六晚上", "周日晚上"],
      },
      {
        type: "info_retrieval",
        description: "搜索附近评分较高的餐厅",
      },
      {
        type: "user_decision",
        description: "为你推荐了以下餐厅，请选择：",
        options: ["外婆家(西湖银泰店) - 杭帮菜 ¥68/人 ⭐4.6", "绿茶餐厅(龙井路店) - 创意杭菜 ¥75/人 ⭐4.5", "新白鹿(武林店) - 江浙菜 ¥55/人 ⭐4.4"],
      },
      {
        type: "contact_outreach",
        description: "通知张三确定的时间和餐厅",
        target: "张三",
        goal: "告知张三最终确定的晚餐时间和餐厅地点",
        simulatedReply: "好的没问题，到时候见！",
        replyDelay: 2000,
      },
      {
        type: "notification",
        description: "晚餐安排完成，已通知所有人",
      },
    ],
    completionSummary: {
      title: "晚餐已安排",
      icon: "🍽️",
    },
  },
  {
    trigger: /约.*打球|运动|篮球/,
    contactName: "李磊",
    steps: [
      {
        type: "contact_outreach",
        description: "给李磊发短信询问周末打球",
        target: "李磊",
        goal: "询问李磊周末是否有空一起打球",
        simulatedReply: "可以啊！周六下午怎么样？我知道一个不错的球场。",
        replyDelay: 3000,
      },
      {
        type: "user_decision",
        description: "李磊建议周六下午，他知道一个不错的球场。确认吗？",
        options: ["好的，就周六下午", "换个时间", "让他推荐球场"],
      },
      {
        type: "contact_outreach",
        description: "跟李磊确认最终安排",
        target: "李磊",
        goal: "确认打球的具体时间和地点",
        simulatedReply: "OK，那周六下午3点奥体中心见，我带球！",
        replyDelay: 2000,
      },
      {
        type: "notification",
        description: "打球安排完成，已与李磊确认",
      },
    ],
    completionSummary: {
      title: "打球已安排",
      icon: "🏀",
    },
  },
  {
    trigger: /通知.*会议|改期|取消/,
    contactName: "小组",
    steps: [
      {
        type: "user_decision",
        description: "请确认通知内容：",
        options: ["会议改到下周一", "会议取消", "会议改到本周五"],
      },
      {
        type: "contact_outreach",
        description: "给小组成员发送会议变更通知",
        target: "小组成员",
        goal: "通知所有成员会议变更",
        simulatedReply: "收到，谢谢通知！",
        replyDelay: 2000,
      },
      {
        type: "notification",
        description: "所有成员已收到通知",
      },
    ],
    completionSummary: {
      title: "通知已发送",
      icon: "📢",
    },
  },
];

export class DemoSimulator {
  static isDemoMode(): boolean {
    return process.env.DEMO_MODE === "true" || !process.env.OPENROUTER_API_KEY;
  }

  static findScript(instruction: string): DemoScript | null {
    return DEMO_SCRIPTS.find((s) => s.trigger.test(instruction)) || null;
  }

  static generatePlan(instruction: string): TaskStep[] | null {
    const script = this.findScript(instruction);
    if (!script) return null;

    return script.steps.map((step, index) => ({
      id: uuid(),
      type: step.type as any,
      description: step.description,
      target: step.target,
      channel: "sms" as const,
      goal: step.goal,
      options: step.options,
      status: "pending" as const,
      order: index,
    }));
  }

  static getSimulatedReply(stepDescription: string, instruction: string): { reply: string; delay: number } | null {
    const script = this.findScript(instruction);
    if (!script) return null;

    const stepDef = script.steps.find((s) => s.description === stepDescription);
    if (!stepDef?.simulatedReply) return null;

    return {
      reply: stepDef.simulatedReply,
      delay: stepDef.replyDelay || 2000,
    };
  }

  static generateOutboundMessage(
    step: { goal?: string; target?: string; description: string },
    instruction: string,
    isFirstContact: boolean
  ): string {
    const script = this.findScript(instruction);
    const target = step.target || "对方";

    if (instruction.match(/约.*晚餐|吃饭/)) {
      if (step.description.includes("询问")) {
        return `你好${target}，我是助理。想帮忙问一下，你这周有空一起吃个晚餐吗？周六或周日晚上方便吗？`;
      }
      if (step.description.includes("通知") || step.description.includes("确认")) {
        return `好消息！晚餐定好了，到时候见！我会把餐厅地址发给你。`;
      }
    }

    if (instruction.match(/约.*打球/)) {
      if (step.description.includes("询问")) {
        return `嗨${target}，周末有空一起打球吗？`;
      }
      if (step.description.includes("确认")) {
        return `太好了，那就这么定了！到时候见！`;
      }
    }

    if (instruction.match(/通知.*会议/)) {
      return `通知：会议时间有变更，请查收最新安排。有问题随时联系。`;
    }

    return `你好${target}，${step.goal || step.description}`;
  }

  static getCompletionSummary(instruction: string, context: Record<string, any>): Record<string, any> {
    const script = this.findScript(instruction);
    if (!script) {
      return { title: "任务完成", results: [] };
    }

    return {
      ...script.completionSummary,
      instruction,
      context,
    };
  }
}
