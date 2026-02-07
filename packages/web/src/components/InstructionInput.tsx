import { useState } from "react";
import { Send, RotateCcw } from "lucide-react";

interface InstructionInputProps {
  onSubmit: (instruction: string) => void;
  collapsed: boolean;
  onReset: () => void;
}

const QUICK_INSTRUCTIONS = [
  "帮我跟张三约晚餐",
  "帮我约李磊周末打球",
  "帮我通知小组会议改期",
];

export default function InstructionInput({
  onSubmit,
  collapsed,
  onReset,
}: InstructionInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;
    onSubmit(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (collapsed) {
    return (
      <div className="mt-6 flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
        <span className="text-sm text-gray-500">任务执行中...</span>
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-sm text-primary-500 hover:text-primary-600 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          新任务
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="告诉助理你要做什么..."
          className="w-full px-4 py-3.5 pr-12 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Quick instructions */}
      <div className="flex flex-wrap gap-2 mt-3">
        {QUICK_INSTRUCTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onSubmit(text)}
            className="px-3 py-1.5 bg-primary-50 text-primary-700 rounded-full text-sm hover:bg-primary-100 transition-colors"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
