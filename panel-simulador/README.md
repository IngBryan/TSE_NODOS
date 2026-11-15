# Panel de nodos periféricos

Aplicación Next.js independiente, al mismo nivel que Tracking, Balanzas y PDI. Controla los nodos
por sus APIs y verifica evidencia nueva en Central. No publica GPS directamente en RabbitMQ,
no inserta expedientes y no modifica las reglas del Central. Postman queda como herramienta auxiliar.

## Inicio en Ubuntu y Windows

El mismo panel se ejecuta directamente con Node.js 24 en Ubuntu o Windows. Para el ambiente
**Local**, Central y los nodos deben estar levantados en Docker; en Windows usar Docker Desktop
con contenedores Linux. Para **Elastic Cloud**, se necesita el cliente OpenSSH en el PATH del
proceso del panel; `kubectl` se ejecuta en el servidor remoto, no se instala en Windows.

Desde `TSE_NODOS/panel-simulador`, importar las credenciales de Postman:

```bash
npm ci
npm run import:postman -- --local /ruta/Local/Entorno.postman_environment.json --cloud /ruta/Cloud/Entorno.postman_environment.json
npm run dev
```

En PowerShell, poner entre comillas las rutas de los entornos:

```powershell
cd "C:\ruta\TSE_NODOS\panel-simulador"
npm ci
npm run import:postman -- --local "C:\ruta\Local\Entorno.postman_environment.json" --cloud "C:\ruta\Cloud\Entorno.postman_environment.json"
npm run dev
```

Si `TSE_NODOS` y `TSE_CENTRAL` son carpetas hermanas, la ruta predeterminada de Compose funciona
en ambos sistemas. Si están en otras ubicaciones, configurar `LOCAL_COMPOSE_FILE` en `.env.local`
o `composeFile` en el perfil `local` de `.local/profiles.json`. Una variable de entorno tiene prioridad
sobre el perfil. Todas las rutas relativas se resuelven desde la carpeta del panel, también con
`npm start`; las rutas de Compose y SSH admiten espacios y `~/` para la carpeta del usuario.
En `.env.local` de Windows conviene usar barras `/`, por ejemplo:

```dotenv
LOCAL_COMPOSE_FILE="C:/Mis proyectos/TSE_CENTRAL/docker-compose.yml"
CLOUD_SSH_IDENTITY_FILE="C:/Users/Mi usuario/.ssh/ale_id_ed25519"
CLOUD_SSH_KNOWN_HOSTS_FILE="C:/Users/Mi usuario/.ssh/known_hosts"
```

Para ejecutar una compilación de producción, tanto en Ubuntu como en PowerShell:

```text
npm run build
npm start
```

Abrir http://localhost:3100; el panel local se abre directamente, sin contraseña ni inicio de sesión.
La configuración del panel está en `.env.local` y las claves de TSE y OAuth quedan en
`.local/profiles.json`; ambos archivos están ignorados por Git. En Ubuntu se crean con
permisos 600; en Windows, los permisos efectivos son las ACL de la cuenta que ejecuta el panel.
Guardar los archivos privados en una carpeta accesible sólo a esa cuenta.
La importación no modifica los entornos originales de Postman. Para repetir una importación,
se actualizan las propiedades importadas del perfil elegido; volver a revisar sus ajustes del poller.

Para apuntar a Elastic Cloud no es necesario levantar ningún contenedor local del Central o de nodos.
Sólo debe estar funcionando el panel y ser accesibles los servicios remotos.

## Operación

1. Elegir **Local** o **Elastic Cloud** y pulsar **Comprobar ambiente**.
   **Abrir plataforma** ingresa por `/auth/testing?cedula=...`, usando `funcionarioCi` del perfil.
   Usar ese acceso primero para iniciar sesión; después, los enlaces de viajes abren cada viaje con esa sesión.
   Requiere el login de testing habilitado en Central.
2. Corregir las condiciones que aparezcan: acceso del funcionario, guía, GPS, nodos y cadencia.
3. Elegir un escenario o **Ejecutar todos en paralelo**.
4. El panel muestra progreso, expediente, duración y evidencia. Mantener la plataforma abierta
   para mostrar los resultados. Un expediente existente puede recibir evidencia nueva.
