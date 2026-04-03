type FactCheckRequest = {
  text: string;
  url?: string;
  context?: string;
  model?: string;
};

export type FactCheckResponse = {
  overall_verdict: string;
  summary: string;
  claims: ClaimAnalysis[];
  checked_at: string;
  source_url: string | null;
};

type ClaimAnalysis = {
  statement: string;
  verdict: string;
  confidence: number;
  explanation: string;
  sources: string[];
  domain?: string;
  checkability: string;
};

export default defineBackground(() => {
  console.log("Hello background!", { id: browser.runtime.id });

  // Remove all existing menus then recreate. This handles both:
  // - Production: avoids duplicate-id errors when the service worker restarts
  // - Development: onInstalled doesn't fire on WXT HMR reloads, so we can't
  //   rely on it; removeAll+create runs on every service worker startup instead.
  browser.contextMenus.removeAll(() => {
    browser.contextMenus.create({
      id: "verifai-check",
      title: "VerifAI: Verify Text",
      contexts: ["selection"],
    } as Parameters<typeof browser.contextMenus.create>[0]);
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== "install") return;

    browser.tabs.create({
      url: browser.runtime.getURL("/welcome.html"),
    });
  });

  // Main User Input Event
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "verifai-check") return;

    // Selected text
    const selectedText = info.selectionText;
    if (!selectedText) return;

    // Build Request Object
    const factCheckRequest: FactCheckRequest = {
      text: selectedText,
      url: tab?.url,
    };

    const stored = await browser.storage.local.get("verifaiResults");
    const existing: any[] = (stored.verifaiResults as any[]) ?? [];

    // Store loading state immediately, then open the popup.
    // Order matters: write storage first so the popup already sees "loading"
    // when it mounts, rather than flashing an empty state.
    await browser.storage.local.set({
      verifaiResults: [...existing, { status: "loading", result: null }],
    });

    // openPopup() must be called in the same event tick as the user gesture
    // (the context menu click). Awaiting storage.set above is fast (local I/O)
    // so Chrome still considers this the same gesture context.
    await browser.action.openPopup();

    try {
      // API Call
      const response = await fetch("http://localhost:8000/api/fact-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(factCheckRequest),
      });

      if (!response.ok) {
        const err = await response.json();
        await browser.storage.local.set({
          verifaiResults: [
            ...existing,
            { status: "error", message: err.detail },
          ],
        });
        return;
      }

      // Response Object
      const factCheckResponse: FactCheckResponse = await response.json();

      // Store results after response from backend
      await browser.storage.local.set({
        verifaiResults: [
          ...existing,
          { status: "done", result: factCheckResponse },
        ],
      });
    } catch (err) {
      await browser.storage.local.set({
        verifaiResults: [
          ...existing,
          { status: "error", message: "Could not reach server" },
        ],
      });
    }
  });

  // TODO do this when integrating automatic sidebar panel open on user verify event
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === "openSideBar") {
      // Guard for tab being undefined
      if (!sender.tab?.windowId) return;

      browser.sidePanel.open({
        tabId: sender.tab?.id,
        windowId: sender.tab?.windowId,
      });
    }
  });
});
