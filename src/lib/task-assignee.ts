/**
 * The name to show for a task's assignee. Task.assignedTo holds a user id;
 * getProjectById adds the user as assignedToUser, and the board has the user
 * list. A user id is never shown.
 */
export function assigneeName(
  task: { assignedTo?: string | null; assignedToUser?: { name: string } | null },
  users: ReadonlyArray<{ id: string; name: string }> = [],
): string | undefined {
  if (!task.assignedTo) return undefined;
  return task.assignedToUser?.name ?? users.find((user) => user.id === task.assignedTo)?.name;
}
