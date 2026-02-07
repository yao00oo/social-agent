import Twilio from "twilio";
import { CallResult, Channel } from "../../types";
import { ChannelProvider, } from "../ChannelGateway";

export class TwilioVoiceProvider implements ChannelProvider {
  channel: Channel = "voice";
  private client: Twilio.Twilio | null = null;
  private fromNumber: string;

  constructor() {
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || "";

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      this.client = Twilio(accountSid, authToken);
    }
  }

  async send(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    // Voice provider doesn't support text send, delegate to makeCall
    return { success: false, error: "Use makeCall for voice channel" };
  }

  async makeCall(to: string, twimlUrl: string): Promise<CallResult> {
    if (!this.client) {
      console.log(`[Voice Mock] Calling: ${to}`);
      return {
        success: true,
        callId: `mock_call_${Date.now()}`,
      };
    }

    try {
      const call = await this.client.calls.create({
        url: twimlUrl,
        to: to,
        from: this.fromNumber,
      });

      return {
        success: true,
        callId: call.sid,
      };
    } catch (error: any) {
      console.error("[TwilioVoice] Call error:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
