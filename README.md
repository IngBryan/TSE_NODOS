# carga.uy — Nodos periféricos

Simuladores de Tracking, Balanzas y PDI de carga.uy, ejecutados
por separado del componente central.

- Tracking publica posiciones GPS en el RabbitMQ de Central.
- Balanzas ofrece consultas de pesajes mediante REST y OAuth2.
- PDI simula el servicio DNIC mediante SOAP y WS-Security.

## Requisitos y configuración

- Docker con Docker Compose 2.30 o superior.
- En Windows: Docker Desktop iniciado con contenedores Linux y
  Git for Windows instalado.
- En Linux/macOS: Bash y Docker iniciado.

Antes del primer arranque, copiar `.env.example` a `.env` y completar
los valores vacíos siguiendo los comentarios de la plantilla.

Parámetros principales:

- `RABBITMQ_USER` y `RABBITMQ_PASSWORD`: mismos valores que en Central.
  Conservar `RABBITMQ_HOST=host.docker.internal` para ejecución local.
- `BALANZAS_OAUTH_CLIENT_ID` y `BALANZAS_OAUTH_CLIENT_SECRET`:
  deben coincidir con las credenciales de Balanzas usadas por Central.
- `TRACKING_OAUTH_CLIENT_ID` y `TRACKING_OAUTH_CLIENT_SECRET`:
  credenciales para administrar el simulador GPS.
- `BALANZAS_JWT_SECRET` y `TRACKING_JWT_SECRET`: claves distintas,
  de al menos 32 caracteres.
- `PDI_ORGANISMO_CODIGO` y `PDI_ORGANISMO_CLAVE`: mismos valores
  que en Central; la clave debe tener al menos 12 caracteres.
- `PDI_ADMIN_PASSWORD`: contraseña administrativa de la PDI.

## Arranque local

Desde la raíz de este repositorio:

**Linux/macOS o Git Bash en Windows:**

```bash
bash iniciar.sh
```

**PowerShell en Windows**, con Git instalado en su ubicación habitual:

```powershell
& "C:\Program Files\Git\bin\bash.exe" ./iniciar.sh
```

El script compila las imágenes y levanta únicamente Tracking, Balanzas y PDI.

| Servicio | Verificación de estado |
|---|---|
| Tracking | http://localhost:3000/api/health |
| Balanzas | http://localhost:3001/api/health |
| PDI | http://localhost:3005/actuator/health |

## Opciones y demostración

Tracking comienza desactivado y se habilita mediante su API o el panel.
`TRACKING_INTERVAL_SECONDS` define el intervalo GPS: 5 segundos por defecto.
`PDI_SIMULACION_MODO` admite `NORMAL`, `LENTO` y `CAIDO`.

El [panel simulador](panel-simulador/README.md) es una herramienta auxiliar.
Se inicia aparte con Node.js 24 y configuración propia. Permite preparar
escenarios, simular fallas y solicitar ejecuciones manuales del poller
de Balanzas de Central.

Los datos de los simuladores se almacenan en memoria y se restablecen
al reiniciar.

Estado: `docker compose ps`. Logs: `docker compose logs -f`.
Detener los nodos: `docker compose down`.

Contratos y opciones: [Tracking](tracking/README.md),
[Balanzas](balanzas/README.md) y [PDI](pdi-service/README.md).
