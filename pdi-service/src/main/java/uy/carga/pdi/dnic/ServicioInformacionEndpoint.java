package uy.carga.pdi.dnic;

import java.time.format.DateTimeFormatter;
import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ws.context.MessageContext;
import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.RequestPayload;
import org.springframework.ws.server.endpoint.annotation.ResponsePayload;
import org.springframework.ws.soap.addressing.server.annotation.Action;
import uy.carga.pdi.dnic.ws.ArrayOfMensaje;
import uy.carga.pdi.dnic.ws.Mensaje;
import uy.carga.pdi.dnic.ws.ObjParamObtDocDigitalizado;
import uy.carga.pdi.dnic.ws.ObjPersona;
import uy.carga.pdi.dnic.ws.ObtDocDigitalizado;
import uy.carga.pdi.dnic.ws.ObtDocDigitalizadoResponse;
import uy.carga.pdi.dnic.ws.ObtProductInfo;
import uy.carga.pdi.dnic.ws.ProductDesc;
import uy.carga.pdi.dnic.ws.ProductDescResponse;
import uy.carga.pdi.dnic.ws.ResultObtDocDigitalizado;
import uy.carga.pdi.persona.Persona;
import uy.carga.pdi.seguridad.OrganismoAutenticado;
import uy.carga.pdi.seguridad.WsAddressingAcciones;
import uy.carga.pdi.simulacion.SimulacionService;

/** Implementación del contrato DNIC (wsServicioDeInformacion). */
@Endpoint
public class ServicioInformacionEndpoint {

	private static final Logger log = LoggerFactory.getLogger(ServicioInformacionEndpoint.class);

	/** Formato de {@code FechaNacimiento} en la respuesta. */
	public static final DateTimeFormatter FORMATO_FECHA = DateTimeFormatter.ISO_LOCAL_DATE;

	private static final String CEDULA_IDENTIDAD = "DO";

	private final ConsultaPersonaService consultaPersonaService;

	private final SimulacionService simulacionService;

	public ServicioInformacionEndpoint(ConsultaPersonaService consultaPersonaService,
			SimulacionService simulacionService) {
		this.consultaPersonaService = consultaPersonaService;
		this.simulacionService = simulacionService;
	}

	/**
	 * Se despacha solo por wsa:Action (WS-Addressing obligatorio). El organismo es el del UsernameToken; los campos
	 * Organismo/ClaveAcceso1 del Body se ignoran.
	 */
	@Action(value = WsAddressingAcciones.OBT_DOC_DIGITALIZADO, output = WsAddressingAcciones.OBT_DOC_DIGITALIZADO_RESPONSE)
	@ResponsePayload
	public ObtDocDigitalizadoResponse obtDocDigitalizado(@RequestPayload ObtDocDigitalizado request,
			MessageContext messageContext) {
		simulacionService.aplicar();

		ObjParamObtDocDigitalizado param = request.getParamObtDocDigitalizado() != null
				? request.getParamObtDocDigitalizado() : new ObjParamObtDocDigitalizado();
		SolicitudConsulta solicitud = new SolicitudConsulta(OrganismoAutenticado.de(messageContext),
				param.getTipoDocumento(), param.getNrodocumento(), param.getIdSolicitud());

		ResultadoConsulta resultado = consultaPersonaService.consultar(solicitud);
		log.info("obtDocDigitalizado organismo={} idSolicitud={} idRespuesta={} resultado={}",
				solicitud.organismo(), resultado.idSolicitud(), resultado.idRespuesta(),
				resultado.esExito() ? ConsultaPersonaService.RESULTADO_OK : resultado.error().name());

		ObtDocDigitalizadoResponse response = new ObtDocDigitalizadoResponse();
		response.setObtDocDigitalizadoResult(aResult(resultado));
		return response;
	}

	@Action(value = WsAddressingAcciones.PRODUCT_DESC, output = WsAddressingAcciones.PRODUCT_DESC_RESPONSE)
	@ResponsePayload
	public ProductDescResponse productDesc(@RequestPayload ProductDesc request) {
		simulacionService.aplicar();
		ObtProductInfo info = new ObtProductInfo();
		info.setModalidad("SIMULACION");
		info.setVersion("1.0");
		info.setDescripcion("Simulación del Servicio de Información DNIC para carga.uy");
		ProductDescResponse response = new ProductDescResponse();
		response.setProductDescResult(info);
		return response;
	}

	private static ResultObtDocDigitalizado aResult(ResultadoConsulta resultado) {
		ResultObtDocDigitalizado result = new ResultObtDocDigitalizado();
		result.setIdSolicitud(resultado.idSolicitud());
		result.setIdRespuesta(resultado.idRespuesta());
		if (resultado.esExito()) {
			result.setObjPersona(aObjPersona(resultado.persona()));
		}
		else {
			Mensaje mensaje = new Mensaje();
			mensaje.setCodMensaje(resultado.error().codigo());
			mensaje.setDescripcion(resultado.error().descripcion());
			ArrayOfMensaje errores = new ArrayOfMensaje();
			errores.getMensaje().add(mensaje);
			result.setErrores(errores);
		}
		return result;
	}

	private static ObjPersona aObjPersona(Persona persona) {
		ObjPersona obj = new ObjPersona();
		obj.setCodTipoDocumento(CEDULA_IDENTIDAD);
		obj.setNroDocumento(persona.getNroDocumento());
		obj.setNombre1(persona.getNombre1());
		obj.setNombre2(persona.getNombre2());
		obj.setPrimerApellido(persona.getPrimerApellido());
		obj.setSegundoApellido(persona.getSegundoApellido());
		obj.setFechaNacimiento(persona.getFechaNacimiento().format(FORMATO_FECHA));
		obj.setSexo(persona.getSexo());
		obj.setCodNacionalidad(persona.getCodNacionalidad());
		obj.setNombreEnCedula(Stream
			.of(persona.getNombre1(), persona.getNombre2(), persona.getPrimerApellido(), persona.getSegundoApellido())
			.filter(Objects::nonNull)
			.collect(Collectors.joining(" ")));
		return obj;
	}

}
