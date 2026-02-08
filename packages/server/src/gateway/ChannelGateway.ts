import { ContactInfo, Channel, SendResult, CallResult } from "../types";
import { TwilioSMSProvider } from "./providers/TwilioSMSProvider";
import { TwilioVoiceProvider } from "./providers/TwilioVoiceProvider";
import { VapiProvider } from "./providers/VapiProvider";

export interface ChannelProvider {
  channel: Channel;
  send(to: string, message: string): Promise<SendResult>;
}

export class ChannelGateway {
  private smsProvider: TwilioSMSProvider;
  private voiceProvider: TwilioVoiceProvider;
  private vapiProvider: VapiProvider;

  constructor() {
    this.smsProvider = new TwilioSMSProvider();
    this.voiceProvider = new TwilioVoiceProvider();
    this.vapiProvider = new VapiProvider();
  }

  async send(
    contact: ContactInfo,
    message: string,
    preferredChannel?: Channel
  ): Promise<SendResult> {
    const channel = preferredChannel || contact.preferred || "sms";

    switch (channel) {
      case "sms": {
        const phone = contact.channels.sms;
        if (!phone) {
          return { success: false, error: `No SMS number for contact ${contact.name}` };
        }
        return this.smsProvider.send(phone, message);
      }
      case "voice": {
        const phone = contact.channels.voice || contact.channels.sms;
        if (!phone) {
          return { success: false, error: `No phone number for contact ${contact.name}` };
        }
        return this.voiceProvider.send(phone, message);
      }
      default:
        return { success: false, error: `Channel ${channel} not yet supported` };
    }
  }

  async sendSMS(to: string, message: string): Promise<SendResult> {
    return this.smsProvider.send(to, message);
  }

  async makeCall(
    to: string,
    agentPrompt: string,
    callGoal: string
  ): Promise<CallResult> {
    // MVP: Use Vapi for voice calls
    return this.vapiProvider.makeCall(to, agentPrompt, callGoal);
  }

  getSMSProvider(): TwilioSMSProvider {
    return this.smsProvider;
  }

  getVoiceProvider(): TwilioVoiceProvider {
    return this.voiceProvider;
  }

  getVapiProvider(): VapiProvider {
    return this.vapiProvider;
  }
}
