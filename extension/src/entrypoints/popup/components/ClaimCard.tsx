import { Spinner } from "@/components/ui/spinner";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { Label, ProgressBar } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { RefObject, useEffect, useId, useRef, useState } from "react";
import { FaSquareCheck } from "react-icons/fa6";
import type { FactCheckResponse } from "../../background";
import type { ResultEntry, Surface } from "../App";

export default function ClaimCard({
  claim,
  surface = "popup",
  onChatAbout,
}: {
  claim: ResultEntry;
  surface?: Surface;
  onChatAbout?: () => void;
}) {
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
      <motion.div
        layoutId={`card-${id}`}
        onClick={() => setActive(true)}
        className="flex text-sm text-gray-500 items-center border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors shadow-xl px-8 py-6 rounded-xl"
      >
        {/* <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin shrink-0" /> */}
        <span className="">Checking claim</span>
        <Spinner className="size-3"/>
      </motion.div>
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
          <ClaimCardModal
            result={result}
            id={id}
            surface={surface}
            refProp={ref}
            onClose={() => setActive(false)}
            onChatAbout={onChatAbout ? () => { setActive(false); onChatAbout(); } : undefined}
          />
        )}
      </AnimatePresence>

      {/* Collapsed card */}
      <motion.div
        layoutId={`card-${id}`}
        onClick={() => setActive(true)}
        className="flex px-4 py-2 items-center gap-6 mb-4 border border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors shadow-lg rounded-xl"
      >
        <FaSquareCheck className={`text-3xl opacity-40 ${getVerdictColor(result.overall_verdict)}`} />
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className="font-semibold text-[0.9rem]">{result.title}</p>
          <div className="flex items-end">
            <VerdictBadge verdict={result.overall_verdict.replaceAll("_"," ")} />
            <span className="text-gray-400 ml-3 text-[10px] py-0.5">
              {result.claims.length} claim{result.claims.length !== 1 ? "s" : ""}
            </span>
            {/* <p className="text-xs text-gray-500 truncate">{result.summary}</p> */}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

type ClaimCardModalProps = {
  result: NonNullable<ResultEntry["result"]>;
  id: string;
  surface: Surface;
  refProp: RefObject<HTMLDivElement | null>;
  onClose?: () => void;
  onChatAbout?: () => void;
};

/** Expanded modal view for a single fact-check result. */
export function ClaimCardModal({ result, id, surface, refProp, onClose, onChatAbout }: ClaimCardModalProps) {
  return (
    <div className="fixed inset-0 grid place-items-center z-[100] px-4">
      <motion.div
        layoutId={`card-${id}`}
        ref={refProp}
        className={`w-full max-h-[80vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${
          surface === "sidepanel" ? "max-w-[720px]" : "max-w-[400px]"
        }`}
      >
        {/* Header */}
        <div className="flex justify-between items-start p-4 border-b border-gray-100">
          <div>
            <VerdictBadge verdict={result.overall_verdict.replaceAll("_", " ")} />
          </div>
          <div className="flex items-center gap-3">
            {onChatAbout && (
              <button
                onClick={onChatAbout}
                className="text-xs text-gray-400 hover:text-[#7c2353] transition-colors flex items-center gap-1"
              >
                <ChatIcon />
                Chat about this
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-black transition-colors"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </div>
        <ClaimCardContent result={result} surface={surface} />
      </motion.div>
    </div>
  );
}

type ClaimCardContentProps = {
  result: FactCheckResponse;
  /** Index of the initially expanded claim. Defaults to 0. */
  defaultExpanded?: number;
  /** When true, disables the inner scroll so a parent container can handle scrolling. */
  inline?: boolean;
  surface?: Surface;
};

/** Shared inner body: summary + accordion claims list. */
export function ClaimCardContent({
  result,
  defaultExpanded = 0,
  inline = false,
  surface = "popup",
}: ClaimCardContentProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(defaultExpanded);

  /** Toggles accordion: collapses if already open, expands otherwise. */
  const handleToggleClaim = (i: number) =>
    setExpandedIndex((prev) => (prev === i ? null : i));

  return (
    <>
      {/* Summary */}
      <div className="px-4 pt-3 pb-2">
        <p className="text-sm text-gray-700">{result.summary}</p>
      </div>

      {/* Claims accordion */}
      <div className={`px-4 pb-4 flex flex-col gap-3 mt-2 ${inline ? "" : " modal-claims-scroll overflow-y-auto"}`}>
        {result.claims.map((claim, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-200 bg-white shadow-sm p-3 cursor-pointer"
            onClick={() => handleToggleClaim(i)}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className={`font-medium text-gray-800 leading-snug ${surface === "sidepanel" ? "text-sm" : "text-xs"}`}>
                {claim.statement}
              </p>
              <VerdictBadge verdict={claim.verdict.replaceAll("_", " ")} small />
            </div>
            <AnimatePresence initial={false}>
              {expandedIndex === i && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <p className={`mt-1 text-gray-500 ${surface === "sidepanel" ? "text-sm" : "text-xs"}`}>
                    {claim.explanation}
                  </p>
                  {claim.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {claim.sources.map((src, j) => (
                        <a
                          key={j}
                          href={src}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className={`truncate text-blue-500 underline ${surface === "sidepanel" ? "max-w-[280px] text-xs" : "max-w-[180px] text-[10px]"}`}
                        >
                          {src}
                        </a>
                      ))}
                    </div>
                  )}
                  <ProgressBar className="mt-2 progress-bar--sm" aria-label="Confidence" value={Math.round(claim.confidence * 100)}>
                    <Label className="text-[0.7rem] text-gray-400">Confidence Level</Label>
                    <ProgressBar.Output className="text-[0.7rem] text-gray-400" />
                    <ProgressBar.Track>
                      <ProgressBar.Fill />
                    </ProgressBar.Track>
                  </ProgressBar>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </>
  );
}

export const getVerdictColor = (verdict: string) => {
  const lower = verdict.toLowerCase();
  return lower.includes("true") || lower.includes("accurate")
    ? "text-green-700"
    : lower.includes("false") || lower.includes("mislead")
      ? "text-red-700"
      : "text-yellow-700";
};

export function VerdictBadge({
  verdict,
  small,
}: {
  verdict: string;
  small?: boolean;
}) {
  const lower = verdict.toLowerCase();
  const color =
    lower.includes("true") || lower.includes("accurate")
      ? "text-green-700"
      : lower.includes("false") || lower.includes("mislead")
        ? "text-red-700"
        : "text-yellow-700";

  return (
    <span
      className={`inline-block rounded-full font-extrabold ${color} ${
        small ? "text-[0.7rem] py-0.5" : "text-xs py-0.5"
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
