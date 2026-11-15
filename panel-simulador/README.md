# carga.uy — Panel simulador de nodos periféricos

Herramienta auxiliar para controlar Tracking y Balanzas y consultar la evidencia
registrada por Central. Se ejecuta con Node.js 24 en la PC, en Linux, macOS
o Windows, para operar los ambientes Local y Elastic Cloud.

## Requisitos

- Node.js 24 y npm.
- Local: Central y los nodos levantados con sus respectivos scripts
  `iniciar.sh`, y Docker disponible desde la terminal del panel.
- Elastic Cloud: acceso a las APIs remotas y cliente OpenSSH disponible.
  El usuario SSH debe tener kubectl configurado en el servidor remoto.

## Preparación

Desde `TSE_NODOS/panel-simulador`, instalar dependencias y crear los archivos
de configuración si todavía no existen. Si ya están configurados, conservarlos.

**Linux/macOS (Bash):**

```bash
npm ci
cp .env.example .env.local
mkdir -p .local
cp profiles.example.json .local/profiles.json
chmod 700 .local
chmod 600 .env.local .local/profiles.json
```

**PowerShell en Windows:**

```powershell
npm ci
Copy-Item .env.example .env.local
New-Item -ItemType Directory -Force .local
Copy-Item profiles.example.json .local/profiles.json
```

Completar el perfil `local` o `elasticcloud` de `.local/profiles.json`:

| Campo | Valor requerido |
|---|---|
| `apiKey` | Clave de la API de funcionarios de Central (`FUNCIONARIOS_API_KEY`) |
| `funcionarioCi` | Cédula de un funcionario autorizado en Central |
| `trackingClientId`, `trackingClientSecret` | Credenciales OAuth de Tracking |
| `balanzasClientId`, `balanzasClientSecret` | Credenciales OAuth de Balanzas |

Revisar las URLs, las guías, las matrículas y los GPS definidos en
`profiles.example.json`. El panel necesita datos compatibles en Central y Nodos.

La configuración se resuelve en este orden: variables de entorno con prefijos
`LOCAL_` o `CLOUD_`, valores del perfil y valores predeterminados.
`.env.local` permite definir esas variables. Por ejemplo,
`LOCAL_COMPOSE_FILE` reemplaza `composeFile` del perfil local.
Las coordenadas se expresan como `[longitud, latitud]`.

## Arranque

Desde la carpeta del panel:

```bash
npm run dev
```

Para ejecutar una compilación de producción:

```bash
npm run build
npm start
```

Abrir http://localhost:3100. El panel escucha en `127.0.0.1` y se abre sin
inicio de sesión. Mantener un único proceso del panel durante la demostración.
Para operar Elastic Cloud no hace falta levantar Central ni Nodos localmente.

## Operación

1. Seleccionar Local o Elastic Cloud y pulsar **Comprobar ambiente**.
2. Resolver las condiciones indicadas por el diagnóstico: credenciales,
   funcionario, guías, GPS, nodos y acceso al poller.
3. Usar **Abrir plataforma** para ingresar al frontoffice de funcionarios.
   Ese acceso requiere el login de testing habilitado en Central.
4. Elegir un escenario o **Ejecutar todos en paralelo**.
5. Consultar el progreso y la evidencia; abrir los viajes o expedientes en Central.
6. Al finalizar, utilizar los controles de parada y restauración.

Tracking debe reportar cada 5 segundos y estar detenido, sin publicaciones
pendientes, antes de comenzar un ensayo. El diagnóstico verifica estas condiciones.
El panel prepara datos en los nodos y verifica resultados producidos por Central;
no crea guías ni casos de fiscalización directamente.

## Escenarios

| Escenario | Comprobación |
|---|---|
| Sin guía | Posiciones de un vehículo sin viaje habilitado para circular |
| Sin habilitación | Caso por documentación no vigente del vehículo |
| Desvío | Posiciones fuera de la ruta autorizada de una guía |
| Exceso de carga | Pesaje de Balanzas incorporado como evidencia en Central |
| Seguimiento normal | Recepción de posiciones de otro viaje en tiempo real |

### Preparar y ejecutar un desvío

Antes de preparar el desvío, completar **Umbral de desvío (m)** con la
separación mínima del recorrido alternativo respecto a la ruta autorizada.
Admite enteros entre 1 y 10000 metros; el valor inicial es 2000.

1. Pulsar **Preparar desvío**. El panel consulta la guía y su ruta autorizada,
   calcula el recorrido vial alternativo mediante OSRM y verifica las fechas.
2. Tracking publica el tramo histórico inicial a 20x y se detiene en el corte.
   El panel comprueba su recepción en Central antes de mostrar **Preparado**.
