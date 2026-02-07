import { PrismaClient } from "@prisma/client";
import { EventEmitter } from "events";
import { TaskStep, StepResult, StepStatus, TaskStatus, UnifiedMessage, Channel } from "../types";

export interface StateChangeEvent {
  type: string;
  taskId: string;
  stepId?: string;
  data?: any;
}

export class TaskStateManager extends EventEmitter {
  constructor(private prisma: PrismaClient) {
    super();
  }

  async createTask(instruction: string, userId: string) {
    const task = await this.prisma.task.create({
      data: {
        userId,
        instruction,
        status: "created",
        context: {},
      },
    });

    this.emit("stateChange", {
      type: "task:created",
      taskId: task.id,
      data: { instruction },
    });

    return task;
  }

  async getTask(taskId: string) {
    return this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        steps: { orderBy: { order: "asc" } },
        messages: { orderBy: { timestamp: "asc" } },
      },
    });
  }

  async getAllTasks(userId?: string) {
    return this.prisma.task.findMany({
      where: userId ? { userId } : undefined,
      include: {
        steps: { orderBy: { order: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateTaskStatus(taskId: string, status: TaskStatus) {
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status },
    });

    this.emit("stateChange", {
      type: `task:${status}`,
      taskId,
      data: { status },
    });
  }

  async updateTaskContext(taskId: string, context: Record<string, any>) {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
    });

    const existingContext = (task.context as Record<string, any>) || {};
    const mergedContext = { ...existingContext, ...context };

    await this.prisma.task.update({
      where: { id: taskId },
      data: { context: mergedContext },
    });
  }

  async addSteps(taskId: string, steps: TaskStep[]) {
    for (const step of steps) {
      await this.prisma.step.create({
        data: {
          id: step.id,
          taskId,
          type: step.type,
          description: step.description,
          target: step.target,
          channel: step.channel,
          goal: step.goal,
          options: step.options || undefined,
          dependsOn: step.dependsOn || undefined,
          status: step.status,
          order: step.order,
        },
      });
    }
  }

  async updateStepStatus(
    taskId: string,
    stepId: string,
    status: StepStatus,
    result?: StepResult
  ) {
    await this.prisma.step.update({
      where: { id: stepId },
      data: {
        status,
        result: result ? (result as any) : undefined,
      },
    });

    this.emit("stateChange", {
      type: `step:${status}`,
      taskId,
      stepId,
      data: { status, result },
    });
  }

  async associateMessage(
    message: UnifiedMessage,
    taskId: string,
    stepId?: string
  ) {
    await this.prisma.message.create({
      data: {
        id: message.id,
        taskId,
        stepId: stepId || null,
        direction: message.direction,
        channel: message.channel,
        from: message.from,
        to: message.to,
        body: message.content.body,
        timestamp: message.timestamp,
      },
    });
  }

  async findTaskByInboundMessage(
    from: string,
    channel: Channel
  ): Promise<{ task: any; step: any } | null> {
    // Find an active step that's waiting for a response from this number
    const activeSteps = await this.prisma.step.findMany({
      where: {
        status: "waiting_response",
        task: {
          status: { in: ["executing", "waiting_reply"] },
        },
      },
      include: {
        task: true,
        messages: {
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
    });

    // Match by the outbound message 'to' field
    for (const step of activeSteps) {
      const lastOutbound = step.messages.find((m) => m.direction === "outbound");
      if (lastOutbound && lastOutbound.to === from) {
        return { task: step.task, step };
      }
    }

    // Fallback: find any active task and its waiting step
    // by checking contacts in task context
    const activeTasks = await this.prisma.task.findMany({
      where: {
        status: { in: ["executing", "waiting_reply"] },
      },
      include: {
        steps: {
          where: { status: "waiting_response" },
        },
      },
    });

    for (const task of activeTasks) {
      const context = task.context as any;
      if (context?.contacts) {
        for (const contact of context.contacts) {
          if (contact.channels?.sms === from || contact.channels?.voice === from) {
            const waitingStep = task.steps[0];
            if (waitingStep) {
              return { task, step: waitingStep };
            }
          }
        }
      }
    }

    return null;
  }

  async getStepMessages(stepId: string) {
    return this.prisma.message.findMany({
      where: { stepId },
      orderBy: { timestamp: "asc" },
    });
  }

  async getContacts(userId: string) {
    return this.prisma.contact.findMany({
      where: { userId },
    });
  }

  async findContactByName(userId: string, name: string) {
    return this.prisma.contact.findFirst({
      where: {
        userId,
        name: { contains: name },
      },
    });
  }
}