5. **Detener ejecución** solicita cancelación; el servidor termina restaurando los GPS y recuperando
   la interrupción de Balanzas si la inició esta ejecución.
   **Detener y restaurar** también recupera una ejecución interrumpida.

Los trabajos corren en el proceso Node.js de la PC y continúan aunque se cierre o recargue la pestaña. Sólo se
permite una sesión a la vez; la sesión conjunta controla tres GPS de forma independiente. La última ejecución y el snapshot de actividad de los GPS se guardan en disco.
Si el proceso se reinicia, la ejecución se marca interrumpida y, si corresponde, se exige restaurar
antes de iniciar otra. No reintenta automáticamente un pesaje para evitar duplicarlo.

### GPS cada 5 segundos

El diagnóstico exige `intervalSeconds=5`. Tracking usa ahora 5 segundos por defecto; si tiene
`TRACKING_INTERVAL_SECONDS` explícito, poner `5` y recrear ese contenedor. El panel no modifica
el despliegue remoto por su cuenta. Un nodo cloud que aún reporte cada 10 s debe actualizarse.

La velocidad no es configurable desde el panel ni su API. Las ejecuciones en vivo publican cada
5 segundos con el reloj real. Sólo la preparación interna del desvío usa 20x para cargar el tramo
histórico; la continuación vuelve automáticamente al tiempo real.

Los ensayos individuales se ejecutan por separado; el botón conjunto permite tres GPS en paralelo.
La prueba requiere que Tracking esté
detenido y sin pendientes; no apaga silenciosamente una simulación ajena para comenzar otra.
Se restauran **matrícula y actividad**. La API del nodo no entrega la geometría original completa,
por lo que el recorrido configurado por el ensayo permanece en el GPS. Los datos generados en Central
no se eliminan al detener la prueba. Evitar otros operadores y simulaciones superpuestas sobre los mismos GPS.

### Desvío: preparar, mostrar y continuar

1. En la tarjeta Desvío pulsar **Preparar desvío**.
2. El panel consulta la guía existente y su única ruta A por las APIs actuales del Central. Exige que
   no tenga ningún caso de desvío y que no haya otras guías activas para la matrícula. No crea guías,
   no cambia fechas, no recarga seeds y no agrega operaciones al Central.
3. Calcula con OSRM un recorrido por el waypoint. Tracking encuentra el tramo inicial compartido
   con A y fija el corte dejando dos muestras adicionales dentro de A antes de la separación.
   Si no existe un tramo común suficiente, bloquea la preparación.
4. Comprueba que la asignación y el inicio del viaje (si existe) cubran todo ese tramo histórico.
   Si la guía es demasiado reciente, informa la antigüedad necesaria antes de publicar puntos.
5. Tracking publica sólo ese tramo a **20x**: mediciones históricas cada 5 s, publicaciones cada
   250 ms, sin timestamps futuros. Al llegar al corte se detiene automáticamente y conserva posición.
6. El panel verifica todo el tramo en el historial GPS de la guía en Central, incluido el UUID del
   último punto. Sólo entonces muestra **Preparado**. Se puede abrir el viaje para ver su traza.
7. Pulsar **Ejecutar desvío**. Revalida guía, ausencia de caso, hash de A, GPS y configuración.
   Tracking repite la posición del corte con hora actual y continúa desde allí cada 5 s. No vuelve
   al origen ni utiliza el reloj histórico. El intervalo entre preparación y continuación representa una parada.
8. El panel espera un caso nuevo con dos mediciones desviadas posteriores a la continuación.
   Al detectarlo, el GPS sigue reportando hasta la parada manual o el final del recorrido. La demora
   depende del recorrido y del umbral real del Central; no se cambian sus reglas.

### Todos los casos con un botón

**Ejecutar todos en paralelo** comprueba el ambiente y prepara el tramo histórico del desvío con
los otros GPS detenidos. Después inicia tres vehículos con hora real y publicaciones cada 5 s:

