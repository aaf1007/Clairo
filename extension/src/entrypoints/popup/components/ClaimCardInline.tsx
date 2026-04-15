import { Spinner } from "@/components/ui/spinner";
import { motion } from "motion/react";
import type { ResultEntry, Surface } from "../App";
import { ClaimCardContent, VerdictBadge } from "./ClaimCard";

type ClaimCardInlineProps = {
  entry: ResultEntry | undefined;
  surface?: Surface;
  onChatAbout?: () => void;
};

/** Inline (non-modal) view of the most recent fact-check result for the Recent tab. */
export function ClaimCardInline({ entry, surface = "popup", onChatAbout }: ClaimCardInlineProps) {
  if (!entry) return <EmptyState />;
  if (entry.status === "loading") return <LoadingState />;
  if (entry.status === "error") return <ErrorState />;

  const result = entry.result!;

  return (
    <motion.div
      key={result.checked_at}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col"
    >
      {/* Header row: verdict + chat button */}
      <div className="flex items-center justify-between">
        <VerdictBadge verdict={result.overall_verdict.replaceAll("_", " ")} />
        <div className="flex items-center gap-3">
          {onChatAbout && (
            <button
              onClick={onChatAbout}
              className="text-[10px] text-gray-400 hover:text-[#7c2353] transition-colors flex items-center gap-1"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Chat about this
            </button>
          )}
          <p className="text-[10px] text-gray-400">
            {result.claims.length} claim{result.claims.length !== 1 ? "s" : ""} checked
          </p>
        </div>
      </div>

      {/* Shared content: summary + accordion claims */}
      <ClaimCardContent result={result} inline surface={surface} />
    </motion.div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
      <Spinner className="size-5" />
      <p className="text-sm">Checking claim…</p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-red-400">
      <WarningIcon />
      <p className="text-sm font-medium">Could not verify this claim</p>
      <p className="text-xs text-gray-400">Something went wrong. Please try again.</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-300">
      <ShieldIcon />
      <p className="text-sm font-medium text-gray-400">No recent checks</p>
      <p className="text-xs text-gray-300 text-center max-w-[180px]">
        Select text on any page and right-click to verify a claim.
      </p>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
