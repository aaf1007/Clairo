import { useState, useEffect } from "react";
import reactLogo from "@/assets/react.svg";
import wxtLogo from "/wxt.svg";
import "./App.css";
import type { FactCheckResponse } from "../background";

type ResultEntry = {
  status: "loading" | "done" | "error";
  result?: FactCheckResponse;
};

function App() {
  const [result, setResult] = useState<ResultEntry[]>([]);

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
      <header className="flex items-center px-4 py-3 border-b border-gray-100">
        <img
          src="/verifai-light.svg"
          alt="Verifai"
          className="h-auto w-[2rem]"
        />
      </header>
      <div>
        <ul>
          {result.map((cur) => (
            <li key={cur.result?.checked_at}>
              {cur.status === "loading" && <div>Checking...</div>}
              {cur.status === "error" && <div>Error checking claim.</div>}
              {cur.status === "done" && cur.result && (
                <div>
                  <div>
                    <strong>Verdict:</strong> {cur.result.overall_verdict}
                  </div>
                  <div>
                    <strong>Summary:</strong> {cur.result.summary}
                  </div>
                  {cur.result.source_url && (
                    <div>
                      <strong>Source:</strong> {cur.result.source_url}
                    </div>
                  )}
                  <ul>
                    {cur.result.claims.map((claim, i) => (
                      <li key={i}>
                        <div>
                          <strong>{claim.statement}</strong>
                        </div>
                        <div>
                          Verdict: {claim.verdict} (
                          {Math.round(claim.confidence * 100)}% confidence)
                        </div>
                        <div>{claim.explanation}</div>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <em>
                      Checked at:{" "}
                      {new Date(cur.result.checked_at).toLocaleString()}
                    </em>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
