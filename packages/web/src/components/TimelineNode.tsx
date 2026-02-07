import {
  MessageSquare,
  Send,
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  Phone,
  Loader2,
} from "lucide-react";
import { TimelineEvent } from "../hooks/useSocket";

interface TimelineNodeProps {
  event: TimelineEvent;
  isLast: boolean;
}

function getNodeConfig(event: TimelineEvent) {
  switch (event.type) {
    case "step_started":
      return {
        borderColor: "border-l-primary-400",
        bgColor: "bg-primary-50",
        icon: event.data.type === "phone_call" ? Phone : MessageSquare,
        iconColor: "text-primary-500",
        label: event.data.description,
        showSpinner: true,
      };
    case "message_sent":
      return {
        borderColor: "border-l-primary-400",
        bgColor: "bg-white",
        icon: Send,
        iconColor: "text-primary-500",
        label: `发送给 ${event.data.to}`,
        content: event.data.message,
      };
    case "reply_received":
      return {
        borderColor: "border-l-gray-400",
        bgColor: "bg-gray-50",
        icon: MessageCircle,
        iconColor: "text-gray-500",
        label: `${event.data.from} 回复`,
        content: event.data.message,
      };
    case "step_completed":
      return {
        borderColor: "border-l-green-400",
        bgColor: "bg-green-50",
        icon: CheckCircle2,
        iconColor: "text-green-500",
        label: event.data.summary,
      };
    case "task_error":
      return {
        borderColor: "border-l-red-400",
        bgColor: "bg-red-50",
        icon: AlertCircle,
        iconColor: "text-red-500",
        label: event.data.error || "任务出错",
      };
    default:
      return {
        borderColor: "border-l-gray-300",
        bgColor: "bg-white",
        icon: MessageSquare,
        iconColor: "text-gray-400",
        label: "...",
      };
  }
}

export default function TimelineNode({ event, isLast }: TimelineNodeProps) {
  const config = getNodeConfig(event);
  const Icon = config.icon;

  return (
    <div className="relative pl-10 pb-4 animate-fade-in-up">
      {/* Dot on the line */}
      <div
        className={`absolute left-2.5 top-3 w-3 h-3 rounded-full border-2 border-white ${
          event.type === "step_completed"
            ? "bg-green-400"
            : event.type === "reply_received"
            ? "bg-gray-400"
            : event.type === "task_error"
            ? "bg-red-400"
            : "bg-primary-400"
        }`}
      />

      {/* Card */}
      <div
        className={`border-l-4 ${config.borderColor} ${config.bgColor} rounded-r-lg p-3 shadow-sm`}
      >
        <div className="flex items-start gap-2">
          <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.iconColor}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-800">{config.label}</p>
              {config.showSpinner && (
                <Loader2 className="w-3.5 h-3.5 text-primary-400 animate-spin" />
              )}
            </div>
            {config.content && (
              <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                {config.content}
              </p>
            )}
            <time className="text-xs text-gray-400 mt-1 block">
              {event.timestamp.toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </time>
          </div>
        </div>
      </div>
    </div>
  );
}
