import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  srcDir: "src",
  manifest: {
    action: {
      default_title: "Open VerifAI",
    },
    permissions: ["contextMenus", "storage", "sidePanel"],
    host_permissions: ["http://localhost:8000/*"],
    web_accessible_resources: [
      {
        resources: ["/verifai/*"],
        matches: ["*://*.tiktok.com/*"],
      },
    ],
    icons: {
      "16": "/verifai/16.png",
      "32": "/verifai/32.png",
      "48": "/verifai/48.png",
      "96": "/verifai/96.png",
      "128": "/verifai/128.png",
    },
  },
});
