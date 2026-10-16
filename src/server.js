// Proceso continuo: Railway, un VPS, una Raspberry Pi... o tu ordenador.
// `node src/server.js --once` hace una sola comprobación y termina.
import fs from "node:fs/promises";
import { runCheck } from "./core.js";

const STATE_FILE = process.env.STATE_FILE || "state.json";
const INTERVAL_MS = Number(process.env.CHECK_INTERVAL_SECONDS || 60) * 1000;

const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

async function loadState() {
    try {
        return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    } catch {
        return {};
    }
}

async function saveState(state) {
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        log(`No se pudo guardar ${STATE_FILE}: ${err.message}`);
    }
}

// Estado en memoria; el fichero solo sirve para sobrevivir a reinicios
let state = await loadState();

async function tick() {
    try {
        state = await runCheck({
            env: process.env,
            loadState: () => state,
            saveState,
            log,
        });
    } catch (err) {
        log(`Error: ${err.message}`);
    }
}

if (process.argv.includes("--once")) {
    await tick();
} else {
    log(`Comprobando cada ${INTERVAL_MS / 1000}s`);
    let timer;
    const loop = async () => {
        await tick();
        timer = setTimeout(loop, INTERVAL_MS);
    };
    loop();

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            clearTimeout(timer);
            log(`${signal} recibido, saliendo`);
            process.exit(0);
        });
    }
}
