export default defineContentScript({
  matches: ["*://*.tiktok.com/*"],
  main() {
    let scanTimeout: ReturnType<typeof setTimeout> | null = null;

    function scheduleScan() {
      if (scanTimeout) return;
      scanTimeout = setTimeout(() => {
        scanTimeout = null;
        scanAndInject();
      }, 300);
    }

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial scan after brief delay for TikTok to hydrate
    setTimeout(scanAndInject, 1000);
  },
});

function scanAndInject() {
  const videos = document.querySelectorAll<HTMLVideoElement>("video");
  videos.forEach((video) => {
    const actionBar = findActionBar(video);
    if (!actionBar) return;

    // Skip if already injected into this action bar
    if (actionBar.querySelector("[data-verifai-btn]")) return;

    const btn = createButton(video);
    actionBar.appendChild(btn);
  });
}

function findActionBar(video: HTMLVideoElement): Element | null {
  // Walk up from the video to find a common ancestor containing the action buttons
  let ancestor: Element | null = video;
  for (let i = 0; i < 15; i++) {
    ancestor = ancestor?.parentElement ?? null;
    if (!ancestor) break;

    // Strategy 1: data-e2e attributes TikTok uses for testing (most stable)
    const likeBtn = ancestor.querySelector(
      '[data-e2e="like-icon"], [data-e2e="browse-like-icon"], [data-e2e="video-like-icon"]'
    );
    if (likeBtn) {
      return likeBtn.parentElement;
    }
  }

  // Strategy 2: structural fallback — find a cluster of SVG icon buttons near the video
  ancestor = video;
  for (let i = 0; i < 15; i++) {
    ancestor = ancestor?.parentElement ?? null;
    if (!ancestor) break;

    const svgButtons = ancestor.querySelectorAll("button svg, [role='button'] svg");
    if (svgButtons.length >= 3) {
      return svgButtons[0].closest("button, [role='button']")?.parentElement ?? null;
    }
  }

  return null;
}

function createButton(video: HTMLVideoElement): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-verifai-btn", "true");
  container.title = "VerifAI: Fact-check this video";
  Object.assign(container.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    cursor: "pointer",
    margin: "4px 0",
    userSelect: "none",
  });

  const iconWrap = document.createElement("div");
  Object.assign(iconWrap.style, {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.15)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
    transition: "background 0.2s",
  });
  iconWrap.innerHTML = `<img src="${browser.runtime.getURL('/verifai/favicon.svg')}" width="28" height="28" style="object-fit:contain;" />`;

  const label = document.createElement("span");
  Object.assign(label.style, {
    color: "#fff",
    fontSize: "11px",
    marginTop: "4px",
    fontWeight: "600",
    textShadow: "0 1px 2px rgba(0,0,0,0.5)",
  });
  label.textContent = "VerifAI";

  container.appendChild(iconWrap);
  container.appendChild(label);

  container.addEventListener("mouseenter", () => {
    if (!container.dataset.state || container.dataset.state === "idle") {
      iconWrap.style.background = "rgba(255,255,255,0.28)";
    }
  });
  container.addEventListener("mouseleave", () => {
    if (!container.dataset.state || container.dataset.state === "idle") {
      iconWrap.style.background = "rgba(255,255,255,0.15)";
    }
  });

  container.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (container.dataset.state === "loading") return;

    setButtonState(container, iconWrap, label, "loading");

    try {
      const base64 = await captureVideoBase64(video);

      // Listen for result to update button state
      const storageListener = (changes: Record<string, { newValue?: any; oldValue?: any }>) => {
        if (!changes.verifaiResults) return;
        const results: any[] = changes.verifaiResults.newValue ?? [];
        const latest = results[results.length - 1];
        if (!latest) return;

        if (latest.status === "done") {
          setButtonState(container, iconWrap, label, "done");
          browser.storage.onChanged.removeListener(storageListener);
        } else if (latest.status === "error") {
          setButtonState(container, iconWrap, label, "error");
          browser.storage.onChanged.removeListener(storageListener);
        }
      };
      browser.storage.onChanged.addListener(storageListener);

      await browser.runtime.sendMessage({
        type: "TIKTOK_VIDEO_VERIFY",
        videoBase64: base64,
        url: window.location.href,
        contentType: "video/mp4",
      });
    } catch (err) {
      console.error("[VerifAI] Capture failed:", err);
      setButtonState(container, iconWrap, label, "error");
    }
  });

  return container;
}

