import { Tabs } from '@heroui/react';
import { useEffect, useState } from "react";
import type { FactCheckResponse } from "../background";
import "./App.css";
import ClaimCard from "./components/ClaimCard";
import { ClaimCardInline } from "./components/ClaimCardInline";

export type ResultEntry = {
  status: "loading" | "done" | "error";
  result?: FactCheckResponse;
};

export default function App() {
  const [result, setResult] = useState<ResultEntry[]>([]);
  const [view, setView] = useState<string>("recent");
  const [recent, setRecent] = useState<ResultEntry | undefined>();

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
    const listener = (changes: any) => {
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
    <div className="w-full h-full flex flex-col">
      <header className="flex px-6 justify-between w-full h-18 shadow-gray-200 bg-white shrink-0">
        <div className="py-3">
          <img src="/verifai/light-mode.png" alt="Verifai" className="h-full" />
        </div>
        <div>
        </div>
      </header>
      <Tabs
        selectedKey={view}
        onSelectionChange={(key) => setView(String(key))}
        className="px-8 mb-5 shrink-0"
        variant='secondary'
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
        {/* <Tabs.Panel className="pt-4" id="list">
          <p>View your project overview and recent activity.</p>
        </Tabs.Panel>
        <Tabs.Panel className="pt-4" id="node">
          <p>Track your metrics and analyze performance data.</p>
        </Tabs.Panel> */}
      </Tabs>
      <main className="pb-4 px-8 flex-1 overflow-y-auto min-h-0">
        { view === "recent" && (
          <ClaimCardInline entry={recent} />
        )}
        { view === "history" && (
          result.toReversed().map((cur) => (
          <ClaimCard claim={cur} key={cur.result?.checked_at} />
        )))}
        { view === "Chat" && 
          <div>{view} VIEW</div>
        }
      </main>
    </div>
  );
}
