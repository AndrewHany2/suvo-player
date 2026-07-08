import { useEffect, useMemo } from "react";
import { useApp } from "../../context/AppContext";
import { contentService } from "../services/ContentService";

/**
 * Returns contentService pre-configured with the active user's credentials.
 * Also exposes the active user for convenience.
 */
export function useContentService() {
  const { users, activeUserId } = useApp();

  const activeUser = useMemo(
    () => users.find((u) => u.id === activeUserId) ?? null,
    [users, activeUserId],
  );

  // Keep ContentService credentials in sync whenever the active user changes.
  useEffect(() => {
    if (activeUser) {
      contentService.configure({
        type: activeUser.type,
        host: activeUser.host,
        username: activeUser.username,
        password: activeUser.password,
        url: activeUser.url,
      });
    } else {
      contentService.configure(null);
    }
  }, [activeUser]);

  return { contentService, activeUser, activeUserId };
}