| Vehículo | GPS | Comprobaciones |
| --- | --- | --- |
| SBC1234 | 1 | Sin guía y sin habilitación sobre el mismo flujo GPS |
| STU5678 | 2 | Desvío de GV-FISC001 y exceso de carga mediante un pesaje |
| LT00001 | 100001 | Seguimiento normal de GV-LT00001 |

El pesaje se registra una sola vez, después de comprobar que los tres GPS están activos; ejecuta
el poller mientras siguen reportando. Cada caso se valida con evidencia nueva de su vehículo.
No se detiene ningún GPS por detectar un caso. Cada control de parada afecta sólo a su GPS;
**Detener todos y restaurar** finaliza la sesión y restaura su actividad original. Los contadores
separan puntos generados, confirmaciones de RabbitMQ y posiciones recuperadas desde Central.
Un fallo de un GPS o del pesaje queda visible sin detener los otros GPS. Al parar se comprueba
la recepción del último UUID, cuando existe una API de lectura para el viaje o caso correspondiente.

El diagnóstico también verifica que las guías históricas FINALIZADA del vehículo sin guía tengan
un FIN aplicado. Si faltan los eventos históricos de las seeds, Central devuelve NO_DETERMINABLE
y no evalúa sin guía ni habilitación. El panel informa esa condición antes de publicar puntos;
no cambia las guías ni completa datos de Central por su cuenta.

Durante la preparación acelerada se mantiene aislado el GPS del desvío. Después se permite iniciar el GPS de seguimiento y reanudar el desvío mientras éste reporta. Se puede
**Detener y restaurar** para descartarla. El panel guarda la preparación en disco; Tracking mantiene
su posición en memoria. Si Tracking se reinicia o alguien cambia el recorrido, Continuar falla y
restaura los GPS: hay que preparar nuevamente. La recuperación no borra los puntos ya publicados.
Para demostrar otra creación se necesita otra guía sin caso y sin viajes activos superpuestos.

### Seguir un viaje en tiempo real

La sección **Seguir viaje en tiempo real** usa por defecto otra guía y otro vehículo:
`GV-LT00001` / `LT00001`, con GPS 100001. El desvío conserva `GV-FISC001` / `STU5678` / GPS 2.
El panel rechaza compartir guía, matrícula o GPS entre seguimiento y desvío. Ambos GPS pueden reportar juntos a 1x después de preparar el desvío. La preparación a 20x sigue siendo exclusiva.

**Ejecutar viaje de seguimiento** consulta la guía, comprueba sus fechas y ausencia de otros viajes activos
para esa matrícula, guarda la actividad original y habilita únicamente el GPS dedicado. Si no existe en Tracking, lo crea
inactivo con el ID 100001 ya registrado en Central. No reasigna matrículas. Configura
circulación normal y envía mediciones con hora real cada 5 segundos. No cambia el estado de la guía
ni registra un INICIO de la app móvil: una guía semilla ASIGNADA sigue mostrándose como ASIGNADA.

Si la guía tiene una ruta autorizada archivada, usa exactamente esa ruta. Las seeds actuales de
GV-LT00001 no tienen una ruta archivada: en ese caso usa el recorrido vial definido por
`liveOrigin` y `liveDestination`, por defecto Montevideo–Maldonado por la Interbalnearia,
de unos 132 km (aproximadamente 1 h 40 min a 80 km/h). No se presenta ese tramo como
una ruta autorizada guardada en Central ni como el recorrido completo de la guía.

El panel consulta el historial GPS de esa guía por la API de Central y deduplica los UUID para
mostrar únicamente contadores de recepción y última fecha. El mapa y el seguimiento visual se hacen
en Central; el panel ofrece enlaces directos a ambos viajes. No contiene mapa ni tabla de coordenadas.

Orden de la demo concurrente:

1. **Preparar desvío**: publica el tramo previo a 20x y deja su GPS pausado.
2. **Ejecutar viaje de seguimiento**: arranca únicamente LT00001 y conserva la preparación de STU5678.
3. **Ejecutar desvío**: reanuda STU5678 desde el corte sin detener LT00001. Ambos reportan cada 5 s,
   con hora real. Se muestran por GPS los puntos generados, confirmados por RabbitMQ y recibidos en Central.
