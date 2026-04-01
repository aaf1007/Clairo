export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("Hello content world.");
    // Listen for messages sent from background.ts
    browser.runtime.onMessage.addListener((message) => {
      if (message.type !== "CLAIRO_CHECK") return;

      const text = message.text;
      const url = message.url;
    });
  },
});
