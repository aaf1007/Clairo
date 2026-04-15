type FactCheckRequest = {
  text: string;
  url?: string;
  context?: string;
  model?: string;
};

export type FactCheckResponse = {
  overall_verdict: string;
  title: string;
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

type PanelTarget = {
  tabId?: number;
  windowId?: number;
};

async function resolvePanelTarget(target: PanelTarget = {}): Promise<{ windowId: number } | null> {
  if (typeof target.windowId === "number") {
    return { windowId: target.windowId };
  }

  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (typeof activeTab?.windowId !== "number") {
    return null;
  }

  return {
    windowId: activeTab.windowId,
  };
}

async function openVerifAISidePanel(target: PanelTarget = {}) {
  try {
    const resolvedTarget = await resolvePanelTarget(target);
    if (!resolvedTarget) {
      return;
    }

    await browser.sidePanel.open({
      windowId: resolvedTarget.windowId,
    });
  } catch (error) {
    console.error("[VerifAI] Failed to open sidepanel:", error);
  }
}

// Handles Fact Checking requests to the backend
async function runFactCheck(text: string, url?: string) {
  const factCheckRequest: FactCheckRequest = { text, url };

  const stored = await browser.storage.local.get("verifaiResults");
  const existing: any[] = (stored.verifaiResults as any[]) ?? [];

  await browser.storage.local.set({
    verifaiResults: [...existing, { status: "loading", result: null }],
  });

  try {
    const response = await fetch("http://localhost:8000/api/fact-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(factCheckRequest),
    });

    if (!response.ok) {
      const err = await response.json();
      await browser.storage.local.set({
        verifaiResults: [...existing, { status: "error", message: err.detail }],
      });
      return;
    }

    const factCheckResponse: FactCheckResponse = await response.json();

    await browser.storage.local.set({
      verifaiResults: [...existing, { status: "done", result: factCheckResponse }],
    });
  } catch (err) {
    await browser.storage.local.set({
      verifaiResults: [...existing, { status: "error", message: "Could not reach server" }],
    });
  }
}

async function handleVideoVerify(videoBase64: string, url: string, contentType: string) {
  const stored = await browser.storage.local.get("verifaiResults");
  const existing: any[] = (stored.verifaiResults as any[]) ?? [];

  await browser.storage.local.set({
    verifaiResults: [...existing, { status: "loading", result: null }],
  });

  try {
    const binary = atob(videoBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: contentType });
    const formData = new FormData();
    formData.append("file", blob, "tiktok-video.mp4");

    const response = await fetch(`http://localhost:8000/api/transcribe-and-check?url=${encodeURIComponent(url)}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      await browser.storage.local.set({
        verifaiResults: [...existing, { status: "error", message: err.detail ?? "Transcription failed" }],
      });
      return;
    }

    const factCheckResponse: FactCheckResponse = await response.json();
    await browser.storage.local.set({
      verifaiResults: [...existing, { status: "done", result: factCheckResponse }],
    });
  } catch (err) {
    await browser.storage.local.set({
      verifaiResults: [...existing, { status: "error", message: "Could not reach server" }],
    });
  }
}


export default defineBackground(() => {
  console.log("Hello background!", { id: browser.runtime.id });

  void browser.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("[VerifAI] Failed to enable action click sidepanel behavior:", error));

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

    const selectedText = info.selectionText;
    if (!selectedText) return;

    await openVerifAISidePanel({
      tabId: tab?.id,
      windowId: tab?.windowId,
    });
    await runFactCheck(selectedText, tab?.url);
  });

  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === "TIKTOK_VERIFY") {
      void openVerifAISidePanel({
        tabId: sender.tab?.id,
        windowId: sender.tab?.windowId,
      });
      void runFactCheck(msg.text, msg.url);
    }
  });

  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === "TIKTOK_VIDEO_VERIFY") {
      void openVerifAISidePanel({
        tabId: sender.tab?.id,
        windowId: sender.tab?.windowId,
      });
      void handleVideoVerify(msg.videoBase64 as string, msg.url as string, msg.contentType as string);
    }
  });

  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === "openSideBar") {
      void openVerifAISidePanel({
        tabId: sender.tab?.id,
        windowId: sender.tab?.windowId,
      });
    }
  });
});
