This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## API mock (GPS y tracking)

API **interna** del nodo de tracking: el componente central no la consume. El nodo publica
los eventos de tracking en RabbitMQ, de donde los toma el componente central (no hay
comunicacion directa entre ambos; ver la seccion RabbitMQ del README de `TSE_CENTRAL`).

Datos en memoria (`src/lib/store.ts`), con algunos datos semilla. Se pierden al reiniciar.

```ts
GpsDevice     { id, licensePlate /* vehiculo */, active }
TrackingEvent { id, gpsId, latitude, longitude, datetime /* ISO 8601 en hora de Uruguay (-03:00) */ }  // sin endpoints, se publican a RabbitMQ
```

| Metodo   | Ruta                     | Descripcion                                                        |
|----------|--------------------------|--------------------------------------------------------------------|
| `GET`    | `/api/gps-devices`       | Lista GPS. Filtros opcionales: `active=true\|false`, `licensePlate` |
| `POST`   | `/api/gps-devices`       | Alta. `active` por defecto `true`                                  |
| `GET`    | `/api/gps-devices/:id`   | Obtiene un GPS                                                     |
| `PUT`    | `/api/gps-devices/:id`   | Modificacion (completa)                                            |
| `DELETE` | `/api/gps-devices/:id`   | Baja logica: pasa a `active: false` y devuelve el GPS              |
| `GET`    | `/api/tracking-on`       | Estado global del tracking: `{ "trackingOn": boolean }` (por defecto `false`) |
| `PUT`    | `/api/tracking-on`       | Arranca o detiene la simulacion vial: `{ "trackingOn": true }`  |
| `POST`   | `/api/tracking-on/flush` | Reintenta mensajes pendientes sin generar nuevas posiciones      |
| `GET`    | `/api/gps-devices/:id/scenario` | Escenario configurado y progreso                       |
| `PUT`    | `/api/gps-devices/:id/scenario` | Configura un recorrido vial real para un dispositivo  |

### Publicacion de eventos (`tracking_on`)

`tracking_on` arranca en `false` y vuelve a `false` al reiniciar. Mientras esta en `true`, cada
`TRACKING_INTERVAL_SECONDS` (10 por defecto) cada GPS **activo** y configurado reporta una posicion simulada
(interpolada sobre su recorrido vial) y el evento se publica en el exchange `tracking`
con routing key `tracking.event` (`src/lib/tracking.ts`, `src/lib/rabbitmq.ts`).

```json
{ "id": 4, "gpsId": 1, "licensePlate": "SBC1234", "latitude": -34.6658, "longitude": -56.6511, "datetime": "2026-10-02T20:50:40.285-03:00" }
```

- La app **no declara** exchange ni cola: la topologia la define RabbitMQ
  (`rabbitmq/definitions.json`). Los nombres en `src/lib/rabbitmq.ts` deben coincidir.
- Cada mensaje se publica con confirmacion del broker. Si RabbitMQ no esta disponible, los
  eventos quedan pendientes en memoria y se reintentan en orden en el siguiente intervalo
  (se loguea `[tracking] could not publish to RabbitMQ (N event(s) pending)`); si el contenedor
  de tracking se reinicia, los pendientes se pierden.
- Entrega *at-least-once*: cada evento tiene un `message_id` fijo entre reintentos para que el
  consumidor descarte duplicados.

Errores: `{ "error": string, "details"?: string[] }` con `400`, `401` o `404`.

### Autenticacion (OAuth 2.0 client credentials)

Igual que en `balanzas`: todos los endpoints de `/api` requieren
`Authorization: Bearer <token>`, salvo `GET /api/health` y `POST /api/oauth/token`.
La validacion la hace `src/proxy.ts`. Los tokens son JWT HS256 emitidos por el propio mock
(`iss: tracking`, `aud: tracking-api`), asi que un token de `balanzas` no sirve aca.

