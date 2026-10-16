// Cloudflare Worker: un Cron Trigger lo ejecuta cada minuto y el estado vive en KV.
import { runCheck } from "./core.js";

const STATE_KEY = "state";

export default {
    async scheduled(_event, env, ctx) {
        ctx.waitUntil(runCheck({
            env,
            loadState: async () => (await env.STATE.get(STATE_KEY, "json")) ?? {},
            saveState: (state) => env.STATE.put(STATE_KEY, JSON.stringify(state)),
        }));
    },
};
