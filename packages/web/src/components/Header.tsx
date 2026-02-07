import { Wifi, WifiOff } from "lucide-react";

interface HeaderProps {
  connected: boolean;
}

export default function Header({ connected }: HeaderProps) {
  return (
    <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
      <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          <h1 className="text-xl font-bold text-gray-900">Social Agent</h1>
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          {connected ? (
            <>
              <Wifi className="w-4 h-4 text-green-500" />
              <span className="text-green-600">已连接</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-red-400" />
              <span className="text-red-500">未连接</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
