// Lógica común: consulta TomTom, compara con el estado anterior y avisa por Telegram.
// No depende de Node ni de Cloudflare: el "runner" le pasa el entorno y cómo guardar el estado.

const REQUEST_TIMEOUT_MS = 10_000;
const ERROR_ALERT_THRESHOLD = 5; // fallos seguidos antes de avisar por Telegram

export function readConfig(env) {
    const config = {
        tomtomApiKey: env.TOMTOM_API_KEY,
        chargerId: env.CHARGER_ID,
        chargerName: env.CHARGER_NAME || "Cargador",
        telegramToken: env.TELEGRAM_TOKEN,
        telegramChatId: env.TELEGRAM_CHAT_ID,
        notifyWhenOccupied: env.NOTIFY_WHEN_OCCUPIED === "true",
        mapsUrl: env.CHARGER_MAPS_URL || null,
    };

    const missing = ["TOMTOM_API_KEY", "CHARGER_ID", "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"]
        .filter((name) => !env[name]);
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

// state = { free: boolean | null, errors: number }
// `free` es el último estado visto: true si había alguna toma libre
export async function runCheck({ env, loadState, saveState, log = console.log }) {
    const config = readConfig(env);
    const loaded = (await loadState()) ?? {};
    const previous = {
        free: loaded.free ?? (loaded.available == null ? null : loaded.available > 0), // estado antiguo {available}
        errors: loaded.errors ?? 0,
    };
    const next = { ...previous };
    const messages = [];

    try {
        const current = await fetchAvailability(config);
        const isFree = current.available > 0;
        log(`TomTom: libres ${current.available}/${current.total} (antes: ${previous.free ?? "?"})`);

        if (previous.errors >= ERROR_ALERT_THRESHOLD) {
            messages.push({ text: "✅ Vuelvo a poder consultar el estado del cargador" });
        }

        // Solo avisamos en los cambios de estado, no en cada consulta (la primera lectura solo se guarda)
        if (previous.free === false && isFree) {
            messages.push({
                text: `⚡🟢 ${config.chargerName} LIBRE\n${current.available} de ${current.total} conector(es) disponible(s)`,
                buttons: config.mapsUrl ? [{ text: "📍 Cómo llegar", url: config.mapsUrl }] : [],
            });
        } else if (config.notifyWhenOccupied && previous.free === true && !isFree) {
            messages.push({
                text: `⚡🔴 ${config.chargerName} OCUPADO\n` +
                    `Ocupados: ${current.occupied} · Reservados: ${current.reserved} · Fuera de servicio: ${current.outOfService}`,
            });
        }

        next.free = isFree;
        next.errors = 0;
    } catch (err) {
        log(`Error consultando TomTom: ${err.message}`);
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
