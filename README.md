# charger-watcher

Consulta la disponibilidad de un cargador en [REVE](https://www.mapareve.es) (Red Eléctrica), que recibe el estado de cada
toma directamente del operador, y avisa por Telegram cuando pasa de ocupado a libre (y opcionalmente al revés). Si REVE
falla usa TomTom de respaldo. Si no consigue el estado 5 veces seguidas también avisa, y otra vez cuando se recupera.

Sin dependencias: Node 22+ o Cloudflare Workers.

## Variables

| Variable | Obligatoria | Descripción |
|---|---|---|
| `TELEGRAM_TOKEN` | sí | token del bot |
| `TELEGRAM_CHAT_ID` | sí | |
| `REVE_LOCATION_ID` | sí* | id del cargador en REVE (fuente principal) |
| `TOMTOM_API_KEY` | sí* | respaldo cuando REVE falla |
| `CHARGER_ID` | sí* | id de `chargingAvailability` en TomTom |
| `TOMTOM_MIN_INTERVAL_SECONDS` | no | mínimo entre consultas a TomTom: `1080` si hay REVE, sin límite si no |
| `CHARGER_NAME` | no | nombre que aparece en el mensaje |
| `NOTIFY_WHEN_OCCUPIED` | no | `true` para avisar también cuando vuelve a estar ocupado |
| `CHECK_INTERVAL_SECONDS` | no | segundos entre consultas, por defecto `60` (en Cloudflare está a `45`) |

\* Hace falta REVE, TomTom (clave + `CHARGER_ID`) o ambos.

> REVE se consulta por su API pública (la de su web), que no publica límite pero está detrás de un antibots: si empieza
> a fallar, sube `CHECK_INTERVAL_SECONDS`. Su API oficial con clave solo admite 5 peticiones/hora, así que no sirve aquí.
> El plan gratuito de la Search API de TomTom da 2.500 peticiones **al mes** (~1 cada 18 min), de ahí el `1080` por defecto.

Para encontrar el `REVE_LOCATION_ID`, busca los cargadores de una zona:

```sh
curl -s -X POST 'https://www.mapareve.es/api/public/v1/locations?page=1&per_page=20' \
  -H 'content-type: application/json' \
  -d '{"latitude_ne":38.66,"longitude_ne":-0.53,"latitude_sw":38.60,"longitude_sw":-0.61}'
```

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
npx wrangler secret put TOMTOM_API_KEY      # opcional: respaldo
npx wrangler secret put CHARGER_ID          # opcional: respaldo
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npm run cf:deploy
```

El cron despierta al Worker cada minuto y este hace las consultas que tocan en ese minuto (1 o 2 con 45 s). Logs: `npx wrangler tail`. Probar en local: `npm run cf:test` y abrir
`http://localhost:8787/__scheduled` (las variables en local van en `.dev.vars`, mismo formato que `.env`).

## Opción B — Railway (o cualquier VPS / Raspberry Pi)

1. New Project → Deploy from GitHub repo.
2. Añade las variables en *Variables*. Railway ejecuta `npm start`.
3. Opcional: monta un volumen en `/data` y pon `STATE_FILE=/data/state.json` para no perder el estado entre despliegues.

Es un *worker* sin puerto: no hace falta exponer un dominio.
