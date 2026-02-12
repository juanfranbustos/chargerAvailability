import fetch from "node-fetch";

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY;
const CHARGER_ID = process.env.CHARGER_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const STATE_FILE = "state.json";

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


function getPreviousState() {
  if (!fs.existsSync(STATE_FILE)) {
    return null; // primera ejecución
  }

  const raw = fs.readFileSync(STATE_FILE);
  const data = JSON.parse(raw);
  return data.available;
}

function saveState(available) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ available }, null, 2)
  );
}

async function checkCharger() {
    const url = `https://api.tomtom.com/search/2/chargingAvailability.json?key=${TOMTOM_API_KEY}&chargingAvailability=${CHARGER_ID}`;

    const res = await fetch(url);
    const data = await res.json();

    

    const available = data.connectors[0].availability.current.available ?? 0;
    const occupied = data.connectors[0].availability.current.occupied ?? 0;
    const reserved = data.connectors[0].availability.current.reserved ?? 0;

      const previous = getPreviousState();
    
      console.log("Previous:", previous);
      console.log("Current:", available);
    
      // Primera ejecución → solo guardar estado, no notificar
      if (previous === null) {
        saveState(available);
        return;
      }

    console.log("Available connectors:", available);

    if (available >= 1) {
        await sendTelegram(
            `⚡🟢 CARGADOR LIBRE\nHay ${available} conector(es) disponibles`
        );
    } /*else {
        await sendTelegram(
            `⚡🔴 CARGADOR OCUPADO\nHay ${occupied} conector(es) ocupado\n Hay ${reserved} cargadores reservados`
        );
    }*/
    saveState(available);
}

checkCharger().catch(console.error);
