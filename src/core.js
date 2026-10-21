// Lógica común: consulta REVE (Red Eléctrica), usa TomTom de respaldo y avisa por Telegram.
// No depende de Node ni de Cloudflare: el "runner" le pasa el entorno y cómo guardar el estado.

const REQUEST_TIMEOUT_MS = 10_000;
const ERROR_ALERT_THRESHOLD = 5; // fallos seguidos antes de avisar por Telegram

// API pública de la web de REVE: sin límite publicado (la oficial con clave solo admite 5 peticiones/hora)
const REVE_URL = "https://www.mapareve.es/api/public/v1";
// El plan gratuito de la Search API de TomTom da 2.500 peticiones al mes: ~1 cada 18 min
const TOMTOM_DEFAULT_MIN_INTERVAL_SECONDS = 1080;
const REVE_STATUS_LABELS = {
    AVAILABLE: "libre",
    CHARGING: "cargando",
    RESERVED: "reservada",
    BLOCKED: "bloqueada",
    INOPERATIVE: "inoperativa",
    OUTOFORDER: "averiada",
    PLANNED: "planificada",
    REMOVED: "retirada",
    UNKNOWN: "desconocido",
};

export function readConfig(env) {
    const reveLocationId = env.REVE_LOCATION_ID || null;
    const tomtomEnabled = Boolean(env.TOMTOM_API_KEY && env.CHARGER_ID);
    const config = {
        reveLocationId,
        tomtomEnabled,
        tomtomApiKey: env.TOMTOM_API_KEY,
        chargerId: env.CHARGER_ID,
        // Con REVE, TomTom es solo respaldo y se limita para no agotar la cuota mensual
        tomtomMinIntervalMs: Number(env.TOMTOM_MIN_INTERVAL_SECONDS
            || (reveLocationId ? TOMTOM_DEFAULT_MIN_INTERVAL_SECONDS : 0)) * 1000,
        chargerName: env.CHARGER_NAME || "Cargador",
        telegramToken: env.TELEGRAM_TOKEN,
        telegramChatId: env.TELEGRAM_CHAT_ID,
        notifyWhenOccupied: env.NOTIFY_WHEN_OCCUPIED === "true",
    };

    const missing = ["TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"].filter((name) => !env[name]);
    if (!reveLocationId && !tomtomEnabled) missing.push("REVE_LOCATION_ID o TOMTOM_API_KEY + CHARGER_ID");
    if (missing.length > 0) {
        throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
    }

    return config;
}

export async function fetchAvailability(config) {
    const url = new URL("https://api.tomtom.com/search/2/chargingAvailability.json");
    url.searchParams.set("key", config.tomtomApiKey);
    url.searchParams.set("chargingAvailability", config.chargerId);

    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const message = data?.detailedError?.message || data?.errorText || res.statusText;
        throw new Error(`TomTom ${res.status}: ${message}`);
    }

    if (!Array.isArray(data?.connectors) || data.connectors.length === 0) {
        throw new Error("TomTom no devuelve conectores para este CHARGER_ID");
    }

    // Sumamos todos los tipos de conector, no solo el primero
    const totals = { total: 0, available: 0, occupied: 0, reserved: 0, unknown: 0, outOfService: 0 };
    for (const connector of data.connectors) {
        const current = connector?.availability?.current ?? {};
        totals.total += connector?.total ?? 0;
        for (const key of ["available", "occupied", "reserved", "unknown", "outOfService"]) {
            totals[key] += current[key] ?? 0;
        }
    }

    // Si TomTom no sabe nada del estado no lo tomamos como "ocupado"
    if (totals.available + totals.occupied + totals.reserved === 0 && totals.unknown > 0) {
        throw new Error("TomTom devuelve estado desconocido para todos los conectores");
    }

    return totals;
}

