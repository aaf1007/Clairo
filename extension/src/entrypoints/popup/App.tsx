import { Tabs } from '@heroui/react';
import { useEffect, useState } from "react";
import type { FactCheckResponse } from "../background";
import "./App.css";
import ClaimCard from "./components/ClaimCard";

export type ResultEntry = {
  status: "loading" | "done" | "error";
  result?: FactCheckResponse;
};

export default function App() {
  const [result, setResult] = useState<ResultEntry[]>([]);
  const [view, setView] = useState<string>("list");

  // Read existing results
  useEffect(() => {
    browser.storage.local.get("verifaiResults").then((data) => {
      if (data.verifaiResults) {
        setResult(data.verifaiResults as ResultEntry[]);
      }
    });
  }, []);

  // Listen for new results from background
  useEffect(() => {
    const listener = (changes: any) => {
      if (changes.verifaiResults) {
        setResult(changes.verifaiResults.newValue as ResultEntry[]);
      }
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  return (
    <div className="w-full flex flex-col gap-4">
      <header className="bg-white flex px-6 justify-between w-full h-14 shadow-gray-200">
        <div className="py-3">
          <img src="/verifai/light-mode.png" alt="Verifai" className="h-full" />
        </div>
        <div>
        </div>
      </header>
      <Tabs
        selectedKey={view}
        onSelectionChange={(key) => setView(String(key))}
        className="px-8"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="View">
            <Tabs.Tab id="list">
              List View
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="node">
              Node View
              <Tabs.Indicator />
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
      <main className="px-8">
        { view === "list" && result.map((cur) => (
          <ClaimCard claim={cur} key={cur.result?.checked_at} />
        ))}

        { view === "node" && 
          <div>NODE VIEW</div>
        }
      </main>
    </div>
  );
}
