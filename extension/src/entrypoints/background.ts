type FactCheckRequest = {
  text: string;
  url?: string;
  context?: string;
  model?: string;
};

type FactCheckResponse = {
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

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== "install") return;

    browser.tabs.create({
      url: browser.runtime.getURL("/welcome.html"),
    });
  });

  // Creates context menu when user right-clicks
  browser.contextMenus.create({
    id: "clairo-check",
    title: "Clairo: Verify Text",
    contexts: ["selection"], // Only appears when user has text highlighted
  });

  // Main User Input Event
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "clairo-check") return;

    // Selected text
    const selectedText = info.selectionText;
    if (!selectedText) return;

    // Build Request Object
    const factCheckRequest: FactCheckRequest = {
      text: selectedText,
      url: tab?.url,
    };

    // Store loading state immediately
    await browser.storage.local.set({
      clairoResult: { status: "loading", result: null },
    });

    // API Call
    const response = await fetch("http://localhost:8000/api/fact-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(factCheckRequest),
    });

    // Response Object
    const factCheckResponse: FactCheckResponse = await response.json();

    // Store results after response from backend
    await browser.storage.local.set({
      clairoResult: { status: "done", result: factCheckResponse },
    });
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
