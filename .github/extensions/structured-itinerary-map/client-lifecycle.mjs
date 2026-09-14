export function attachClientLifecycle({
    events,
    window,
    themeQuery,
    onlineHandler,
    themeHandler,
    onConnected,
    onDisconnected,
    dispose,
}) {
    let tornDown = false;
    const teardown = () => {
        if (tornDown) return;
        tornDown = true;
        events.removeEventListener("open", onConnected);
        events.removeEventListener("error", onDisconnected);
        events.close();
        window.removeEventListener("online", onlineHandler);
        window.removeEventListener("pagehide", teardown);
        window.removeEventListener("beforeunload", teardown);
        themeQuery.removeEventListener("change", themeHandler);
        dispose();
    };
    events.addEventListener("open", onConnected);
    events.addEventListener("error", onDisconnected);
    window.addEventListener("pagehide", teardown, { once: true });
    window.addEventListener("beforeunload", teardown, { once: true });
    return { teardown };
}
