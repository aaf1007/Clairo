import { useState, useEffect } from "react";
import "./App.css";
import type { FactCheckResponse } from "../background";
import ClaimCard from "./components/ClaimCard";

export type ResultEntry = {
  status: "loading" | "done" | "error";
  result?: FactCheckResponse;
};

export default function App() {
  const [result, setResult] = useState<ResultEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
    <div className="bg-white w-full">
      <header className="flex px-4 py-3  h-15">
        <img src="/verifai/dark-mode.png" alt="Verifai" className="h-full" />
        <div></div>
      </header>
      <main>
        {result.map((cur) => (
          <ClaimCard claim={cur} key={cur.result?.checked_at} />
        ))}
      </main>
    </div>
  );
}
