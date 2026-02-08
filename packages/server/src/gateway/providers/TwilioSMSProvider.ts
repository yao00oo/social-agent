import Twilio from "twilio";
import { SendResult, Channel } from "../../types";
import { ChannelProvider } from "../ChannelGateway";

/**
 * Normalize a phone number to E.164 format.
 * Supports China (+86) and US (+1) numbers.
 */
export function normalizePhoneNumber(phone: string): string {
  // Strip all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, "");

  // Already in E.164 format
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // China mobile: 11 digits starting with 1
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+86${cleaned}`;
  }

  // US/Canada: 10 digits
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  // Has country code without +: 11 digits starting with 1 (US) or 13+ digits starting with 86
  if (cleaned.length === 11 && !cleaned.startsWith("1")) {
    // Could be US with country code
    return `+${cleaned}`;
  }
  if (cleaned.startsWith("86") && cleaned.length === 13) {
    return `+${cleaned}`;
  }

  // Fallback: prepend + if it looks like a full number
  if (cleaned.length >= 10) {
    return `+${cleaned}`;
  }

  return cleaned;
}

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

    const normalizedTo = normalizePhoneNumber(to);
    const useWhatsApp = process.env.TWILIO_USE_WHATSAPP === "true";

    const fromAddr = useWhatsApp
      ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || "+14155238886"}`
      : this.fromNumber;
    const toAddr = useWhatsApp ? `whatsapp:${normalizedTo}` : normalizedTo;
    const tag = useWhatsApp ? "TwilioWhatsApp" : "TwilioSMS";

    try {
      const result = await this.client.messages.create({
        body: message,
        from: fromAddr,
        to: toAddr,
      });

      console.log(`[${tag}] Sent to ${toAddr}, SID: ${result.sid}`);

      return {
        success: true,
        messageId: result.sid,
      };
    } catch (error: any) {
      const twilioCode = error.code || "unknown";
      const moreInfo = error.moreInfo || "";
      console.error(
        `[${tag}] Send error: code=${twilioCode}, message="${error.message}"` +
          (moreInfo ? `, info=${moreInfo}` : "")
      );
      return {
        success: false,
        error: `Twilio error ${twilioCode}: ${error.message}`,
      };
    }
  }
}