4. **Detener seguimiento** y **Detener desvío** afectan sólo al GPS indicado. Confirmar el caso no
   detiene el GPS. La preparación también puede descartarse sin reanudarla.
5. **Detener todos y restaurar** cancela la sesión completa. Al acabar ambas partes se restaura la
   actividad original. El estado de los dos controles se guarda en el mismo diario de ejecución;
   tras un reinicio se requiere restauración explícita antes de otra sesión.

Si no se preparó un desvío, el seguimiento sigue funcionando solo. Al llegar al final del tramo,
espera la confirmación del último UUID en Central y termina automáticamente. El seguimiento no
requiere crear un caso; las reglas normales del Central siguen aplicándose. No cambia el estado
ASIGNADA/EN_CURSO ni registra eventos de Mobile.

Para otro dataset configurar `liveGuideId`, `livePlate`, `liveGps`, `liveOrigin` y `liveDestination`
en el perfil, o usar variables `LOCAL_LIVE_GUIDE_ID`, `CLOUD_LIVE_PLATE`, etc. El GPS debe existir
en Tracking y estar registrado como nodo activo en Central; el GPS 100001 de las seeds cumple esa condición.

### Datos del ensayo

El vehículo sin guía usa también Montevideo–Maldonado por defecto, mediante `origin` y
`destination`. Ambos GPS continúan reportando cada 5 segundos después de detectar los casos,
hasta que se los detenga o lleguen al final del recorrido. No hay un límite de 53 puntos.
Si un perfil importado conserva el destino corto anterior `[-56.18,-34.88]`, actualizar
`destination` y, si está definido, `liveDestination` a `[-54.95,-34.9]` para usar el recorrido largo.

Por defecto se usan SBC1234/GPS 1 (sin guía y documentación vencida), STU5678/GPS 2,
GV-FISC001, balanza 4 y 50.000 kg. El waypoint `[-57.817183,-33.5096]` está sobre el
empalme de las rutas 2 y 105, junto al acceso a Palmitas. El desvío sale de Mercedes por
la ruta 2, pasa por ese empalme y continúa por la 105 hacia Dolores y la 21 hacia Nueva
Palmira: unos 121 km. El punto se comprobó sin desplazamiento en OSRM y el recorrido
cumple el tramo inicial compartido y la separación requerida para confirmar el desvío.
Para otro dataset ajustar `waypoint`, `guideId`, matrículas y GPS en el perfil.
La solicitud de recorrido envía las coordenadas a `osrmUrl`, por defecto el servicio público de OSRM.
Puede configurarse un OSRM propio. El GPS sigue una geometría vial; el panel no fabrica posiciones.

El panel busca evidencia posterior al arranque y ausente de la línea base. Sin guía también verifica
posiciones con GPS esperado y UUID de Tracking; desvío valida pareja, umbrales y hashes de la ruta;
carga valida fecha y peso exactos del recibo del nodo Balanzas.

## Configuración

Cada perfil de `.local/profiles.json` (`local` y `elasticcloud`) acepta las propiedades de
`src/lib/types.ts`, interfaz `Profile`. Las credenciales requeridas son `apiKey`, `funcionarioCi`,
`trackingClientId`, `trackingClientSecret`, `balanzasClientId` y `balanzasClientSecret`.
URLs: `centralUrl`, `trackingUrl`, `balanzasUrl`, `platformUrl` y `osrmUrl`.

Cualquier propiedad puede sobreescribirse por variable de entorno con prefijo `LOCAL_` o `CLOUD_`
y nombre en mayúsculas: `centralUrl` → `CLOUD_CENTRAL_URL`; `pollerMode` → `CLOUD_POLLER_MODE`.
Para coordenadas usar JSON `[longitud,latitud]`. Las variables se leen en el servidor en cada ejecución;
no usar `NEXT_PUBLIC_` para secretos. Consultar `.env.example`.

## Poller de carga

### Caída y recuperación de Balanzas

La opción **Incluir caída y recuperación de Balanzas**, marcada inicialmente en la pantalla,
se aplica a **Exceso de carga** y **Ejecutar todos en paralelo**. La API del panel acepta el booleano
`balanzasOutage` para esas dos selecciones; si se omite, mantiene el ensayo habitual sin caída.

