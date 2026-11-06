export type PortalTaskDeepLinkTarget = {
  phaseId: string;
  templateKey: string;
};

export function resolvePortalTaskDeepLink(
  search: URLSearchParams,
  tasks: PortalTaskDeepLinkTarget[]
) {
  if (search.get("tab") !== "tasks") return null;
  const taskKey = search.get("task")?.trim();
  if (!taskKey) return null;
  return tasks.find((task) => task.templateKey === taskKey) ?? null;
}
