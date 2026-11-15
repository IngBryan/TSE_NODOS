# carga.uy — Simulador de Tracking

Genera posiciones GPS sobre recorridos viales y las publica en RabbitMQ.
Central consume los eventos y realiza la fiscalización. El panel simulador
utiliza la API del nodo para configurar y ejecutar los recorridos.

## Arranque y configuración

El arranque de los nodos se documenta en el [README principal](../README.md).
Para levantar únicamente Tracking, desde la raíz de TSE_NODOS:

```bash
docker compose up -d --build tracking
```

API local: http://localhost:3000. Estado: `/api/health`.
Configurar las siguientes variables en el `.env` de TSE_NODOS:

| Variable | Uso |
|---|---|
| `TRACKING_OAUTH_CLIENT_ID` | Identificador del cliente OAuth |
| `TRACKING_OAUTH_CLIENT_SECRET` | Secreto del cliente OAuth |
| `TRACKING_JWT_SECRET` | Firma de tokens; mínimo 32 caracteres |
| `TRACKING_OAUTH_TOKEN_TTL_SECONDS` | Vigencia del token; 3600 segundos por defecto |
| `RABBITMQ_HOST` | `host.docker.internal` para ejecución local con Docker |
| `RABBITMQ_PORT` | Puerto AMQP; 5672 por defecto |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | Credenciales del broker de Central |
| `TRACKING_INTERVAL_SECONDS` | Intervalo GPS; 5 segundos por defecto |
| `TRACKING_SPEED_KMH` | Velocidad simulada; 80 km/h por defecto |

Tracking comienza desactivado. RabbitMQ debe tener creados el exchange
`tracking`, la cola `tracking.events` y el binding `tracking.event`.
La topología se configura desde Central mediante `rabbitmq/definitions.json`.

## Autenticación

La API utiliza OAuth2 con client credentials. Obtener el token mediante
`POST /api/oauth/token` y enviarlo como `Authorization: Bearer <token>`.
El identificador y secreto del cliente se envían mediante HTTP Basic,
con `grant_type=client_credentials` en el cuerpo del formulario.

`GET /api/health` y `POST /api/oauth/token` son públicos.
Los tokens emitidos por Balanzas no sirven para Tracking.

## API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/gps-devices` | Listar GPS; filtros `active` y `licensePlate` |
| POST | `/api/gps-devices` | Crear un GPS |
| GET | `/api/gps-devices/:id` | Consultar un GPS |
| PUT | `/api/gps-devices/:id` | Modificar un GPS |
| DELETE | `/api/gps-devices/:id` | Baja lógica |
| GET | `/api/tracking-on` | Consultar estado global y publicaciones pendientes |
| PUT | `/api/tracking-on` | Iniciar o detener el tracking global |
| POST | `/api/tracking-on/flush` | Reintentar publicaciones pendientes |
| GET | `/api/gps-devices/:id/scenario` | Consultar configuración y progreso |
| PUT | `/api/gps-devices/:id/scenario` | Configurar el recorrido |
| PUT | `/api/gps-devices/:id/simulation` | Iniciar, reanudar o detener un GPS |

El alta admite un `id` explícito, entero positivo, para utilizar un GPS ya
registrado en Central. Si se omite, se asigna de forma secuencial.
Un identificador existente devuelve 409.

## Configuración de recorridos

Cada GPS activo necesita una configuración mediante
`PUT /api/gps-devices/:id/scenario`:

- `scenario`: `NORMAL_A` o `DESVIO`.
- `authorizedRoutes`: lista con exactamente una geometría GeoJSON `LineString`.
- `deviationRoute`: recorrido vial alternativo; obligatorio para `DESVIO`.
- `deviationThresholdMeters`: umbral ingresado en el panel para `DESVIO`,
  entero entre 1 y 10000 metros.

`NORMAL_A` recorre la ruta autorizada. `DESVIO` recorre la geometría alternativa,
que debe iniciar y terminar cerca del itinerario autorizado y superar,
en algún punto muestreado, el umbral configurado desde el panel.

El [panel simulador](../panel-simulador/README.md) obtiene la ruta de la guía
en Central y calcula el desvío mediante OSRM. El GPS debe corresponder a la
matrícula de esa guía.

## Ejecución