3. Pulsar **Ejecutar desvío**. El GPS continúa desde el corte con hora actual
   y reportes cada 5 segundos.
4. El panel espera un caso con evidencia nueva. Detectar el caso no detiene
   el GPS: continúa hasta la parada manual o el final del recorrido.

La guía debe tener antigüedad suficiente para cubrir el tramo histórico y no
contar con un caso previo de desvío ni otras guías activas para la matrícula.
Si Tracking se reinicia o cambia el recorrido, hay que preparar nuevamente.

### Ejecución conjunta y seguimiento

**Ejecutar todos en paralelo** utiliza por defecto:

| Vehículo | GPS | Uso |
|---|---|---|
| SBC1234 | 1 | Sin guía y sin habilitación |
| STU5678 | 2 | Desvío de GV-FISC001 y exceso de carga |
| LT00001 | 100001 | Seguimiento normal de GV-LT00001 |

Primero prepara el desvío y después inicia los tres GPS con reloj real.
El pesaje se registra una sola vez y se solicita una ejecución del poller.
Cada GPS tiene su propio control de parada.

También se puede preparar el desvío, iniciar el seguimiento normal y luego
reanudar el desvío mientras ambos GPS reportan. Seguimiento y desvío deben
usar distintas guías, matrículas y GPS.

El seguimiento no cambia el estado de la guía ni registra eventos de la app móvil.
Utiliza la ruta archivada de la guía cuando existe; en caso contrario, usa el
recorrido configurado en `liveOrigin` y `liveDestination`.
El mapa y la visualización de la traza se consultan en Central.

## Poller de Balanzas

El poller pertenece a Central. El panel solicita ejecuciones manuales para
las pruebas; el CronJob remoto conserva su frecuencia de 30 minutos.

| Ambiente | Configuración | Ejecución |
|---|---|---|
| Local | `pollerMode: "docker"` | Contenedor efímero mediante Docker Compose |
| Elastic Cloud | `pollerMode: "ssh"` | Job creado a partir del CronJob remoto |

En Local, `composeFile` debe apuntar al `docker-compose.yml` de TSE_CENTRAL.
La ruta predeterminada es `../../TSE_CENTRAL/docker-compose.yml`, resuelta
desde la carpeta del panel. Si los repositorios están en otras ubicaciones,
configurar `LOCAL_COMPOSE_FILE` o `composeFile`.
WildFly y MongoDB deben estar funcionando; el panel evita otro poller simultáneo.

En Elastic Cloud, configurar `sshHost`, `sshPort`, `sshUser`,
`sshIdentityFile` y `sshKnownHostsFile`. El ejemplo utiliza el gateway
`gate.elasticloud.uy:3022`, namespace `tse` y CronJob
`fiscalizacionautomatica-poller`.
La clave debe estar disponible para el proceso del panel y el gateway registrado
en `known_hosts`. Si la clave tiene passphrase, precargarla en un agente SSH.
El usuario remoto necesita permisos para crear, consultar y eliminar Jobs.

Las rutas relativas se resuelven desde la carpeta del panel.
El acceso al poller es obligatorio para Exceso de carga y la ejecución conjunta.

## Caída y recuperación de Balanzas

Activar **Incluir caída y recuperación de Balanzas** en Exceso de carga
o en la ejecución conjunta. El panel:

1. Registra un único pesaje y conserva su recibo.
2. Provoca respuestas 503 en la API de datos de Balanzas.
3. Solicita un intento del poller y comprueba el rechazo de consultas de pesajes.
4. Tras al menos 30 segundos y al terminar ese intento, recupera Balanzas.
5. Ejecuta nuevamente el poller y verifica la recepción del pesaje original,
   sin volver a registrarlo.

OAuth, health y el control de simulación de Balanzas siguen disponibles.
La interrupción vence automáticamente a los 180 segundos y también se recupera
al cancelar la ejecución que la inició. En la prueba conjunta los GPS continúan
reportando durante la interrupción.

## Parada y recuperación de ejecuciones

Los trabajos continúan en el proceso Node.js aunque se cierre la pestaña.
**Detener todos y restaurar** cancela la sesión y recupera la actividad y
las matrículas originales de los GPS, además de la caída de Balanzas si corresponde.
El recorrido configurado por el ensayo permanece en Tracking y los datos
generados en Central no se eliminan.

El estado se guarda en `.local/state`, configurable mediante `PANEL_STATE_DIR`.
Tras reiniciar el proceso puede ser necesario restaurar la ejecución interrumpida
antes de iniciar otra. No se vuelve a registrar automáticamente un pesaje.

## Pruebas

Desde la carpeta del panel:

```bash
npm test
npm run lint
npm run build
```
