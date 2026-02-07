import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { PrismaClient } from "@prisma/client";

import { SocketManager } from "./socket";
import { Orchestrator } from "./orchestrator";
import { TaskPlanner } from "./planner/TaskPlanner";
import { ConversationExecutor } from "./executor/ConversationExecutor";
import { DecisionRouter } from "./router/DecisionRouter";
import { ChannelGateway } from "./gateway/ChannelGateway";
import { TaskStateManager } from "./state/TaskStateManager";
import { createWebhookRouter } from "./gateway/webhooks";

const PORT = parseInt(process.env.PORT || "3001", 10);

async function main() {
  // Initialize Prisma
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("[DB] Connected to PostgreSQL");

  // Express + HTTP server
  const app = express();
  const httpServer = createServer(app);

  // Middleware
  app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Initialize modules
  const socketManager = new SocketManager(httpServer);
  const gateway = new ChannelGateway();
  const planner = new TaskPlanner();
  const executor = new ConversationExecutor(gateway);
  const router = new DecisionRouter();
  const state = new TaskStateManager(prisma);

  const orchestrator = new Orchestrator(
    planner,
    executor,
    router,
    gateway,
    state,
    socketManager
  );

  // ===== REST API routes =====

  // Create task
  app.post("/api/task", async (req, res) => {
    try {
      const { instruction, userId } = req.body;
      if (!instruction) {
        return res.status(400).json({ error: "instruction is required" });
      }
      const task = await orchestrator.handleInstruction(
        userId || "default-user",
        instruction
      );
      res.json({ taskId: task.id, status: "created" });
    } catch (error: any) {
      console.error("[API] Create task error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get task
  app.get("/api/task/:id", async (req, res) => {
    try {
      const task = await state.getTask(req.params.id);
      res.json(task);
    } catch (error: any) {
      res.status(404).json({ error: "Task not found" });
    }
  });

  // List tasks
  app.get("/api/tasks", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const tasks = await state.getAllTasks(userId);
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get contacts
  app.get("/api/contacts", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || "default-user";
      const contacts = await state.getContacts(userId);
      res.json(contacts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create contact
  app.post("/api/contacts", async (req, res) => {
    try {
      const { name, sms, voice, telegram, email, preferred, relation, userId } = req.body;
      const contact = await prisma.contact.create({
        data: {
          userId: userId || "default-user",
          name,
          relation,
          sms,
          voice,
          telegram,
          email,
          preferred: preferred || "sms",
        },
      });
      res.json(contact);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Webhook routes =====
  const webhookRouter = createWebhookRouter(async (message) => {
    await orchestrator.handleInboundMessage(message);
  });
  app.use("/webhook", webhookRouter);

  // ===== Socket.IO events =====
  socketManager.onUserDecision(async (data) => {
    try {
      await orchestrator.handleUserDecision(data.taskId, data.stepId, data.choice);
    } catch (error) {
      console.error("[Socket] Decision handling error:", error);
    }
  });

  socketManager.onTaskCreate(async (data, callback) => {
    try {
      const task = await orchestrator.handleInstruction("default-user", data.instruction);
      if (callback) callback({ taskId: task.id });
    } catch (error: any) {
      console.error("[Socket] Task create error:", error);
      if (callback) callback({ error: error.message });
    }
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Start server
  httpServer.listen(PORT, () => {
    console.log(`[Server] Social Agent running on port ${PORT}`);
    console.log(`[Server] Webhook URL: ${process.env.WEBHOOK_BASE_URL || `http://localhost:${PORT}`}/webhook`);
  });
}

main().catch((error) => {
  console.error("[Server] Fatal error:", error);
  process.exit(1);
});
