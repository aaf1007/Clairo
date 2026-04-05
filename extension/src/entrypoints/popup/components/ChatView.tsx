import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ResultEntry } from "../App";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  isStreaming?: boolean;
};

type ChatViewProps = {
  results: ResultEntry[];
  initialContextIndex: number | null;
  onContextIndexChange: (index: number | null) => void;
};

const CONTEXT_SUGGESTIONS = [
  "Summarize the findings",
  "Which sources are most reliable?",
  "Explain the overall verdict",
];

const FREE_SUGGESTIONS = [
  "How does fact-checking work?",
  "What makes a source reliable?",
  "What is misinformation?",
];

export default function ChatView({ results, initialContextIndex, onContextIndexChange }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [contextIndex, setContextIndex] = useState<number | null>(initialContextIndex);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync context from parent (when "Chat about this" sets it externally)
  useEffect(() => {
    if (initialContextIndex !== contextIndex) {
      setContextIndex(initialContextIndex);
      setMessages([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContextIndex]);

  // Auto-scroll to bottom when messages update
  // useEffect(() => {
  //   bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [messages]);

  // Abort stream on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const doneResults = results
    .map((r, i) => ({ entry: r, originalIndex: i }))
    .filter(({ entry }) => entry.status === "done");

  const getContextLabel = (entry: ResultEntry) =>
    entry.result?.title ?? entry.result?.claims[0]?.statement ?? "Untitled";

  const handleContextChange = (value: string) => {
    const newIndex = value === "" ? null : Number(value);
    setContextIndex(newIndex);
    onContextIndexChange(newIndex);
    setMessages([]);
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleNewChat = () => {
    setMessages([]);
    abortRef.current?.abort();
    setIsStreaming(false);
    setInput("");
  };

  const handleSend = async (text?: string) => {
    const messageText = (text ?? input).trim();
    if (!messageText || isStreaming) return;

    setInput("");

    let currentMessages = messages;

    // Hard limit: reset at 20 messages
    if (currentMessages.length >= 20) {
      currentMessages = [{
        role: "assistant",
        content: "_Conversation limit reached. Starting a new conversation._",
      }];
      setMessages(currentMessages);
    }

    const userMessage: ChatMessage = { role: "user", content: messageText };
    const placeholderAssistant: ChatMessage = { role: "assistant", content: "", isStreaming: true };

    const newMessages = [...currentMessages, userMessage, placeholderAssistant];
    setMessages(newMessages);
    setIsStreaming(true);

    const context =
      contextIndex !== null && results[contextIndex]?.result
        ? JSON.stringify(results[contextIndex].result)
        : null;

    // Build API messages (exclude the placeholder assistant)
    const apiMessages = newMessages
      .slice(0, -1)
      .map(({ role, content }) => ({ role, content }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("http://localhost:8000/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, context }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));

            if (payload.token) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, content: last.content + payload.token };
                return updated;
              });
            } else if (payload.done) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], isStreaming: false };
                return updated;
              });
              setIsStreaming(false);
            } else if (payload.error) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: payload.error,
                  isError: true,
                  isStreaming: false,
                };
                return updated;
              });
              setIsStreaming(false);
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Connection failed";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: msg,
          isError: true,
          isStreaming: false,
        };
        return updated;
      });
      setIsStreaming(false);
    }
  };

  const handleRetry = () => {
    // Find the last user message and resend it
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    // Remove the failed assistant message
    setMessages((prev) => prev.slice(0, -1));
    setIsStreaming(false);
    handleSend(lastUserMsg.content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestions = contextIndex !== null ? CONTEXT_SUGGESTIONS : FREE_SUGGESTIONS;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* Context selector bar */}
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={contextIndex ?? ""}
          onChange={(e) => handleContextChange(e.target.value)}
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#7c2353] truncate"
        >
          <option value="">No context (free chat)</option>
          {doneResults.map(({ entry, originalIndex }) => (
            <option key={originalIndex} value={originalIndex}>
              {getContextLabel(entry)}
            </option>
          ))}
        </select>
        <button
          onClick={handleNewChat}
          title="New chat"
          className="shrink-0 text-gray-400 hover:text-[#7c2353] transition-colors p-1"
        >
          <NewChatIcon />
        </button>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto chat-scroll min-h-0 flex flex-col gap-3 pr-1">
        {messages.length === 0 ? (
          <WelcomeState
            hasContext={contextIndex !== null}
            suggestions={suggestions}
            onSuggestion={(s) => handleSend(s)}
          />
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              onRetry={msg.isError ? handleRetry : undefined}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border border-gray-200 rounded-xl overflow-hidden focus-within:border-[#7c2353] transition-colors">
        <textarea
          ref={textareaRef}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={2000}
          placeholder={contextIndex !== null ? "Ask about this fact-check…" : "Ask me anything…"}
          disabled={isStreaming}
          className="w-full px-3 pt-2.5 pb-1 text-sm resize-none focus:outline-none bg-white text-gray-800 placeholder-gray-400 disabled:opacity-50"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className={`text-[10px] ${input.length > 1900 ? "text-red-400" : "text-gray-300"}`}>
            {input.length}/2000
          </span>
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isStreaming}
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-[linear-gradient(90deg,rgba(28,4,17,1)_29%,rgba(124,35,83,1)_56%,rgba(197,95,89,1)_81%,rgba(210,105,116,1)_100%)] text-white disabled:opacity-30 transition-opacity"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function WelcomeState({
  hasContext,
  suggestions,
  onSuggestion,
}: {
  hasContext: boolean;
  suggestions: string[];
  onSuggestion: (s: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 py-8 text-center">
      <div className="text-2xl">💬</div>
      <div>
        <p className="text-sm font-medium text-gray-700">
          {hasContext ? "Ask about this fact-check" : "Ask me anything"}
        </p>
        <p className="text-xs text-gray-400 mt-1 max-w-[200px]">
          {hasContext
            ? "I'll use the selected result as context for my answers."
            : "Select a fact-check from the dropdown, or just start chatting."}
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 hover:border-[#7c2353] hover:text-[#7c2353] transition-colors text-left"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry?: () => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-[#3d1229] text-white text-sm px-3 py-2 rounded-2xl rounded-tr-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-2xl rounded-tl-sm">
          <p className="text-xs font-medium mb-1">Error</p>
          <p className="text-xs">{message.content}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 text-xs text-red-600 underline hover:text-red-800"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-gray-100 text-gray-800 text-sm px-3 py-2 rounded-2xl rounded-tl-sm leading-relaxed">
        {message.content === "" && message.isStreaming ? (
          <span className="streaming-cursor" />
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
            {message.isStreaming && <span className="streaming-cursor" />}
          </div>
        )}
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