function setButtonState(
  container: HTMLElement,
  iconWrap: HTMLElement,
  label: HTMLElement,
  state: "idle" | "loading" | "done" | "error"
) {
  container.dataset.state = state;
  switch (state) {
    case "loading":
      iconWrap.textContent = "⏳";
      iconWrap.style.background = "rgba(255,200,0,0.25)";
      label.textContent = "Checking…";
      break;
    case "done":
      iconWrap.textContent = "✅";
      iconWrap.style.background = "rgba(0,200,80,0.25)";
      label.textContent = "Done!";
      setTimeout(() => setButtonState(container, iconWrap, label, "idle"), 3000);
      break;
    case "error":
      iconWrap.textContent = "❌";
      iconWrap.style.background = "rgba(255,60,60,0.25)";
      label.textContent = "Error";
      setTimeout(() => setButtonState(container, iconWrap, label, "idle"), 3000);
      break;
    default:
      iconWrap.innerHTML = `<img src="${browser.runtime.getURL('/verifai/favicon.svg')}" width="28" height="28" style="object-fit:contain;" />`;
      iconWrap.style.background = "rgba(255,255,255,0.15)";
      label.textContent = "VerifAI";
      break;
  }
}

/**
 * Captures the video as a base64 string by injecting a script into the page's
 * main world. Content scripts run in an isolated world and cannot access blob:
 * URLs owned by the page. Injecting a <script> tag bypasses this restriction
 * because injected scripts run in the main world and share its blob registry.
 */
async function captureVideoBase64(video: HTMLVideoElement): Promise<string> {
  const src = video.src;

  if (src && src.startsWith("blob:")) {
    return injectFetchBlob(src);
  }

  // Fallback: direct HTTP src (uncommon for TikTok but possible)
  if (src && src.startsWith("http")) {
    const resp = await fetch(src);
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      return arrayBufferToBase64(buf);
    }
  }

  throw new Error("Could not capture video — no accessible source found");
}

/**
 * Injects an inline <script> into the page's main world to fetch a blob URL,
 * then relays the data back to the content script via window.postMessage.
 */
function injectFetchBlob(blobUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const msgId = `verifai-${Date.now()}-${Math.random()}`;

    const handler = (e: MessageEvent) => {
      if (!e.data || e.data.type !== "VERIFAI_VIDEO_DATA" || e.data.id !== msgId) return;
      window.removeEventListener("message", handler);
      clearTimeout(timer);
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve(e.data.base64 as string);
      }
    };
    window.addEventListener("message", handler);

    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Video capture timed out"));
    }, 30_000);

    // Inline script runs in the main world and can access the page's blob registry
    const script = document.createElement("script");
    script.textContent = `
      (async () => {
        try {
          const resp = await fetch(${JSON.stringify(blobUrl)});
          const buf = await resp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // Chunked btoa to avoid call-stack overflow on large videos
          let str = '';
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            str += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          window.postMessage({ type: "VERIFAI_VIDEO_DATA", id: ${JSON.stringify(msgId)}, base64: btoa(str) }, "*");
        } catch (err) {
          window.postMessage({ type: "VERIFAI_VIDEO_DATA", id: ${JSON.stringify(msgId)}, error: String(err) }, "*");
        }
      })();
    `;
    document.head.appendChild(script);
    script.remove();
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(str);
}

