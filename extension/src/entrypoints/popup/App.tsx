import { Tabs } from "@heroui/react";
import { useEffect, useState } from "react";
import type { FactCheckResponse } from "../background";
import "./App.css";
import ClaimCard from "./components/ClaimCard";
import { ClaimCardInline } from "./components/ClaimCardInline";
import ChatView from "./components/ChatView";

export type Surface = "popup" | "sidepanel";

export type ResultEntry = {
  status: "loading" | "done" | "error";
  result?: FactCheckResponse;
};

type AppProps = {
  surface?: Surface;
};

export default function App({ surface = "popup" }: AppProps) {
  const [result, setResult] = useState<ResultEntry[]>([]);
  const [view, setView] = useState<string>("recent");
  const [recent, setRecent] = useState<ResultEntry | undefined>();
  const [chatContextIndex, setChatContextIndex] = useState<number | null>(null);
  const isSidepanel = surface === "sidepanel";

  const handleChatAbout = (index: number) => {
    setChatContextIndex(index);
    setView("Chat");
  };

  // Read existing results
  useEffect(() => {
    browser.storage.local.get("verifaiResults").then((data) => {
      if (data.verifaiResults) {
        const results = data.verifaiResults as ResultEntry[];
        setResult(results);
        setRecent(results.at(-1));
      }
    });
  }, []);

  // Listen for new results from background
  useEffect(() => {
    const listener = (changes: any, areaName: string) => {
      if (areaName !== "local") return;

      if (changes.verifaiResults) {
        const newValue = changes.verifaiResults.newValue as ResultEntry[];
        setResult(newValue);
        setRecent(newValue.at(-1));
      }
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);


  return (
    <div
      data-surface={surface}
      className="verifai-shell flex h-full min-h-0 w-full flex-col"
    >
      <div className={`flex h-full min-h-0 w-full flex-col ${isSidepanel ? "mx-auto max-w-[820px]" : ""}`}>
        <header
          className={`shrink-0 border-b border-black/5 bg-white/80 backdrop-blur-sm ${
            isSidepanel
              ? "px-6 pb-4 pt-6 shadow-[0_10px_40px_rgba(48,16,30,0.06)]"
              : "flex h-16 justify-center shadow-gray-200"
          }`}
        >
          <div className={isSidepanel ? "flex flex-col gap-3" : "py-3"}>
            <img
              src="/verifai/light-mode.png"
              alt="Verifai"
              className={isSidepanel ? "h-9 w-fit" : "h-full"}
            />
            {isSidepanel && (
              <p className="max-w-[520px] text-sm leading-relaxed text-[#6f6170]">
                Review recent checks, browse your history, and keep the chat open while you stay on the page.
              </p>
            )}
          </div>
        </header>

        <Tabs
          selectedKey={view}
          onSelectionChange={(key) => setView(String(key))}
          className={`${isSidepanel ? "px-6 pb-4 pt-5" : "px-8 mb-5"} shrink-0`}
          variant="secondary"
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="View">
              <Tabs.Tab id="recent">
                Recent
                <Tabs.Indicator className="bg-[linear-gradient(90deg,rgba(28,4,17,1)_29%,rgba(124,35,83,1)_56%,rgba(197,95,89,1)_81%,rgba(210,105,116,1)_100%)]" />
              </Tabs.Tab>
              <Tabs.Tab id="history">
                History
                <Tabs.Indicator className="bg-[linear-gradient(90deg,rgba(28,4,17,1)_29%,rgba(124,35,83,1)_56%,rgba(197,95,89,1)_81%,rgba(210,105,116,1)_100%)]" />
              </Tabs.Tab>
              <Tabs.Tab id="Chat">
                Chat
                <Tabs.Indicator className="bg-[linear-gradient(90deg,rgba(28,4,17,1)_29%,rgba(124,35,83,1)_56%,rgba(197,95,89,1)_81%,rgba(210,105,116,1)_100%)]" />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        <main
          className={`${isSidepanel ? "px-6" : "px-8"} flex-1 min-h-0 ${
            view === "Chat" ? "flex flex-col pb-6" : "overflow-y-auto pb-6"
          }`}
        >
          {view === "recent" && (
            <ClaimCardInline
              entry={recent}
              surface={surface}
              onChatAbout={() => handleChatAbout(result.length - 1)}
            />
          )}
          {view === "history" &&
            result.toReversed().map((cur, displayIndex) => (
              <ClaimCard
                claim={cur}
                key={cur.result?.checked_at ?? `history-${displayIndex}`}
                surface={surface}
                onChatAbout={() => handleChatAbout(result.length - 1 - displayIndex)}
              />
            ))}
          {view === "Chat" && (
            <ChatView
              results={result}
              initialContextIndex={chatContextIndex}
              onContextIndexChange={setChatContextIndex}
            />
          )}
        </main>
      </div>
    </div>
  );
}