1. Registra **un único pesaje** y conserva su recibo (fecha, matrícula y peso).
2. Activa una indisponibilidad en la API de datos de Balanzas: responde **503**, sin borrar sus datos.
   OAuth, control de simulación y `/api/health` (liveness) siguen disponibles. Es un fallo simulado
   de servicio, no un apagado del contenedor ni una prueba de corte de red.
3. Ejecuta un intento del poller habitual de Central. Exige que termine con error y que Balanzas haya
   rechazado consultas de **pesajes**. Un timeout o error de SSH/kubectl no aprueba la prueba.
   Comprueba además que el pesaje todavía no esté en la evidencia de Central.
4. Tras al menos **30 segundos** desde la caída y al terminar ese intento, recupera Balanzas y vuelve
   a ejecutar el poller. Confirma el pesaje original en el expediente, **sin volver a registrarlo**.

En el ensayo conjunto, los tres GPS continúan durante la interrupción. La consulta fallida no avanza
el cursor de Balanzas en Central; el intento siguiente recupera el intervalo pendiente. El panel
provoca ese segundo intento para la demo: no modifica la periodicidad del cron de Central.

Cancelar recupera el nodo. La interrupción tiene además un vencimiento de **180 segundos** si
desaparece el panel, y el diario conserva la restauración pendiente si falla su recuperación.
No se levanta una interrupción activa de otro operador. El Job de Kubernetes usado para el fallo
esperado tiene `backoffLimit=0`, para impedir reintentos que se solapen con la recuperación.

Requiere desplegar la versión actualizada de **Balanzas** y ejecutar el panel actualizado en la PC, además del acceso al poller
descrito abajo. No requiere cambios en Central. Balanzas usa memoria, como el resto de su simulación:
ejecutar con una sola réplica/proceso, igual que su almacén de pesajes.

### Configuración del ejecutor

Se registra el pesaje en la API real de Balanzas y se ejecuta el poller habitual de Central a demanda.
Local usa Docker Compose desde el host; Elastic Cloud crea un Job del CronJob existente mediante SSH.
El cron remoto mantiene su frecuencia de 30 minutos; las consultas a las APIs siguen por HTTP/HTTPS.

Elastic Cloud usa `pollerMode: "ssh"` por defecto y conecta directamente a
`6255-648@gate.elasticloud.uy:3022`, sin los menús del gateway. `sshHost`, `sshPort`, `sshUser`,
`sshIdentityFile` y `sshKnownHostsFile` configuran la conexión desde la PC que ejecuta el panel.
En Node sobre esta PC las rutas por defecto son `~/.ssh/ale_id_ed25519` y `~/.ssh/known_hosts`,
resueltas con el usuario del proceso (en Windows, normalmente `C:/Users/usuario/.ssh/`).
La privada debe ser legible sólo por ese usuario: permisos 600 en Ubuntu y ACL restringidas en Windows.
Nunca copiarla al repositorio ni usar el archivo `.pub` como clave privada. Si tiene passphrase,
precargar la identidad en un agente accesible al proceso: la conexión no admite preguntas interactivas.

Desde una terminal local se puede comprobar el acceso sin crear Jobs:

```bash
ssh -F none -T -o BatchMode=yes -i ~/.ssh/ale_id_ed25519 -p 3022 \
  6255-648@gate.elasticloud.uy \
  'kubectl -n tse get cronjob fiscalizacionautomatica-poller -o name'
```

El usuario remoto debe tener `kubectl` configurado para Central, acceso al CronJob y permisos
`create`, `get`, `list` y `delete` sobre Jobs. Se mantienen namespace `tse`, CronJob
`fiscalizacionautomatica-poller`, comprobación de Jobs activos, espera del resultado y limpieza.
La prueba de caída manda el manifiesto por stdin al comando remoto; un fallo de SSH no cuenta como
fallo esperado del poller. Cada Job tiene límite de actividad y vencimiento posterior, también si se
pierde la conexión. Si falla eliminarlo se informa su nombre para revisar antes de repetir.

