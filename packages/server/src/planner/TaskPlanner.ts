import { v4 as uuid } from "uuid";
import { chat } from "../llm/client";
import { TaskStep, TaskPlan, TaskContext, StepResult } from "../types";
import { PLANNER_SYSTEM_PROMPT, REPLANNER_SYSTEM_PROMPT } from "./prompts";

interface PlannerStep {
  type: string;
  description: string;
  target?: string;
  channel?: string;
  goal?: string;
  options?: string[];
  dependsOn?: number[];
}

export class TaskPlanner {
  async plan(instruction: string, userId: string, contacts?: string[]): Promise<TaskPlan> {
    const contactInfo = contacts?.length
      ? `\n可用的联系人: ${contacts.join(", ")}`
      : "";

    const userMessage = `用户指令: ${instruction}${contactInfo}`;

    try {
      const response = await chat(PLANNER_SYSTEM_PROMPT, userMessage, { json: true });
      const parsed = JSON.parse(response);

      const steps: TaskStep[] = (parsed.steps || []).map(
        (step: PlannerStep, index: number) => ({
          id: uuid(),
          type: step.type,
          description: step.description,
          target: step.target,
          channel: step.channel || "sms",
          goal: step.goal,
          options: step.options,
          dependsOn: step.dependsOn?.map((i: number) => String(i)),
          status: "pending" as const,
          order: index,
        })
      );

      // Resolve dependsOn from indices to actual step IDs
      for (const step of steps) {
        if (step.dependsOn) {
          step.dependsOn = step.dependsOn.map((indexStr) => {
            const idx = parseInt(indexStr, 10);
            return steps[idx]?.id || indexStr;
          });
        }
      }

      return {
        taskId: "",
        instruction,
        steps,
        context: {},
      };
    } catch (error) {
      console.error("[TaskPlanner] Plan error:", error);
      // Fallback: create a simple single-step plan
      return this.createFallbackPlan(instruction);
    }
  }

  async replan(
    task: {
      instruction: string;
      completedSteps: Array<{ description: string; result: StepResult }>;
      remainingSteps: TaskStep[];
      context: Record<string, any>;
    }
  ): Promise<{ needsReplan: boolean; newSteps?: TaskStep[]; skipStepIds?: string[] } | null> {
    const userMessage = JSON.stringify({
      instruction: task.instruction,
      completedSteps: task.completedSteps.map((s) => ({
        description: s.description,
        result: s.result,
      })),
      remainingSteps: task.remainingSteps.map((s) => ({
        id: s.id,
        description: s.description,
        type: s.type,
      })),
      context: task.context,
    });

    try {
      const response = await chat(REPLANNER_SYSTEM_PROMPT, userMessage, { json: true });
      const parsed = JSON.parse(response);

      if (!parsed.needsReplan) return null;

      const newSteps: TaskStep[] = (parsed.newSteps || []).map(
        (step: PlannerStep, index: number) => ({
          id: uuid(),
          type: step.type,
          description: step.description,
          target: step.target,
          channel: step.channel || "sms",
          goal: step.goal,
          options: step.options,
          status: "pending" as const,
          order: 100 + index, // append after existing steps
        })
      );

      return {
        needsReplan: true,
        newSteps,
        skipStepIds: parsed.skipStepIds || [],
      };
    } catch (error) {
      console.error("[TaskPlanner] Replan error:", error);
      return null;
    }
  }

  private createFallbackPlan(instruction: string): TaskPlan {
    return {
      taskId: "",
      instruction,
      steps: [
        {
          id: uuid(),
          type: "user_decision",
          description: "无法自动规划，请用户提供更多信息",
          goal: instruction,
          options: ["重新描述任务", "取消"],
          status: "pending",
          order: 0,
        },
      ],
      context: {},
    };
  }
}
