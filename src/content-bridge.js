(() => {
  console.log("content-bridge.js");
  window.addEventListener("message", async (event) => {
    if (event.data?.source === "viberly-ping") {
      console.log("viberly-ping");
      window.postMessage({ source: "viberly-extension", pong: true }, "*");
    }

    if (event.data?.source === "activate-viberly-extension") {
      try {
        session = event.data.session;
        browser.runtime.sendMessage({
          type: "SET_SESSION",
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          userId: session.userId,
          email: session.email,
        });
      } catch (e) {
        console.warn("[popup→bg] SET_SESSION (login) failed", e);
      }
    }
  });
})();