El perfil **Local**, ejecutando el panel con Node en el host, usa `pollerMode: "docker"`.
`composeFile` apunta al `docker-compose.yml` de TSE_CENTRAL (también configurable con
`LOCAL_COMPOSE_FILE`). Comprueba WildFly y MongoDB, evita otro poller simultáneo y ejecuta un
contenedor efímero con `--no-deps`; al finalizar o cancelar limpia sólo ese contenedor.
El diagnóstico verifica también que exista el archivo Compose y que incluya el servicio
`fiscalizacionautomatica-poller`, incluso si pertenece al perfil `cron`.
No utiliza conexiones SSH ni URLs de cloud para la prueba local. Tracking debe publicar al RabbitMQ
local y Balanzas debe ser la misma que consulta el Compose del Central.

El poller es parte obligatoria de la demo conjunta y de exceso de carga. Si falta, se conserva el
bloqueo del diagnóstico antes de iniciar los escenarios o registrar pesajes; no se omite ese caso.
Para la demo local usar `npm start` o `npm run dev` en la PC con `LOCAL_POLLER_MODE=docker`.
Si una configuración anterior conserva `pollerMode: "disabled"`, cambiarla a `docker` para Local
o `ssh` para Elastic Cloud; el diagnóstico informa el bloqueo hasta corregirla.
El perfil Elastic Cloud usa SSH para el poller y no requiere Docker en la PC.

SSH utiliza `-F none`, la opción de [OpenSSH](https://man.openbsd.org/ssh#F) para ignorar los archivos
de configuración del host sin depender de `/dev/null`. Las rutas de `known_hosts` se pasan entre
comillas al parser de opciones de SSH; los comandos locales se ejecutan sin shell.

SSH usa verificación estricta del gateway en `known_hosts`; registrar y comprobar previamente su clave
desde una sesión de confianza. Los comandos remotos tienen argumentos fijos y escapados; los logs de
infraestructura no se devuelven al navegador. Se evita iniciar una ejecución cerca del turno de media
hora para no solaparla con el cron; coordinar también con cualquier ejecución externa/manual.

## Ejecución del panel en la PC

El panel se ejecuta con Node.js en Ubuntu o Windows y escucha por defecto en `127.0.0.1:3100`.
Se usa el mismo proceso para controlar cualquiera de los dos ambientes:

| Ambiente | Central y nodos | Ejecución del poller desde el panel |
| --- | --- | --- |
| Local | Docker Compose en la PC | Docker CLI local |
| Elastic Cloud | Kubernetes en Elastic Cloud y nodos en OpenShift | SSH al gateway y Job del CronJob remoto |

El Compose de `TSE_NODOS` levanta Tracking, Balanzas y PDI. El Compose de `TSE_CENTRAL` mantiene
los servicios del Central y `fiscalizacionautomatica-poller` para las pruebas locales.
En Windows se usa Docker Desktop con contenedores Linux para esos componentes.

Mantener un único proceso del panel. Su bloqueo y diario de ejecución se guardan en `.local/state`
(o `PANEL_STATE_DIR`); el proceso Node debe seguir activo durante el ensayo. Las claves y perfiles
permanecen en la PC también al controlar el ambiente cloud. La PC debe poder alcanzar el gateway
en el puerto 3022. Los permisos Kubernetes del poller corresponden al usuario del nodo remoto.
Las mutaciones comprueban el origen de la petición; las credenciales del Central nunca se envían al cliente.

## Validación

```bash
npm test
npm run lint
npm run build
```

Las pruebas levantan APIs HTTP falsas en localhost y ejecutores Docker/SSH de prueba lanzados
con Node, sin shebangs ni permisos ejecutables Unix. Cubren rutas con espacios, arranque standalone,
prioridad de perfiles/variables y cierre de procesos tras timeout o cancelación, además de
los cuatro escenarios, evidencia vieja/futura, correlación exacta, exclusión mutua, cancelación,
timeout, recuperación tras reinicio, fallo de restauración, bloqueo de carga sin poller,
preparación/continuación, guía reciente, confirmación del tramo, configuración obsoleta, seguimiento de otro vehículo y ejecución concurrente con parada por GPS.
No sustituyen el ensayo de integración contra el despliegue real y sus seeds.
