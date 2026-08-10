import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { getLocalBridgeUrl, localBridgeProfilePath, type LocalBridgePlatform } from "./config";

const profileRoot = path.resolve(".creator-os", "browser-profiles");
const extensionDirectory = path.resolve("public", "local-bridge-extension");

export function getBridgeProfileDirectory(creatorId: string, accountId: string) {
  const legacy=localBridgeProfilePath(profileRoot,creatorId,accountId);
  if(existsSync(legacy))return legacy;
  return localBridgeProfilePath(profileRoot,creatorId,"creator-profile");
}

export function launchLocalPlatformBrowser(input: { creatorId: string; accountId: string; platform: LocalBridgePlatform; destination?: "login" | "inbox" | "earnings" | "vault"; pairingToken?: string }) {
  if (process.platform !== "darwin") throw new Error("The local bridge currently requires macOS.");
  const profileDirectory = getBridgeProfileDirectory(input.creatorId, input.accountId);
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  const destination = input.pairingToken
    ? `${getLocalBridgeUrl(input.platform, input.destination ?? "inbox")}#creator_os_pair=${encodeURIComponent(input.pairingToken)}`
    : getLocalBridgeUrl(input.platform, input.destination ?? "login");
  const child = spawn("open", ["-na", "Google Chrome", "--args", `--user-data-dir=${profileDirectory}`, `--load-extension=${extensionDirectory}`, "--no-first-run", "--no-default-browser-check", destination], { detached: true, stdio: "ignore" });
  child.unref();
  return profileDirectory;
}
