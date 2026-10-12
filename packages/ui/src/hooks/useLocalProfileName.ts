import { useSyncExternalStore } from "react";

const STORAGE_KEY = "two-code.local-profile-name";
const CHANGE_EVENT = "two-code-local-profile-name-changed";
export const PROFILE_NAME_LIMIT = 24;
export const DEFAULT_PROFILE_NAME = "Two Code";

function readProfileName(): string {
  try {
    const value = localStorage.getItem(STORAGE_KEY)?.trim();
    return value && Array.from(value).length <= PROFILE_NAME_LIMIT ? value : DEFAULT_PROFILE_NAME;
  } catch {
    return DEFAULT_PROFILE_NAME;
  }
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function saveLocalProfileName(draft: string): void {
  const name = draft.trim();
  if (!name || Array.from(name).length > PROFILE_NAME_LIMIT)
    throw new Error("Invalid profile name");
  // 先持久化再通知；磁盘/存储失败时不能让侧栏看起来已经保存成功。
  localStorage.setItem(STORAGE_KEY, name);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useLocalProfileName(): string {
  return useSyncExternalStore(subscribe, readProfileName, () => DEFAULT_PROFILE_NAME);
}
