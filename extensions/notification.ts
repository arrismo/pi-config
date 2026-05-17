/**
 * Notification Extension - Sends system notifications when pi completes work
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";

function sendNotification(title: string, message: string): void {
  try {
    const script = `display notification "${message}" with title "${title}"`;
    execSync(`osascript -e '${script}'`, { stdio: "ignore", timeout: 3000 });
  } catch {
    // Silently ignore notification failures
  }
}

export default function notificationExtension(pi: ExtensionAPI) {
  // Test command
  pi.registerCommand("notify-test", {
    description: "Send a test notification",
    handler: async (_args, ctx) => {
      sendNotification("pi", "Test notification!");
      ctx.ui.notify("Check your notifications!", "info");
    },
  });

  // Notify only when the full agent run is finished
  pi.on("agent_end", async () => {
    sendNotification("pi", "All done!");
  });
}