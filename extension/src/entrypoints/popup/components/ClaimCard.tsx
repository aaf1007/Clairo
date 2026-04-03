import { ResultEntry } from "../App";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useOutsideClick } from "@/hooks/use-outside-click";

export default function ClaimCard({ claim }: { claim: ResultEntry }) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useOutsideClick(ref, () => setActive(false));

  if (claim.status === "loading") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin shrink-0" />
        <span className="text-sm text-gray-500">Checking claim...</span>
      </div>
    );
  }

  if (claim.status === "error") {
    return (
      <div className="px-4 py-3 border-b border-gray-100 text-sm text-red-500">
        Could not verify this claim.
      </div>
    );
  }

  const result = claim.result!;

  {
    /* When claim is complete */
  }
  return (
    <>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 z-10"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {active && (
          <div className="fixed inset-0 grid place-items-center z-[100] px-4">
            <motion.div
              layoutId={`card-${id}`}
              ref={ref}
              className="w-full max-w-[400px] max-h-[80vh] flex flex-col bg-white rounded-2xl overflow-hidden shadow-xl"
            >
              {/* Header */}
              <div className="flex justify-between items-start p-4 border-b border-gray-100">
                <div>
                  <VerdictBadge verdict={result.overall_verdict} />
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(result.checked_at).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={() => setActive(false)}
                  className="text-gray-400 hover:text-black transition-colors"
                >
                  <CloseIcon />
                </button>
              </div>

              {/* Summary */}
              <div className="px-4 pt-3 pb-1">
                <p className="text-sm text-gray-700">{result.summary}</p>
              </div>

              {/* Claims list */}
              <div className="overflow-y-auto px-4 pb-4 flex flex-col gap-3 mt-3">
                {result.claims.map((claim, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-gray-100 p-3"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs font-medium text-gray-800 leading-snug">
                        {claim.statement}
                      </p>
                      <VerdictBadge verdict={claim.verdict} small />
                    </div>
                    <p className="text-xs text-gray-500">{claim.explanation}</p>
                    {claim.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {claim.sources.map((src, j) => (
                          <a
                            key={j}
                            href={src}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-blue-500 underline truncate max-w-[180px]"
                          >
                            {src}
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-gray-400">
                      Confidence: {Math.round(claim.confidence * 100)}%
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Collapsed card */}
      <motion.div
        layoutId={`card-${id}`}
        onClick={() => setActive(true)}
        className="flex items-center justify-between px-4 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <VerdictBadge verdict={result.overall_verdict} />
          <p className="text-xs text-gray-500 truncate">{result.summary}</p>
        </div>
        <span className="text-xs text-gray-400 ml-3 shrink-0">
          {result.claims.length} claim{result.claims.length !== 1 ? "s" : ""}
        </span>
      </motion.div>
    </>
  );
}

function VerdictBadge({
  verdict,
  small,
}: {
  verdict: string;
  small?: boolean;
}) {
  const lower = verdict.toLowerCase();
  const color =
    lower.includes("true") || lower.includes("accurate")
      ? "bg-green-100 text-green-700"
      : lower.includes("false") || lower.includes("mislead")
        ? "bg-red-100 text-red-700"
        : "bg-yellow-100 text-yellow-700";

  return (
    <span
      className={`inline-block rounded-full font-semibold ${color} ${
        small ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-0.5"
      }`}
    >
      {verdict}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </svg>
  );
}
