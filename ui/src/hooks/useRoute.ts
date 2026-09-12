import { useCallback, useEffect, useState } from "react";
import { navigateTo, parseRoute, type AppRoute } from "@/lib/router";

export function useRoute(): [AppRoute, (route: AppRoute, replace?: boolean) => void] {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === "undefined"
      ? { name: "legacy-workbench" }
      : parseRoute(window.location.pathname, window.location.search),
  );

  useEffect(() => {
    const onPop = () => {
      setRoute(parseRoute(window.location.pathname, window.location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: AppRoute, replace = false) => {
    navigateTo(next, replace);
    setRoute(next);
  }, []);

  return [route, navigate];
}
