export type AppRoute =
  | { name: "login" }
  | { name: "signup" }
  | { name: "invite"; token: string }
  | { name: "team-chat"; teamId: string; conversationId: string }
  | { name: "team-machines"; teamId: string }
  | { name: "team-task"; teamId: string; taskId: string }
  | { name: "legacy-workbench"; conversationId?: string };

export function parseRoute(pathname: string, search: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);

  if (path === "/login") return { name: "login" };
  if (path === "/signup") return { name: "signup" };

  const invite = path.match(/^\/invite\/([^/]+)$/);
  if (invite) return { name: "invite", token: decodeURIComponent(invite[1]) };

  const chat = path.match(/^\/t\/([^/]+)\/c\/([^/]+)$/);
  if (chat) {
    return {
      name: "team-chat",
      teamId: decodeURIComponent(chat[1]),
      conversationId: decodeURIComponent(chat[2]),
    };
  }

  const machines = path.match(/^\/t\/([^/]+)\/machines$/);
  if (machines) return { name: "team-machines", teamId: decodeURIComponent(machines[1]) };

  const task = path.match(/^\/t\/([^/]+)\/tasks\/([^/]+)$/);
  if (task) {
    return {
      name: "team-task",
      teamId: decodeURIComponent(task[1]),
      taskId: decodeURIComponent(task[2]),
    };
  }

  const legacyConversation = params.get("c") ?? undefined;
  return { name: "legacy-workbench", conversationId: legacyConversation ?? undefined };
}

export function routePath(route: AppRoute): string {
  switch (route.name) {
    case "login":
      return "/login";
    case "signup":
      return "/signup";
    case "invite":
      return `/invite/${encodeURIComponent(route.token)}`;
    case "team-chat":
      return `/t/${encodeURIComponent(route.teamId)}/c/${encodeURIComponent(route.conversationId)}`;
    case "team-machines":
      return `/t/${encodeURIComponent(route.teamId)}/machines`;
    case "team-task":
      return `/t/${encodeURIComponent(route.teamId)}/tasks/${encodeURIComponent(route.taskId)}`;
    case "legacy-workbench":
      return route.conversationId ? `/?c=${encodeURIComponent(route.conversationId)}` : "/";
    default:
      return "/";
  }
}

export function navigateTo(route: AppRoute, replace = false): void {
  const next = routePath(route);
  if (replace) {
    window.history.replaceState({}, "", next);
  } else {
    window.history.pushState({}, "", next);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoutePath(): AppRoute {
  if (typeof window === "undefined") return { name: "legacy-workbench" };
  return parseRoute(window.location.pathname, window.location.search);
}
