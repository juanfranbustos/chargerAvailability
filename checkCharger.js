import fetch from "node-fetch";

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY;
const CHARGER_ID = process.env.CHARGER_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message
        })
    });
}

async function checkCharger() {
    const url = `https://api.tomtom.com/search/2/chargingAvailability.json?key=${TOMTOM_API_KEY}&chargingAvailability=${CHARGER_ID}`;

    const res = await fetch(url);
    const data = await res.json();

    const available = data?.connectors?.available ?? 0;

    console.log("Available connectors:", available);

    if (available >= 1) {
        await sendTelegram(
            `⚡ CARGADOR LIBRE\nHay ${available} conector(es) disponibles`
        );
    } else {
        await sendTelegram(
            `⚡ NO HAY CARGADOR LIBRE\nHay ${available} conector(es) disponibles`
        );
    }
}

checkCharger().catch(console.error);
