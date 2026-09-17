self.addEventListener("push", event => {
    let data = {
        title: "XSngr",
        body: "New message"
    };

    try {
        if (event.data)
            data = {...data, ...event.data.json()};
    } catch (e) {}

    event.waitUntil(
        self.registration.showNotification(
            data.title || "XSngr",
            {
                body: data.body || "New message",
                icon: "/favicon.ico",
                tag: "xsngr - " + (data.room ?? "global"),
                data: {
                    room: data.room
                }
            }
        )
    );
});

self.addEventListener("notificationclick", event => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then(openClients => {

            for (const client of openClients) {
                if ("focus" in client)
                    return client.focus();
            }

            if (clients.openWindow)
                return clients.openWindow("/");
        })
    );
});

