export async function register() {
  // Boot the push send-loop with the server so cues scheduled before a
  // restart still fire without waiting for the next incoming request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensurePushLoop } = await import("./lib/push-server");
    await ensurePushLoop();
  }
}
