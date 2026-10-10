# pdi-service — PDI simulada (Servicio de Información DNIC)

Simula el Servicio de Información de DNIC que consume carga.uy por la PDI (CU-03 y CU-04). Todo es SOAP.

| Servicio | Endpoint | WSDL | Seguridad |
|---|---|---|---|
| DNIC (contrato original) | `POST /ws/servicioInformacion` | `/ws/servicioInformacion.wsdl` | WS-Addressing + WS-Security (ver abajo) |
| Administración | `POST /ws/admin` | `/ws/admin.wsdl` | HTTP Basic (`PDI_ADMIN_USER` / `PDI_ADMIN_PASSWORD`) |

Observabilidad: `/actuator/health`, `/actuator/prometheus` (métrica `pdi_consultas_total{resultado}`), logs JSON (ECS) con `correlationId` tomado del header `X-Correlation-Id`.

## Levantar

Con Docker se levanta desde el `docker-compose.yml` de la raíz de `TSE_NODOS` (servicio `pdi`, en `http://localhost:3002`), junto con los demás nodos. Las variables `PDI_*` se definen en el `.env` de la raíz o las pasa el CI/CD (ver el README de la raíz).

```bash
cd ..
docker compose up --build pdi
```

Local sin Docker: Java 21 y `./mvnw spring-boot:run` (con las variables de `.env.example` exportadas). Tests: `./mvnw verify`.

Base de datos: H2 en memoria (`jdbc:h2:mem:pdi`), no hace falta levantar nada aparte. Los datos se pierden al reiniciar: Flyway vuelve a crear el esquema y las personas de prueba. Se puede cambiar con `PDI_DB_URL` (p. ej. `jdbc:h2:file:./data/pdi` para persistir en disco).

## WS-Addressing y WS-Security (servicio DNIC)

Todo request DNIC debe traer en el `soapenv:Header`:

- **WS-Addressing 1.0** (`http://www.w3.org/2005/08/addressing`): `wsa:Action` (`http://wsServicioDeInformacion/obtDocDigitalizado` o `.../ProductDesc`), `wsa:MessageID` (p. ej. `urn:uuid:...`) y `wsa:To`. La respuesta trae `wsa:Action` (`...Response`), su propio `wsa:MessageID` y `wsa:RelatesTo` = el MessageID del request. El MessageID se loguea como `wsaMessageId`.
- **WS-Security** (`wsse:Security`): `wsu:Timestamp` vigente (máx. `PDI_WSS_TIMESTAMP_TTL_SEGUNDOS`, 300 por defecto) y `wsse:UsernameToken` con Username = código del organismo y Password tipo **PasswordText** = su clave (se compara contra el hash BCrypt; PasswordDigest no se admite). La confidencialidad de la clave la da HTTPS.

Si falta algo, se responde un SOAP Fault: `WS-Addressing requerido...`, `No WS-Security header found`, `The security token could not be authenticated or authorized`, `Invalid timestamp...`.

Los campos `Organismo` y `ClaveAcceso1` del Body siguen en el WSDL (es el contrato DNIC) pero **se ignoran**: el organismo que se registra en la consulta es el del UsernameToken.

En SoapUI: pestaña **WS-A** → *Enable WS-A addressing*, *Add default wsa:Action*, *Generate MessageID*; en **Auth** (o *Outgoing WS-Security Configurations* del proyecto) → Username + Password, tipo *PasswordText*, y agregar un Timestamp.

## obtDocDigitalizado

- Se completan solo `Nombre1`, `Nombre2`, `primerApellido`, `segundoApellido`, `FechaNacimiento` (`yyyy-MM-dd`), `sexo`, `CodNacionalidad`, `NombreEnCedula`, `NroDocumento` y `CodTipoDocumento` (`DO`). `Imagenes` va vacío.
- `Nrodocumento` acepta `12345678` o `1.234.567-8`. `TipoDocumento` vacío o `DO`.
- `idSolicitud` se devuelve tal cual; `idRespuesta` es el id del registro de la consulta.
- La edad **no** se calcula acá: la calcula el componente central.

Errores (en `Errores/Mensaje/CodMensaje`, respuesta HTTP 200):

| Código | Significado | CU-03 |
|---|---|---|
| 1001 | Persona no encontrada (o dada de baja) | NO_EXISTE |
| 3001 | Documento inválido | error |
| 3002 | Tipo de documento no soportado | error |

## Administración

`AltaPersona`, `ModificarPersona`, `ConsultarPersona`, `BajaPersona` (lógica), `AltaOrganismo`, `BajaOrganismo`, `ConfigurarSimulacion`, `ConsultarSimulacion`. Los errores vuelven como SOAP Fault.

**Simulación de fallas** (escenario "la PDI no responde"): `ConfigurarSimulacion` con `modo` = `NORMAL`, `LENTO` (+ `latenciaMs`, para provocar el timeout del central) o `CAIDO` (SOAP Fault inmediato). Solo afecta a DNIC, nunca a la administración. Vive en memoria (vuelve a `PDI_SIMULACION_MODO` al reiniciar).

## Datos de prueba (ficticios)

`11111111`, `22222222`, `77777777` mayores · `33333333` 16 años · `44444444` cumple 18 el día de la migración · `55555555` cumple 18 al día siguiente · `66666666` dado de baja. El organismo se crea al arrancar desde `PDI_ORGANISMO_CODIGO` / `PDI_ORGANISMO_CLAVE` (clave guardada con BCrypt).
