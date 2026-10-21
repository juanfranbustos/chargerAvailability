// Cloudflare Worker: un Cron Trigger lo despierta cada minuto y el estado vive en KV.
// El cron no baja de 1 minuto, así que en cada ejecución hacemos las comprobaciones que
// tocan en ese minuto según CHECK_INTERVAL_SECONDS (45 s → 1 o 2 consultas a REVE por minuto).
import { runCheck } from "./core.js";

const STATE_KEY = "state";
const MINUTE_MS = 60_000;

// Instantes (ms) múltiplos del intervalo dentro del minuto que empieza en `minuteStart`
export function checkTimesInMinute(minuteStart, intervalMs) {
    const times = [];
    for (let t = Math.ceil(minuteStart / intervalMs) * intervalMs; t < minuteStart + MINUTE_MS; t += intervalMs) {
        times.push(t);
    }
    return times;
}

async function runScheduled(scheduledTime, env) {
    const intervalMs = Number(env.CHECK_INTERVAL_SECONDS || 60) * 1000;
    const minuteStart = Math.floor(scheduledTime / MINUTE_MS) * MINUTE_MS;

    // Leemos KV una vez y mantenemos el estado en memoria entre las comprobaciones del minuto
    let state = (await env.STATE.get(STATE_KEY, "json")) ?? {};

    for (const time of checkTimesInMinute(minuteStart, intervalMs)) {
        const wait = time - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

        try {
            state = await runCheck({
                env,
                loadState: () => state,
                saveState: (next) => env.STATE.put(STATE_KEY, JSON.stringify(next)),
            });
        } catch (err) {
            console.log(`Error: ${err.message}`);
        }
    }
}

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runScheduled(event.scheduledTime, env));
    },
};
