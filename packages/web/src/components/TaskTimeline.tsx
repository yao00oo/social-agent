import { TimelineEvent } from "../hooks/useSocket";
import TimelineNode from "./TimelineNode";
import DecisionCard from "./DecisionCard";
import CompletionCard from "./CompletionCard";

interface TaskTimelineProps {
  events: TimelineEvent[];
  onDecision: (taskId: string, stepId: string, choice: string) => void;
}

export default function TaskTimeline({ events, onDecision }: TaskTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">正在规划任务...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />

      <div className="space-y-0">
        {events.map((event, index) => {
          const isLast = index === events.length - 1;

          if (event.type === "task_completed") {
            return (
              <CompletionCard
                key={event.id}
                summary={event.data.summary}
              />
            );
          }

          if (event.type === "need_decision") {
            return (
              <DecisionCard
                key={event.id}
                taskId={event.taskId}
                stepId={event.stepId || ""}
                question={event.data.question}
                options={event.data.options}
                allowFreeInput={event.data.allowFreeInput}
                onDecision={onDecision}
              />
            );
          }

          return (
            <TimelineNode
              key={event.id}
              event={event}
              isLast={isLast}
            />
          );
        })}
      </div>
    </div>
  );
}
