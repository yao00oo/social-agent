import { useState, useCallback } from "react";
import Header from "./components/Header";
import InstructionInput from "./components/InstructionInput";
import TaskTimeline from "./components/TaskTimeline";
import HistoryList from "./components/HistoryList";
import { useSocket, TimelineEvent } from "./hooks/useSocket";

type ViewTab = "current" | "history";

// Pre-populated history for demo
const DEMO_HISTORY = [
  {
    id: "history-1",
    instruction: "帮我跟王磊约周末打篮球",
    status: "completed" as const,
    createdAt: "2025-01-15T10:00:00Z",
    summary: {
      person: "王磊",
      activity: "打篮球",
      time: "周六下午 3:00",
      location: "奥体中心篮球馆",
    },
  },
  {
    id: "history-2",
    instruction: "帮我通知项目组明天下午的会议取消",
    status: "completed" as const,
    createdAt: "2025-01-14T14:00:00Z",
    summary: {
      notified: ["张三", "李四", "王五"],
      message: "明天下午的项目会议取消",
      allConfirmed: true,
    },
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>("current");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [inputCollapsed, setInputCollapsed] = useState(false);

  const { events, connected, createTask, sendDecision } = useSocket();

  const handleSubmit = useCallback(
    async (instruction: string) => {
      const taskId = await createTask(instruction);
      if (taskId) {
        setActiveTaskId(taskId);
        setInputCollapsed(true);
        setActiveTab("current");
      }
    },
    [createTask]
  );

  const handleDecision = useCallback(
    (taskId: string, stepId: string, choice: string) => {
      sendDecision(taskId, stepId, choice);
    },
    [sendDecision]
  );

  const handleReset = useCallback(() => {
    setActiveTaskId(null);
    setInputCollapsed(false);
  }, []);

  // Filter events for active task
  const activeEvents = activeTaskId
    ? events.filter((e) => e.taskId === activeTaskId)
    : events;

  return (
    <div className="min-h-screen bg-white">
      <Header connected={connected} />

      <main className="max-w-2xl mx-auto px-4 pb-8">
        {/* Instruction Input */}
        <InstructionInput
          onSubmit={handleSubmit}
          collapsed={inputCollapsed}
          onReset={handleReset}
        />

        {/* Tab switcher */}
        {inputCollapsed && (
          <div className="flex gap-2 mt-4 mb-4">
            <button
              onClick={() => setActiveTab("current")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeTab === "current"
                  ? "bg-primary-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              当前任务
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeTab === "history"
                  ? "bg-primary-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              历史记录
            </button>
          </div>
        )}

        {/* Content */}
        {activeTab === "current" && inputCollapsed && (
          <TaskTimeline
            events={activeEvents}
            onDecision={handleDecision}
          />
        )}

        {activeTab === "history" && (
          <HistoryList tasks={DEMO_HISTORY} />
        )}
      </main>
    </div>
  );
}
