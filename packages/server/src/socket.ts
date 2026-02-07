import { Server as HTTPServer } from "http";
import { Server, Socket } from "socket.io";
import { StateChangeEvent } from "./state/TaskStateManager";
import { StepType } from "./types";

export class SocketManager {
  private io: Server;

  constructor(httpServer: HTTPServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
      },
    });

    this.io.on("connection", (socket: Socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      socket.on("disconnect", () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
      });
    });
  }

  onUserDecision(
    handler: (data: { taskId: string; stepId: string; choice: string }) => void
  ) {
    this.io.on("connection", (socket: Socket) => {
      socket.on("user:decision", handler);
    });
  }

  onTaskCreate(
    handler: (data: { instruction: string }, callback: (result: any) => void) => void
  ) {
    this.io.on("connection", (socket: Socket) => {
      socket.on("task:create", handler);
    });
  }

  broadcastStateChange(event: StateChangeEvent) {
    this.io.emit("state:change", event);
  }

  emitStepStarted(
    taskId: string,
    stepId: string,
    data: { description: string; type: StepType }
  ) {
    this.io.emit("step:started", { taskId, stepId, ...data });
  }

  emitMessageSent(
    taskId: string,
    stepId: string,
    data: { message: string; to: string }
  ) {
    this.io.emit("step:message_sent", { taskId, stepId, ...data });
  }

  emitReplyReceived(
    taskId: string,
    stepId: string,
    data: { from: string; message: string }
  ) {
    this.io.emit("step:reply_received", { taskId, stepId, ...data });
  }

  emitNeedDecision(
    taskId: string,
    stepId: string,
    data: { question: string; options?: string[]; allowFreeInput: boolean }
  ) {
    this.io.emit("step:need_decision", { taskId, stepId, ...data });
  }

  emitStepCompleted(taskId: string, stepId: string, summary: string) {
    this.io.emit("step:completed", { taskId, stepId, summary });
  }

  emitTaskCompleted(taskId: string, summary: Record<string, any>) {
    this.io.emit("task:completed", { taskId, summary });
  }

  emitTaskError(taskId: string, error: string) {
    this.io.emit("task:error", { taskId, error });
  }
}
