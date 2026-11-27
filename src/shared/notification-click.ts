export function notificationPath(data: unknown): string {
  if (typeof data !== 'object' || data === null || !('path' in data)) {
    return '/notifiche';
  }
  const path = data.path;
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\')
  ) {
    return '/notifiche';
  }
  if (path.includes('://')) {
    return '/notifiche';
  }
  return path;
}

type NotificationClient = {
  url: string;
  focus: () => Promise<void>;
  navigate?: (path: string) => Promise<void>;
};

type NotificationClients = {
  matchAll: () => Promise<NotificationClient[]>;
  openWindow: (path: string) => Promise<void>;
};

export async function openNotificationPath(
  clients: NotificationClients,
  path: string,
): Promise<void> {
  const open = clients.matchAll();
  const windows = await open;
  for (const client of windows) {
    if (new URL(client.url).pathname === path) {
      await client.focus();
      return;
    }
  }
  const current = windows[0];
  if (current?.navigate) {
    await current.navigate(path);
    await current.focus();
    return;
  }
  await clients.openWindow(path);
}
