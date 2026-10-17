# charger-watcher

Consulta la disponibilidad de un cargador en TomTom y avisa por Telegram cuando pasa de ocupado a libre
(y opcionalmente al revés). Si TomTom falla 5 veces seguidas también avisa, y otra vez cuando se recupera.

Sin dependencias: Node 22+ o Cloudflare Workers.

## Variables

| Variable | Obligatoria | Descripción |
|---|---|---|
| `TOMTOM_API_KEY` | sí | |
| `CHARGER_ID` | sí | id de `chargingAvailability` |
| `TELEGRAM_TOKEN` | sí | token del bot |
| `TELEGRAM_CHAT_ID` | sí | |
| `CHARGER_NAME` | no | nombre que aparece en el mensaje |
| `NOTIFY_WHEN_OCCUPIED` | no | `true` para avisar también cuando vuelve a estar ocupado |
| `CHARGER_MAPS_URL` | no | enlace para el botón "📍 Cómo llegar" del aviso |
| `CHECK_INTERVAL_SECONDS` | no | segundos entre consultas, por defecto `60` (en Cloudflare está a `36`) |

> El plan gratuito de TomTom permite 2.500 peticiones/día. Con 36 s salen 2.400/día, dejando margen para pruebas;
> por debajo de 35 s te quedarías sin cuota antes de acabar el día.

## En local

```sh
cp .env.example .env   # y rellénalo
npm run check          # una comprobación
npm run dev            # en bucle
```

## Opción A — Cloudflare Workers (gratis, recomendado)

```sh
npx wrangler login
npx wrangler kv namespace create STATE        # copia el id en wrangler.toml
npx wrangler secret put TOMTOM_API_KEY
npx wrangler secret put CHARGER_ID
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npm run cf:deploy
```

El cron despierta al Worker cada minuto y este hace las consultas que tocan en ese minuto (1 o 2 con 36 s). Logs: `npx wrangler tail`. Probar en local: `npm run cf:test` y abrir
`http://localhost:8787/__scheduled` (las variables en local van en `.dev.vars`, mismo formato que `.env`).

## Opción B — Railway (o cualquier VPS / Raspberry Pi)

1. New Project → Deploy from GitHub repo.
2. Añade las variables en *Variables*. Railway ejecuta `npm start`.
3. Opcional: monta un volumen en `/data` y pon `STATE_FILE=/data/state.json` para no perder el estado entre despliegues.

Es un *worker* sin puerto: no hace falta exponer un dominio.
