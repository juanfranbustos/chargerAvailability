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
| `CHECK_INTERVAL_SECONDS` | no | solo en modo servidor, por defecto `60` |

> El plan gratuito de TomTom permite unas 2.500 peticiones/día: una por minuto (1.440/día) cabe de sobra; cada 30 s no.

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

Se ejecuta cada minuto. Logs: `npx wrangler tail`. Probar en local: `npm run cf:test` y abrir
`http://localhost:8787/__scheduled` (las variables en local van en `.dev.vars`, mismo formato que `.env`).

## Opción B — Railway (o cualquier VPS / Raspberry Pi)

1. New Project → Deploy from GitHub repo.
2. Añade las variables en *Variables*. Railway ejecuta `npm start`.
3. Opcional: monta un volumen en `/data` y pon `STATE_FILE=/data/state.json` para no perder el estado entre despliegues.

Es un *worker* sin puerto: no hace falta exponer un dominio.