| Variable                  | Obligatoria | Descripcion                                          |
|---------------------------|-------------|------------------------------------------------------|
| `OAUTH_CLIENT_ID`         | Si          | `client_id` aceptado                                 |
| `OAUTH_CLIENT_SECRET`     | Si          | `client_secret` del cliente                          |
| `JWT_SECRET`              | Si          | Clave para firmar los JWT (minimo 32 caracteres)     |
| `OAUTH_TOKEN_TTL_SECONDS` | No          | Vida del token en segundos (por defecto `3600`)      |
| `RABBITMQ_HOST`           | Si*         | Host de RabbitMQ (por defecto `host.docker.internal`)         |
| `RABBITMQ_PORT`           | No          | Puerto AMQP (por defecto `5672`)                     |
| `RABBITMQ_USER`           | Si*         | Usuario de RabbitMQ                                  |
| `RABBITMQ_PASSWORD`       | Si*         | Contrasena de RabbitMQ                               |
| `TRACKING_INTERVAL_SECONDS` | No        | Cada cuanto reporta cada GPS (por defecto `10`)      |
| `TRACKING_SPEED_KMH` | No | Velocidad simulada (80 km/h por defecto) |

\* Necesarias para encender el tracking: sin ellas `PUT /api/tracking-on` con `true` responde `500`.

**Desarrollo (docker compose):** en `TSE_NODOS/.env` las de OAuth van con prefijo `TRACKING_`
(`TRACKING_OAUTH_CLIENT_ID`, `TRACKING_JWT_SECRET`, ...); las de RabbitMQ son
`RABBITMQ_USER` / `RABBITMQ_PASSWORD` (las mismas que usa el RabbitMQ de `TSE_CENTRAL`) y el host
se define con `RABBITMQ_HOST` (por defecto `host.docker.internal`). Ver el README de la raiz.

> Si se corre `npm run dev` dentro de `tracking/` (fuera de Docker), crear `tracking/.env`
> con los nombres **sin** prefijo.

```bash
# 1. Token
curl -X POST localhost:3000/api/oauth/token \
  -u "<TRACKING_OAUTH_CLIENT_ID>:<TRACKING_OAUTH_CLIENT_SECRET>" \
  -d grant_type=client_credentials

# 2. Encender el tracking
curl -X PUT localhost:3000/api/tracking-on \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"trackingOn": true}'
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


### Tarea 3D — Escenarios viales por GPS

**No se usan puntos inventados ni se modifica el mensaje RabbitMQ.** Un administrador
configura, para cada GPS activo, las mismas geometrias GeoJSON `LineString`
que quedaron asociadas a una Guia en PostgreSQL mediante OSRM. El simulador
recorre cada polilinea por **distancia recorrida** a velocidad simulada constante.

- `NORMAL_A`: primera ruta autorizada.
- `NORMAL_B`: segunda ruta autorizada; se rechaza cuando OSRM solo proporciono una.
- `DESVIO`: ruta *vial* calculada con OSRM pasando por un waypoint fuera del corredor.
  La configuracion se rechaza si el desvio no se aleja al menos 2 km de **todas**
  las rutas autorizadas en algun punto muestreado. Esa comprobacion es un filtro de
  escenario, no la regla de fiscalizacion ni una garantia de que haya dos muestras
  de mas de 2 km dentro de 30 segundos.

**El simulador no decide infracciones** y no envia campos como `scenario` ni
`desviado` a RabbitMQ. Los eventos publicados mantienen exactamente
`id`, `gpsId`, `licensePlate`, `latitude`, `longitude` y `datetime`.

#### Importar rutas desde el Central (recomendado)

La API protegida del Central es
`GET /frontofficefuncionarios-web/api/viajes/{idGuia}/rutas-autorizadas`.
Para el GPS que tiene la misma matricula que esa Guia, ejecuta desde `tracking/`:

```bash
# Adquirir un token OAuth del nodo Tracking como indica la seccion anterior.
export TRACKING_TOKEN='<token de tracking>'
export CENTRAL_API_KEY='<api key de funcionarios>'
export CENTRAL_FUNCIONARIO_CI='<cedula de un funcionario autorizado>'
export GUIA_ID='<id de una Guia con rutas ya generadas>'
export GPS_ID=2
export TRACKING_SCENARIO=NORMAL_A
node scripts/configure-from-central.mjs

