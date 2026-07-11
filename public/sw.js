/* Date Spot Planner — Web Push service worker.
   Vanilla JS, served from the origin root at /sw.js so it can control the whole
   site. Two jobs: show notifications from `push` events, and route clicks to the
   right page. */

// Show a notification when a push arrives.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Date Spot Planner", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Date Spot Planner";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/badge-72.png",
    tag: data.tag, // same tag collapses/replaces an existing notification
    data: { url: data.url || "/" },
  };

  // waitUntil keeps the worker alive until the notification is shown.
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab on the target URL, or open a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        const clientPath = new URL(client.url).pathname;
        if (clientPath === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })(),
  );
});

// Take control as soon as a new worker version is ready.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));
