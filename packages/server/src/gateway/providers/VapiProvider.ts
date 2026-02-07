import { CallResult } from "../../types";

interface VapiCallConfig {
  assistantId?: string;
  assistant?: {
    firstMessage: string;
    model: {
      provider: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    voice: {
      provider: string;
      voiceId: string;
    };
  };
  phoneNumberId?: string;
  customer: {
    number: string;
  };
}

export class VapiProvider {
  private apiKey: string;
  private baseUrl = "https://api.vapi.ai";

  constructor() {
    this.apiKey = process.env.VAPI_API_KEY || "";
  }

  async makeCall(
    to: string,
    agentPrompt: string,
    callGoal: string
  ): Promise<CallResult> {
    if (!this.apiKey) {
      // Mock mode when no API key
      console.log(`[Vapi Mock] Calling: ${to}, Goal: ${callGoal}`);
      return {
        success: true,
        callId: `mock_vapi_${Date.now()}`,
      };
    }

    const config: VapiCallConfig = {
      assistant: {
        firstMessage: `你好，我是智能助理。${callGoal}`,
        model: {
          provider: "openrouter",
          model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-20250514",
          messages: [
            {
              role: "system",
              content: agentPrompt,
            },
          ],
        },
        voice: {
          provider: "11labs",
          voiceId: "21m00Tcm4TlvDq8ikWAM",
        },
      },
      customer: {
        number: to,
      },
    };

    try {
      const response = await fetch(`${this.baseUrl}/call/phone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as { id: string };
      return {
        success: true,
        callId: data.id,
      };
    } catch (error: any) {
      console.error("[Vapi] Call error:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getCallTranscript(callId: string): Promise<string> {
    if (!this.apiKey) {
      return "[Mock transcript] 通话已完成，对方表示同意。";
    }

    try {
      const response = await fetch(`${this.baseUrl}/call/${callId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) return "";

      const data = (await response.json()) as { transcript?: string };
      return data.transcript || "";
    } catch {
      return "";
    }
  }
}