// Estado por toma según REVE, que lo recibe directamente del operador (OCPI)
export async function fetchReve(config) {
    const res = await fetch(`${REVE_URL}/locations/${encodeURIComponent(config.reveLocationId)}`, {
        headers: { "User-Agent": "charger-watcher/1.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`REVE ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data?.evses) || data.evses.length === 0) {
        throw new Error("REVE no devuelve tomas para este REVE_LOCATION_ID");
    }

    const sockets = data.evses.map((evse, index) => ({
        name: `Toma ${evse.evse_id?.split("*").at(-1) ?? index + 1}`,
        status: evse.status ?? "UNKNOWN",
    }));
    if (sockets.every((s) => s.status === "UNKNOWN")) {
        throw new Error("REVE no conoce el estado de ninguna toma");
    }
    const lat = data.coordinates?.latitude;
    const lng = data.coordinates?.longitude;

    return {
        available: sockets.filter((s) => s.status === "AVAILABLE").length,
        sockets,
        mapsUrl: lat && lng ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null,
    };
}

function describeSockets(sockets) {
    return sockets.map((s) => `${s.name}: ${REVE_STATUS_LABELS[s.status] ?? s.status.toLowerCase()}`).join("\n");
}

export async function sendTelegram(config, text, buttons = []) {
    const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
    const body = { chat_id: config.telegramChatId, text };
    if (buttons.length > 0) body.reply_markup = { inline_keyboard: [buttons] };

    for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (res.ok) return;

        const data = await res.json().catch(() => null);
        const retryAfter = data?.parameters?.retry_after;
        if (attempt === 3 || (res.status < 500 && !retryAfter)) {
            throw new Error(`Telegram ${res.status}: ${data?.description || res.statusText}`);
        }
        await new Promise((resolve) => setTimeout(resolve, (retryAfter ?? attempt) * 1000));
    }
}

// REVE primero; si falla, TomTom como respaldo respetando su intervalo mínimo
async function fetchStatus(config, previous, next, log, now) {
    let reveError = null;
    if (config.reveLocationId) {
        try {
            const reve = await fetchReve(config);
            log(`REVE: ${reve.sockets.map((s) => s.status).join(", ")} (avisado: ${previous.free ?? "?"})`);
            return { source: "reve", ...reve };
        } catch (err) {
            reveError = err;
            log(`Error consultando REVE: ${err.message}`);
        }
    }

    if (!config.tomtomEnabled) throw reveError;
    if (now() - previous.tomtomCheckedAt < config.tomtomMinIntervalMs) {
        throw new Error(`${reveError.message} (TomTom en espera para no gastar cuota)`);
    }

    next.tomtomCheckedAt = now();
    try {
        const tomtom = await fetchAvailability(config);
        log(`TomTom: libres ${tomtom.available}/${tomtom.total} (avisado: ${previous.free ?? "?"})`);
        return { source: "tomtom", ...tomtom };
    } catch (err) {
        throw new Error(reveError ? `${reveError.message} · ${err.message}` : err.message);
    }
}

function describeStatus(status) {
    if (status.source === "reve") {
        return [describeSockets(status.sockets), "✔️ Según Red Eléctrica (REVE)"];
    }
    return [
        `${status.available} de ${status.total} conector(es) disponible(s)`,
        `Ocupados: ${status.occupied} · Reservados: ${status.reserved} · Fuera de servicio: ${status.outOfService}`,
        "⚠️ Según TomTom (REVE no responde)",
    ];
}

// state = { free: boolean | null, errors: number, tomtomCheckedAt: number }
// `free` es el último estado del que te hemos avisado
export async function runCheck({ env, loadState, saveState, log = console.log, now = Date.now }) {
    const config = readConfig(env);
    const loaded = (await loadState()) ?? {};
    const previous = {
        free: loaded.free ?? (loaded.available == null ? null : loaded.available > 0), // estado antiguo {available}
        errors: loaded.errors ?? 0,
        tomtomCheckedAt: loaded.tomtomCheckedAt ?? 0,
    };
    const next = { ...previous };
    const messages = [];

    try {
        const status = await fetchStatus(config, previous, next, log, now);
        const free = status.available > 0;

        if (previous.errors >= ERROR_ALERT_THRESHOLD) {
            messages.push({ text: "✅ Vuelvo a poder consultar el estado del cargador" });
        }

        if (previous.free !== null && free !== previous.free && (free || config.notifyWhenOccupied)) {
            const title = free ? `⚡🟢 ${config.chargerName} LIBRE` : `⚡🔴 ${config.chargerName} OCUPADO`;
            messages.push({
                text: [title, ...describeStatus(status)].join("\n"),
                buttons: free && status.mapsUrl ? [{ text: "📍 Cómo llegar", url: status.mapsUrl }] : [],
            });
        }

        next.free = free;
        next.errors = 0;
    } catch (err) {
        log(`Error consultando el cargador: ${err.message}`);
        // Mantenemos el último estado conocido; el contador se limita para no escribir sin parar
        next.errors = Math.min(previous.errors + 1, ERROR_ALERT_THRESHOLD);
        if (previous.errors === ERROR_ALERT_THRESHOLD - 1) {
            messages.push({ text: `⚠️ No puedo consultar el cargador (${ERROR_ALERT_THRESHOLD} fallos seguidos)\n${err.message}` });
        }
    }

    for (const message of messages) {
        await sendTelegram(config, message.text, message.buttons);
    }

    // Guardamos después de enviar: si Telegram falla, se reintentará en la siguiente consulta
    if (JSON.stringify(next) !== JSON.stringify(loaded)) {
        await saveState(next);
    }

    return next;
}
