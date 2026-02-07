import { CheckCircle, User, Calendar, MapPin, Utensils, Phone } from "lucide-react";

interface CompletionCardProps {
  summary: Record<string, any>;
}

export default function CompletionCard({ summary }: CompletionCardProps) {
  // Try to extract common fields
  const instruction = summary?.instruction || "";
  const results = summary?.results || [];
  const context = summary?.context || {};

  return (
    <div className="relative pl-10 pb-4 animate-fade-in-up">
      {/* Dot */}
      <div className="absolute left-2.5 top-3 w-3 h-3 rounded-full border-2 border-white bg-green-500" />

      {/* Card */}
      <div className="border-l-4 border-l-green-500 bg-green-50 rounded-r-lg p-4 shadow-sm">
        <div className="flex items-start gap-2">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-green-800">任务完成</p>

            <div className="mt-3 space-y-2">
              {context.contacts?.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <User className="w-4 h-4 text-gray-400" />
                  <span>{context.contacts.map((c: any) => c.name).join(", ")}</span>
                </div>
              )}

              {results.map((r: any, i: number) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-gray-700"
                >
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  <span>{r.description}</span>
                </div>
              ))}

              {Object.entries(context)
                .filter(([key]) => key.endsWith("_choice"))
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center gap-2 text-sm text-gray-700"
                  >
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span>{String(value)}</span>
                  </div>
                ))}
            </div>

            {instruction && (
              <p className="mt-3 text-xs text-gray-500">
                原始指令: {instruction}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
