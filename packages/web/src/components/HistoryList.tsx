import { CheckCircle, Clock, ChevronRight } from "lucide-react";

interface HistoryTask {
  id: string;
  instruction: string;
  status: "completed" | "failed";
  createdAt: string;
  summary: Record<string, any>;
}

interface HistoryListProps {
  tasks: HistoryTask[];
}

export default function HistoryList({ tasks }: HistoryListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        暂无历史记录
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-4">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-shadow"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {task.instruction}
                </p>
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  <span>
                    {new Date(task.createdAt).toLocaleDateString("zh-CN", {
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {/* Summary items */}
                <div className="mt-2 space-y-1">
                  {Object.entries(task.summary).map(([key, value]) => {
                    if (Array.isArray(value)) {
                      return (
                        <p key={key} className="text-xs text-gray-500">
                          {key}: {value.join(", ")}
                        </p>
                      );
                    }
                    if (typeof value === "boolean") {
                      return (
                        <p key={key} className="text-xs text-gray-500">
                          {key}: {value ? "是" : "否"}
                        </p>
                      );
                    }
                    return (
                      <p key={key} className="text-xs text-gray-500">
                        {key}: {String(value)}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </div>
        </div>
      ))}
    </div>
  );
}
