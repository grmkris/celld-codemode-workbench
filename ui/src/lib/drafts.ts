const TAB_SESSION_KEY = "celld_tab_session";

function tabSessionId(): string {
  if (typeof sessionStorage === "undefined") return "ssr";
  let id = sessionStorage.getItem(TAB_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_SESSION_KEY, id);
  }
  return id;
}

function draftKey(conversationId: string): string {
  return `celld_draft:${conversationId}:${tabSessionId()}`;
}

export function readDraft(conversationId: string): string {
  if (!conversationId || typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(draftKey(conversationId)) ?? "";
}

export function writeDraft(conversationId: string, text: string): void {
  if (!conversationId || typeof sessionStorage === "undefined") return;
  const key = draftKey(conversationId);
  if (!text.trim()) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(key, text);
}

export function clearDraft(conversationId: string): void {
  if (!conversationId || typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(draftKey(conversationId));
}
