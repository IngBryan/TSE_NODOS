# TSE Nodos

Nodos perifericos del laboratorio. Son componentes standalone (Next.js y Spring Boot) que se despliegan
**aparte** del componente central (`TSE_CENTRAL`) y se comunican con el.

```
TSE_NODOS/
├── tracking/            # Mock de GPS: publica posiciones en el RabbitMQ del componente central
├── balanzas/            # Mock de balanzas: API consumida por el componente central (OAuth2)
├── panel-simulador/     # Panel Next.js: coordina escenarios GPS/carga y verifica evidencia
├── pdi-service/         # PDI simulada (Servicio de Informacion DNIC, SOAP, Spring Boot)
├── docker-compose.yml   # Levanta tracking, balanzas y pdi
└── .env                 # Credenciales (ignorado por git)
```

Cada app tiene su propio README con la API y las variables de entorno. `tracking` y `balanzas` exponen
`GET /api/health`; `pdi` expone `GET /actuator/health`.

## Docker

```bash
docker compose up --build
```

| Servicio   | URL                   |
|------------|------------------------|
| `tracking` | http://localhost:3000  |
| `balanzas` | http://localhost:3001  |
| `pdi`      | http://localhost:3005  |

### Variables de entorno (`TSE_NODOS/.env`)

Cada variable lleva el prefijo del servicio y el compose la mapea al nombre que lee la app
(ej. `BALANZAS_JWT_SECRET` → `JWT_SECRET` en el contenedor de `balanzas`).

```bash
#Balanzas
BALANZAS_OAUTH_CLIENT_ID=componente-central
BALANZAS_OAUTH_CLIENT_SECRET=<un-secreto>
BALANZAS_JWT_SECRET=<minimo-32-caracteres>
BALANZAS_OAUTH_TOKEN_TTL_SECONDS=3600

#Tracking
TRACKING_OAUTH_CLIENT_ID=tracking-admin
TRACKING_OAUTH_CLIENT_SECRET=<otro-secreto>
TRACKING_JWT_SECRET=<otro-minimo-32-caracteres>
TRACKING_OAUTH_TOKEN_TTL_SECONDS=3600
#TRACKING_INTERVAL_SECONDS=5   # opcional: cada cuanto reporta cada GPS
#TRACKING_SPEED_KMH=80         # opcional: velocidad simulada sobre geometria real

#RabbitMQ del componente central (credenciales con las que tracking publica)
RABBITMQ_USER=<mismo-que-en-TSE_CENTRAL>
RABBITMQ_PASSWORD=<mismo-que-en-TSE_CENTRAL>
#RABBITMQ_HOST=host.docker.internal   # opcional: donde corre el componente central
#RABBITMQ_PORT=5672                   # opcional

#PDI (las lee la app con este mismo nombre, sin remapeo)
PDI_ADMIN_USER=admin
PDI_ADMIN_PASSWORD=<un-secreto>                      # obligatorio: sin esto el contenedor pdi no arranca
PDI_ORGANISMO_CODIGO=MTOP-CARGA                      # usuario del wsse:UsernameToken que manda el central
PDI_ORGANISMO_CLAVE=<minimo-12-caracteres>          # password (PasswordText) del UsernameToken
#PDI_ORGANISMO_NOMBRE=MTOP - carga.uy               # opcional
#PDI_SIMULACION_MODO=NORMAL                         # opcional: NORMAL | LENTO | CAIDO
#PDI_SIMULACION_LATENCIA_MS=0                       # opcional (modo LENTO)
#PDI_WSS_TIMESTAMP_TTL_SEGUNDOS=300                 # opcional: vigencia máxima del wsu:Timestamp
```

Usar secretos distintos por servicio. Los valores se inyectan al crear el contenedor: si se
cambian, correr `docker compose up -d` (no alcanza con `restart`).

### Conexion con el componente central

`tracking` no comparte compose ni red con `TSE_CENTRAL`: llega al RabbitMQ del central por
red, igual que lo haria un nodo remoto. `RABBITMQ_HOST` por defecto es `host.docker.internal`
(el puerto `5672` que publica el compose de `TSE_CENTRAL` en la misma maquina). Para apuntar
a otra maquina, definir `RABBITMQ_HOST` en el `.env`.

- `RABBITMQ_USER` / `RABBITMQ_PASSWORD` deben coincidir con los del `.env` de `TSE_CENTRAL`.
- No hay `depends_on`: tracking puede arrancar antes que RabbitMQ; la publicacion reintenta
  en orden hasta que el broker este disponible.

## Requisitos

- Node.js 24 / npm (para desarrollo local)
- Docker + Docker Compose

## Panel operativo de demostración

Aplicación independiente en [`panel-simulador/`](panel-simulador/README.md), junto a Tracking,
Balanzas y PDI. Permite ejecutar los cuatro escenarios, comprobar el ambiente, inspeccionar evidencia
nueva y detener/restaurar GPS. Puede correr con Node en la PC o como contenedor en cloud.
Las credenciales sólo se usan en el servidor. El panel no crea casos directamente en Central.

El servicio Compose está en el perfil `demo`: `docker compose --profile demo up --build -d panel-simulador`.
Preparar antes su configuración privada como indica el README. El poller cloud se ejecuta a demanda
por SSH al nodo del Central; la privada y `known_hosts` se leen en el servidor del panel.
Tracking mide cada **5 segundos** por defecto; un despliegue con una variable explícita distinta
necesita actualizarla y recrear su contenedor.