# Solo si hay dos alternativas autorizadas:
export TRACKING_SCENARIO=NORMAL_B
node scripts/configure-from-central.mjs

# Genera un nuevo camino vial con OSRM que pase por un punto alejado de
# todas las rutas autorizadas, sin tocar el catalogo PostgreSQL.
export TRACKING_SCENARIO=DESVIO
export DESVIO_WAYPOINT='<longitud,latitud de una via alternativa>'
node scripts/configure-from-central.mjs
```

Se pueden definir `CENTRAL_BASE_URL` (por defecto
`http://localhost:8080/frontofficefuncionarios-web/api`), `TRACKING_URL`
(por defecto `http://localhost:3000`) y `OSRM_BASE_URL` (por defecto
`https://router.project-osrm.org`). La utilidad se ejecuta **fuera del
contenedor**, con credenciales de funcionario suministradas al proceso una vez;
no las almacena en el servidor del nodo ni en su configuracion Docker.
El servicio publico de OSRM no debe usarse para pruebas intensivas: configurar
una instancia propia para una carga sostenida.

Alternativamente, se puede invocar el endpoint de configuracion manualmente:

```http
PUT /api/gps-devices/2/scenario
Authorization: Bearer <token>
Content-Type: application/json

{
  "scenario": "NORMAL_A",
  "authorizedRoutes": [
    { "type": "LineString", "coordinates": [[-58.0,-33.0], [-58.1,-33.2]] }
  ]
}
```

El JSON anterior es **esquematico** y NO describe una ruta vial verificada.
En ejecucion deben utilizarse las coordenadas reales devueltas por OSRM y
persistidas en el Central.

**Operativa y seguridad:**

1. Detener tracking: `PUT /api/tracking-on` con `{"trackingOn":false}`.
2. Comprobar `GET /api/tracking-on`: `pendingMessages=0` y `flushing=false`.
   Si hay pendientes, ejecutar `POST /api/tracking-on/flush` con RabbitMQ disponible.
3. Configurar cada dispositivo **activo** con su propio escenario, ligado a la
   Guia de la misma matricula. Si un GPS activo carece de configuracion,
   el arranque responde `409`.
4. Arrancar tracking con `{"trackingOn":true}`. En la primera publicacion se
   emite el origen; en las siguientes avanza `TRACKING_SPEED_KMH` por intervalo.
   Al llegar al destino publica el ultimo punto **una sola vez** y termina
   para ese dispositivo, sin teletransportarse al origen.
5. Para cambiar rutas o reiniciar una simulacion, detener y dejar la cola
   local vacia. La configuracion se rechaza (`409`) si tracking esta encendido
   o hay publicaciones pendientes/en curso. `messageId` permanece estable ante
   reintentos y las confirmaciones del broker se conservan.
6. **La confirmacion RabbitMQ no garantiza procesamiento en el Central.**
   Antes de comenzar otro ensayo, verificar que el consumidor proceso los
   mensajes anteriores. No se borra la cola del broker automaticamente.

Los datos y las configuraciones son **en memoria**, igual que la implementacion
original de `TSE_NODOS`. Al reiniciar el contenedor se pierden configuraciones
GPS y publicaciones pendientes no confirmadas. Este servicio asume una sola
instancia (no escalar replicas independientes del simulador).

#### Gates del nodo Tracking

```bash
cd tracking
npm ci
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
```

Para demostrar el flujo completo falta una prueba integrada con RabbitMQ,
MongoDB, WildFly y una Guia real cuyas rutas se hayan generado mediante OSRM.
