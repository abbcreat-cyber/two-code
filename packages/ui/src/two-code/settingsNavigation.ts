import type { HarnessId } from "@zcode/services";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
export const harnessSettingsEvent = "two-code:harness-settings";
let pending: HarnessId | undefined;
export function openHarnessSettings(harness: HarnessId) {
  pending = harness;
  setPendingSettingsSectionIntent("modelProvider");
  window.dispatchEvent(new Event(harnessSettingsEvent));
}
export function consumeHarnessSettings(): HarnessId | undefined {
  const value = pending;
  pending = undefined;
  return value;
}
