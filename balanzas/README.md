This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## API mock (balanzas y pesajes)

Datos en memoria (`src/lib/store.ts`), con algunos datos semilla. Se pierden al reiniciar.

```ts
Scale         { id, name, latitude, longitude, active }
WeighingEvent { id, scaleId, licensePlate, datetime /* ISO 8601 */, weight /* kg */ }
```

| Metodo   | Ruta                           | Descripcion                                                       |
|----------|--------------------------------|-------------------------------------------------------------------|
| `GET`    | `/api/scales?active=`          | Lista balanzas (filtro opcional `true`/`false`)                   |
| `POST`   | `/api/scales`                  | Alta. `active` por defecto `true`                                 |
| `GET`    | `/api/scales/:id`              | Obtiene una balanza                                               |
| `PUT`    | `/api/scales/:id`              | Modificacion (completa)                                           |
| `DELETE` | `/api/scales/:id`              | Baja logica: pasa a `active: false` y devuelve la balanza. Sus pesajes se conservan |
| `GET`    | `/api/scales/:id/weighings?from=&to=&licensePlate=` | Pesajes de una balanza en un rango de fechas (inclusive, ISO 8601). `from` y `to` obligatorios; `licensePlate` opcional. Tambien para balanzas dadas de baja |

Errores: `{ "error": string, "details"?: string[] }` con `400`, `401` o `404`.

### Autenticacion (OAuth 2.0 client credentials)

Todos los endpoints de `/api` requieren `Authorization: Bearer <token>`, salvo
`GET /api/health` y `POST /api/oauth/token`. La validacion la hace `src/proxy.ts`
(en Next 16 `middleware.ts` se renombro a `proxy.ts`). Los tokens son JWT HS256 emitidos
por el propio mock.

#### Variables de entorno (obligatorias)

No hay valores por defecto: si falta alguna, los endpoints protegidos y el de token
responden `500` y el log indica cual falta.

| Variable                  | Obligatoria | Descripcion                                          |
|---------------------------|-------------|------------------------------------------------------|
| `OAUTH_CLIENT_ID`         | Si          | `client_id` aceptado (ej. `componente-central`)      |
| `OAUTH_CLIENT_SECRET`     | Si          | `client_secret` del cliente                          |
| `JWT_SECRET`              | Si          | Clave para firmar los JWT (minimo 32 caracteres)     |
| `OAUTH_TOKEN_TTL_SECONDS` | No          | Vida del token en segundos (por defecto `3600`)      |

**Desarrollo (docker compose):** en el `.env` de la raiz del repo (`TSE_NODOS/.env`) estas
variables van con prefijo `BALANZAS_` (`BALANZAS_OAUTH_CLIENT_ID`, `BALANZAS_JWT_SECRET`, ...)
y el `docker-compose.yml` las mapea a los nombres de la tabla. Ver el README de la raiz.

> Si se corre `npm run dev` directamente dentro de `balanzas/` (fuera de Docker), Next solo
> lee los `.env` de esa carpeta: crear `balanzas/.env` con los nombres **sin** prefijo.

**Produccion:** definirlas como variables de entorno del servidor donde se ejecuta
`docker compose` (con prefijo) o directamente del contenedor (sin prefijo).

#### Uso

1. Obtener un token (credenciales por HTTP Basic, o `client_id`/`client_secret` en el body;
   acepta `application/x-www-form-urlencoded` o JSON):

```bash
curl -X POST localhost:3001/api/oauth/token \
  -u "<BALANZAS_OAUTH_CLIENT_ID>:<BALANZAS_OAUTH_CLIENT_SECRET>" \
  -d grant_type=client_credentials
# { "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }
```

2. Usarlo, por ejemplo para obtener los pesajes de un vehiculo en la balanza 1 en una fecha:

```bash
curl "localhost:3001/api/scales/1/weighings?licensePlate=SBC1234&from=2026-09-29T00:00:00Z&to=2026-09-29T23:59:59Z" \
  -H "Authorization: Bearer <access_token>"
```

Errores del token endpoint segun RFC 6749: `{ "error": "invalid_client" | "invalid_request" | "unsupported_grant_type", "error_description": string }`.

### Indisponibilidad controlada para demostraciones

`GET /api/simulation/availability` consulta el estado y `PUT` recibe
`{ "outageId": "identificador-de-ejecucion", "durationSeconds": 180 }` para activar una caída
de hasta 180 segundos. Ambos requieren el mismo OAuth que la API de Balanzas. `durationSeconds: 0`
recupera la caída del mismo identificador; otra ejecución no puede levantarla ni reemplazarla.
Repetir una activación con el mismo identificador no prolonga el vencimiento.

Durante la caída, todos los métodos de `/api/scales` y sus subrutas responden **503** con
`Retry-After` y sin caché. No se borran ni se generan pesajes. OAuth, el control y `/api/health`
continúan operativos: se simula indisponibilidad del servicio de datos, no una caída del proceso.
El estado contabiliza las peticiones rechazadas y las consultas GET de pesajes rechazadas, para
comprobar que el poller realmente intentó consultarlas. Al vencer el plazo se recupera automáticamente.

El panel registra un pesaje, provoca esta caída, ejecuta un poll fallido y otro tras recuperarlo,
y verifica el recibo original en Central sin reenviarlo. El estado de caída es en memoria, igual
que los pesajes: usar una sola réplica/proceso del simulador.
