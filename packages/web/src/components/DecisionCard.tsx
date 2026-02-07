import { useState } from "react";
import { HelpCircle, Send } from "lucide-react";

interface DecisionCardProps {
  taskId: string;
  stepId: string;
  question: string;
  options?: string[];
  allowFreeInput: boolean;
  onDecision: (taskId: string, stepId: string, choice: string) => void;
}

export default function DecisionCard({
  taskId,
  stepId,
  question,
  options,
  allowFreeInput,
  onDecision,
}: DecisionCardProps) {
  const [freeInput, setFreeInput] = useState("");
  const [decided, setDecided] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

  const handleChoice = (choice: string) => {
    if (decided) return;
    setDecided(true);
    setSelectedChoice(choice);
    onDecision(taskId, stepId, choice);
  };

  const handleFreeSubmit = () => {
    const text = freeInput.trim();
    if (!text || decided) return;
    handleChoice(text);
  };

  return (
    <div className="relative pl-10 pb-4 animate-fade-in-up">
      {/* Dot */}
      <div className="absolute left-2.5 top-3 w-3 h-3 rounded-full border-2 border-white bg-yellow-400" />

      {/* Card */}
      <div
        className={`border-l-4 border-l-yellow-400 bg-yellow-50 rounded-r-lg p-4 shadow-sm ${
          !decided ? "pulse-border" : ""
        }`}
      >
        <div className="flex items-start gap-2">
          <HelpCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-800">{question}</p>

            {decided && selectedChoice && (
              <div className="mt-2 px-3 py-1.5 bg-yellow-100 rounded text-sm text-yellow-800">
                已选择: {selectedChoice}
              </div>
            )}

            {!decided && options && options.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {options.map((option) => (
                  <button
                    key={option}
                    onClick={() => handleChoice(option)}
                    className="px-4 py-2 bg-white border border-yellow-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-yellow-100 hover:border-yellow-400 transition-colors"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}

            {!decided && allowFreeInput && (
              <div className="flex items-center gap-2 mt-3">
                <input
                  type="text"
                  value={freeInput}
                  onChange={(e) => setFreeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFreeSubmit();
                  }}
                  placeholder="或者输入你的想法..."
                  className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                />
                <button
                  onClick={handleFreeSubmit}
                  disabled={!freeInput.trim()}
                  className="p-2 bg-yellow-400 text-white rounded-lg hover:bg-yellow-500 disabled:bg-gray-300 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
