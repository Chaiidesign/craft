import { apiFetchJson } from "./client";
import { API_BASE_URL } from "@/lib/config";
import type { BrowserView } from "@/types/chat";

/** Open a tab in the user's own Chrome; the returned screencast takes their mouse and keyboard. */
export async function openBrowser(url: string): Promise<BrowserView> {
  const data = await apiFetchJson<{ url: string; page_url: string }>(`${API_BASE_URL}/browser/open`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  return { url: data.url, pageUrl: data.page_url };
}
