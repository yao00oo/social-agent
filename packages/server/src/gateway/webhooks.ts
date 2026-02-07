import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { UnifiedMessage } from "../types";

export type InboundMessageHandler = (message: UnifiedMessage) => Promise<void>;

export function createWebhookRouter(onMessage: InboundMessageHandler): Router {
  const router = Router();

  // Twilio SMS webhook
  router.post("/twilio/sms", async (req: Request, res: Response) => {
    try {
      const { From, To, Body, MessageSid } = req.body;

      console.log(`[Webhook] SMS from ${From}: ${Body}`);

      const message: UnifiedMessage = {
        id: MessageSid || uuid(),
        taskId: "", // will be resolved by orchestrator
        stepId: "", // will be resolved by orchestrator
        direction: "inbound",
        channel: "sms",
        from: From,
        to: To,
        content: {
          type: "text",
          body: Body,
        },
        timestamp: new Date(),
      };

      await onMessage(message);

      // Respond with empty TwiML to acknowledge
      res.type("text/xml").send("<Response></Response>");
    } catch (error) {
      console.error("[Webhook] SMS error:", error);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // Twilio Voice status callback
  router.post("/twilio/voice", async (req: Request, res: Response) => {
    try {
      const { CallSid, CallStatus, From, To } = req.body;
      console.log(`[Webhook] Voice status: ${CallSid} -> ${CallStatus}`);
      res.type("text/xml").send("<Response></Response>");
    } catch (error) {
      console.error("[Webhook] Voice error:", error);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // Vapi webhook (call ended, transcript ready)
  router.post("/vapi", async (req: Request, res: Response) => {
    try {
      const { message: vapiMessage } = req.body;

      if (vapiMessage?.type === "end-of-call-report") {
        const transcript = vapiMessage.transcript || "";
        const callId = vapiMessage.call?.id || "";

        console.log(`[Webhook] Vapi call ended: ${callId}`);

        const message: UnifiedMessage = {
          id: uuid(),
          taskId: "",
          stepId: "",
          direction: "inbound",
          channel: "voice",
          from: vapiMessage.call?.customer?.number || "",
          to: "",
          content: {
            type: "text",
            body: transcript,
          },
          timestamp: new Date(),
        };

        await onMessage(message);
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("[Webhook] Vapi error:", error);
      res.json({ ok: true });
    }
  });

  return router;
}
