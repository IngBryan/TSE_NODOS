# carga.uy — PDI simulada (Servicio de Información DNIC)

Servicio Spring Boot que responde consultas SOAP de datos de ciudadanos.
Central utiliza la información para validar su existencia y mayoría de edad.
El cálculo de edad pertenece a Central.

## Arranque y configuración

El arranque completo se documenta en el [README principal](../README.md).
Para levantar únicamente la PDI, desde la raíz de TSE_NODOS:

```bash
docker compose up -d --build pdi
```

Dirección local: http://localhost:3005. Configurar `PDI_*` en el `.env`
de TSE_NODOS, usando como referencia su `.env.example`.

- `PDI_ADMIN_USER` y `PDI_ADMIN_PASSWORD`: acceso administrativo.
- `PDI_ORGANISMO_CODIGO` y `PDI_ORGANISMO_CLAVE`: mismos valores que Central.
- `PDI_ORGANISMO_NOMBRE`: nombre del organismo inicial.
- `PDI_SIMULACION_MODO`: NORMAL, LENTO o CAIDO.
- `PDI_SIMULACION_LATENCIA_MS`: demora aplicada en modo LENTO.
- `PDI_WSS_TIMESTAMP_TTL_SEGUNDOS`: vigencia máxima del Timestamp; 300 por defecto.

## Servicios SOAP

| Servicio | Endpoint | WSDL | Autenticación |
|---|---|---|---|
| DNIC | `/ws/servicioInformacion` | `/ws/servicioInformacion.wsdl` | WS-Addressing y WS-Security |
| Administración | `/ws/admin` | `/ws/admin.wsdl` | HTTP Basic |

El servicio DNIC ofrece `obtDocDigitalizado` y `ProductDesc`.
El documento acepta formato continuo o con puntos y guion; el tipo es `DO`.
La respuesta incluye nombres, apellidos, fecha de nacimiento, sexo,
nacionalidad y documento; no devuelve imágenes.
`idSolicitud` se conserva y `idRespuesta` identifica el registro de consulta.

## Cabeceras y seguridad

Cada solicitud DNIC debe incluir:

- WS-Addressing 1.0: `wsa:Action`, `wsa:MessageID` y `wsa:To`.
- WS-Security: `wsu:Timestamp` vigente y `wsse:UsernameToken` con el código
  del organismo y su clave mediante `PasswordText`. No se admite PasswordDigest.

Acciones: `http://wsServicioDeInformacion/obtDocDigitalizado` y
`http://wsServicioDeInformacion/ProductDesc`. La respuesta incluye su propio
MessageID y `RelatesTo` con el identificador de la solicitud.
Los campos `Organismo` y `ClaveAcceso1` del cuerpo se conservan por compatibilidad,
pero la autenticación se realiza con el UsernameToken. En acceso remoto,
HTTPS protege el transporte de la clave.

En SoapUI, habilitar WS-Addressing, generar MessageID y Action y configurar
UsernameToken con PasswordText y Timestamp.

Los errores de cabeceras, credenciales y administración se devuelven como SOAP Fault.
Los errores de negocio de DNIC se devuelven dentro de `Errores/Mensaje/CodMensaje`
con HTTP 200: 1001 persona inexistente o dada de baja, 3001 documento inválido,
3002 tipo de documento no soportado.

## Administración y fallas

La API administrativa permite alta, modificación, consulta y baja lógica de personas;
alta y baja de organismos; y `ConfigurarSimulacion` / `ConsultarSimulacion`.

- NORMAL: respuesta habitual.
- LENTO: demora `latenciaMs`; permite provocar el timeout de Central.
- CAIDO: SOAP Fault inmediato.

La simulación afecta únicamente a DNIC. Administración permanece accesible.
Al reiniciar se vuelve al modo definido por las variables de entorno.

## Datos de prueba y observabilidad

La PDI utiliza una base H2 en memoria. Al reiniciar, se restablecen las tablas
y los datos de prueba mediante Flyway.

Datos ficticios: `11111111`, `22222222` y `77777777` mayores; `33333333` menor;
`44444444` cumple 18 el día de la migración; `55555555`, al día siguiente;
`66666666`, dado de baja. La migración V3 agrega los registros del equipo.

Estado: `/actuator/health`. Métricas: `/actuator/prometheus`, incluida
`pdi_consultas_total{resultado}`. Logs JSON con `correlationId` tomado de
`X-Correlation-Id` y `wsaMessageId` para las solicitudes SOAP.

## Desarrollo y pruebas

Requiere Java 21. Exportar las variables `PDI_*` necesarias antes de ejecutar;
Maven no carga automáticamente el `.env` del repositorio.
Desde esta carpeta, en Bash:

```bash
bash ./mvnw spring-boot:run
bash ./mvnw verify
```

En PowerShell, usar `.\mvnw.cmd spring-boot:run` o `.\mvnw.cmd verify`.
Sin Docker, el puerto predeterminado es 8080 y puede ajustarse mediante `PORT`.
