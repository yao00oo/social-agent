import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "";
const API_URL = import.meta.env.VITE_API_URL || "";

export interface TimelineEvent {
  id: string;
  taskId: string;
  stepId?: string;
  type:
    | "step_started"
    | "message_sent"
    | "reply_received"
    | "need_decision"
    | "step_completed"
    | "task_completed"
    | "task_error";
  data: any;
  timestamp: Date;
}

export function useSocket() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const eventCounter = useRef(0);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      console.log("[Socket] Connected");
    });

    socket.on("disconnect", () => {
      setConnected(false);
      console.log("[Socket] Disconnected");
    });

    const addEvent = (
      type: TimelineEvent["type"],
      data: any
    ) => {
      eventCounter.current++;
      setEvents((prev) => [
        ...prev,
        {
          id: `evt-${eventCounter.current}`,
          taskId: data.taskId,
          stepId: data.stepId,
          type,
          data,
          timestamp: new Date(),
        },
      ]);
    };

    socket.on("step:started", (data) => addEvent("step_started", data));
    socket.on("step:message_sent", (data) => addEvent("message_sent", data));
    socket.on("step:reply_received", (data) => addEvent("reply_received", data));
    socket.on("step:need_decision", (data) => addEvent("need_decision", data));
    socket.on("step:completed", (data) => addEvent("step_completed", data));
    socket.on("task:completed", (data) => addEvent("task_completed", data));
    socket.on("task:error", (data) => addEvent("task_error", data));

    return () => {
      socket.disconnect();
    };
  }, []);

  const createTask = useCallback(async (instruction: string): Promise<string | null> => {
    try {
      const response = await fetch(`${API_URL}/api/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await response.json();
      return data.taskId || null;
    } catch (error) {
      console.error("[Socket] Create task error:", error);
      return null;
    }
  }, []);

  const sendDecision = useCallback(
    (taskId: string, stepId: string, choice: string) => {
      if (socketRef.current) {
        socketRef.current.emit("user:decision", { taskId, stepId, choice });
      }
    },
    []
  );

  return {
    events,
    connected,
    createTask,
    sendDecision,
  };
}
