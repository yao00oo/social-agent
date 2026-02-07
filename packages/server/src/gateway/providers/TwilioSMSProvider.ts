import Twilio from "twilio";
import { SendResult, Channel } from "../../types";
import { ChannelProvider } from "../ChannelGateway";

export class TwilioSMSProvider implements ChannelProvider {
  channel: Channel = "sms";
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

  async send(to: string, message: string): Promise<SendResult> {
    if (!this.client) {
      console.log(`[SMS Mock] To: ${to}, Message: ${message}`);
      return {
        success: true,
        messageId: `mock_sms_${Date.now()}`,
      };
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: to,
      });

      return {
        success: true,
        messageId: result.sid,
      };
    } catch (error: any) {
      console.error("[TwilioSMS] Send error:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