1. Detener el tracking con `PUT /api/tracking-on` y `{"trackingOn":false}`.
2. Verificar `pendingMessages=0` y `flushing=false`. Si hay pendientes,
   ejecutar `POST /api/tracking-on/flush` con RabbitMQ disponible.
3. Configurar el recorrido de cada GPS activo.
4. Iniciar con `PUT /api/tracking-on` y `{"trackingOn":true}`.

El primer evento corresponde al origen. El GPS avanza según la velocidad y el
intervalo configurados; al llegar al destino publica el último punto y se detiene.
Reconfigurar con tracking encendido o publicaciones pendientes devuelve 409.

Para controlar un único GPS, utilizar `PUT /api/gps-devices/:id/simulation`:

```json
{"running":true,"configurationId":"<id de configuración>"}
```

Para detenerlo, enviar `{"running":false}`. Agregar `"resume":true` permite
continuar desde la última posición. Este control funciona en tiempo real y
permite ejecutar varios GPS de forma independiente.
`PUT /api/tracking-on` con `{"trackingOn":false}` detiene todos los GPS.

## Publicación de eventos

Los eventos se publican en el exchange `tracking`, con routing key
`tracking.event`, como JSON persistente:

```json
{
  "id": 4,
  "gpsId": 1,
  "licensePlate": "SBC1234",
  "latitude": -34.6658,
  "longitude": -56.6511,
  "datetime": "2026-10-02T20:50:40.285-03:00"
}
```

La publicación espera confirmación del broker. Ante una falla, los eventos
pendientes se conservan en memoria y se reintentan en orden.
Cada mensaje mantiene su `message_id` UUID entre reintentos; la entrega es
at-least-once. La confirmación indica recepción en RabbitMQ, mientras que el
panel verifica por separado la recepción y el procesamiento en Central.

## Aceleración y preparación del desvío

`PUT /api/tracking-on` admite `simulationSpeedFactor` con valores 1, 5, 10 o 20.
El factor se elige al iniciar una ejecución detenida y sin pendientes.

Con intervalo GPS de 5 segundos y velocidad de 80 km/h:

| Factor | Tiempo real entre publicaciones | Tiempo GPS entre mediciones | Avance por punto |
|---|---|---|---|
| 1x | 5 s | 5 s | 111 m aproximadamente |
| 5x | 1 s | 5 s | 111 m aproximadamente |
| 10x | 0,5 s | 5 s | 111 m aproximadamente |
| 20x | 0,25 s | 5 s | 111 m aproximadamente |

Los factores acelerados utilizan fechas históricas. `simulatedStartAt` informa
el inicio de la ventana, que debe quedar cubierto por la asignación de la guía.
Se rechazan intervalos reales menores a 0,2 segundos.

Para preparar un desvío, el panel usa un único GPS activo y estos campos:

- `configurationId`: identificador del recorrido configurado.
- `stopAtMeters`: punto de corte indicado por el plan de preparación.
- `simulationSpeedFactor: 20`: publicación del tramo histórico.

Al alcanzar el corte, el GPS queda con `pausedAtBoundary=true`.
Después de vaciar los pendientes se puede continuar con `resume:true`,
el mismo `configurationId`, factor 1 y sin `stopAtMeters`.
Se vuelve a publicar la posición del corte con hora actual y continúa el recorrido.

## Datos y reinicios

Los GPS, recorridos, posiciones y publicaciones pendientes se almacenan en
memoria. Al reiniciar el contenedor se restablecen los datos iniciales y hay
que configurar nuevamente los escenarios. Las preparaciones del panel quedan
invalidadas. Ejecutar una sola instancia del simulador.

## Desarrollo y pruebas

Requiere Node.js 24. Para ejecutar fuera de Docker, crear `tracking/.env`
con las variables de RabbitMQ y las credenciales `OAUTH_CLIENT_ID`,
`OAUTH_CLIENT_SECRET` y `JWT_SECRET`, sin prefijo `TRACKING_`.
Opcionalmente, definir `OAUTH_TOKEN_TTL_SECONDS`.
Usar `RABBITMQ_HOST=localhost` para acceder al broker publicado en esta PC.

Desde esta carpeta:

```bash
npm ci
npm run dev
```

Para verificar y compilar:

```bash
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
```
