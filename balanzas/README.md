# carga.uy — Simulador de Balanzas

Ofrece una API REST de balanzas y pesajes que consulta el poller de Central.
El panel simulador permite registrar pesajes y provocar indisponibilidad
para comprobar la recuperación de las consultas.

## Arranque y configuración

El arranque completo de los nodos se documenta en el [README principal](../README.md).
Para levantar únicamente Balanzas, desde la raíz de TSE_NODOS:

```bash
docker compose up -d --build balanzas
```

API local: http://localhost:3001. Estado: `/api/health`.
En el `.env` de TSE_NODOS configurar `BALANZAS_OAUTH_CLIENT_ID`,
`BALANZAS_OAUTH_CLIENT_SECRET` y `BALANZAS_JWT_SECRET` (mínimo 32 caracteres).
El cliente OAuth debe coincidir con el utilizado por Central y el panel.
`BALANZAS_OAUTH_TOKEN_TTL_SECONDS` vale 3600 por defecto.

Para desarrollo sin Docker, usar Node.js 24 y ejecutar `npm ci` y `npm run dev`
desde esta carpeta. El servidor de desarrollo usa el puerto 3000.
Crear `balanzas/.env` con `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` y `JWT_SECRET`,
sin prefijo `BALANZAS_`; opcionalmente, `OAUTH_TOKEN_TTL_SECONDS`.

## Autenticación

OAuth2 mediante client credentials. Obtener un token con `POST /api/oauth/token`
y enviarlo como `Authorization: Bearer <token>` en las llamadas protegidas.
`/api/health` y `/api/oauth/token` no requieren Bearer.

Ejemplo para Bash; desde PowerShell usar `curl.exe` en una sola línea:

```bash
curl -X POST http://localhost:3001/api/oauth/token \
  -u "<client_id>:<client_secret>" \
  -d grant_type=client_credentials
```

## API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/scales` | Listar; filtro opcional `active=true/false` |
| POST | `/api/scales` | Crear una balanza |
| GET | `/api/scales/:id` | Consultar una balanza |
| PUT | `/api/scales/:id` | Modificar una balanza |
| DELETE | `/api/scales/:id` | Baja lógica; conserva los pesajes |
| GET | `/api/scales/:id/weighings` | Consultar pesajes |
| POST | `/api/scales/:id/weighings` | Registrar un pesaje para demostración |
| GET | `/api/simulation/availability` | Consultar la indisponibilidad simulada |
| PUT | `/api/simulation/availability` | Activar o recuperar una indisponibilidad |

La consulta de pesajes exige `from` y `to` en ISO 8601, con extremos incluidos.
`licensePlate` permite filtrar por matrícula. También admite balanzas dadas de baja.
Cada pesaje incluye `id`, `scaleId`, `licensePlate`, `datetime` y `weight` en kg.

Para registrar un pesaje, enviar a una balanza activa:

```json
{"licensePlate":"STU5678","weight":50000}
```

El nodo genera la fecha y devuelve el recibo con HTTP 201. `weight` debe ser
un entero positivo; la matrícula normalizada debe tener entre 6 y 8 caracteres
alfanuméricos. El panel usa el recibo para comprobar esa evidencia en Central.

Los errores de la API incluyen `error` y, cuando corresponde, `details`.
Se utilizan 400 por datos inválidos, 401 por autenticación, 404 por recurso
inexistente, 409 por conflictos y 503 durante la indisponibilidad simulada.
El endpoint OAuth devuelve los errores `invalid_client`, `invalid_request`
o `unsupported_grant_type` según corresponda.

## Caída y recuperación

Enviar a `PUT /api/simulation/availability`:

```json
{"outageId":"demo-carga-1","durationSeconds":180}
```

Durante la caída, `/api/scales` y sus subrutas responden 503 con `Retry-After`.
OAuth, health y el control de simulación siguen disponibles. Los datos permanecen
intactos: es una indisponibilidad de la API de datos, no un apagado del proceso.

Para recuperar anticipadamente, enviar el mismo `outageId` y `durationSeconds: 0`.
Otra ejecución no puede recuperar esa caída. Repetir la activación no prolonga
su vencimiento. La duración máxima es de 180 segundos.

El panel registra un pesaje, comprueba un intento fallido del poller y, tras la
recuperación, verifica que Central reciba el pesaje original sin volver a crearlo.
El cron de Central conserva su periodicidad.

## Datos y pruebas

Las balanzas, los pesajes y las fallas simuladas se almacenan en memoria.
Al reiniciar se restablecen los datos iniciales. Usar una sola instancia del simulador.

Desde esta carpeta:

```bash
npm ci
npm test
npm run lint
npm run build
```
