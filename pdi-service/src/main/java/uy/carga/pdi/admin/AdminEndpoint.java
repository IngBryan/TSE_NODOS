package uy.carga.pdi.admin;

import java.time.LocalDate;
import javax.xml.datatype.DatatypeConstants;
import javax.xml.datatype.DatatypeFactory;
import javax.xml.datatype.XMLGregorianCalendar;
import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;
import org.springframework.ws.server.endpoint.annotation.RequestPayload;
import org.springframework.ws.server.endpoint.annotation.ResponsePayload;
import uy.carga.pdi.admin.ws.AltaOrganismoRequest;
import uy.carga.pdi.admin.ws.AltaOrganismoResponse;
import uy.carga.pdi.admin.ws.AltaPersonaRequest;
import uy.carga.pdi.admin.ws.AltaPersonaResponse;
import uy.carga.pdi.admin.ws.BajaOrganismoRequest;
import uy.carga.pdi.admin.ws.BajaOrganismoResponse;
import uy.carga.pdi.admin.ws.BajaPersonaRequest;
import uy.carga.pdi.admin.ws.BajaPersonaResponse;
import uy.carga.pdi.admin.ws.ConfigurarSimulacionRequest;
import uy.carga.pdi.admin.ws.ConfigurarSimulacionResponse;
import uy.carga.pdi.admin.ws.ConsultarPersonaRequest;
import uy.carga.pdi.admin.ws.ConsultarPersonaResponse;
import uy.carga.pdi.admin.ws.ConsultarSimulacionRequest;
import uy.carga.pdi.admin.ws.ConsultarSimulacionResponse;
import uy.carga.pdi.admin.ws.DatosPersona;
import uy.carga.pdi.admin.ws.EstadoSimulacion;
import uy.carga.pdi.admin.ws.ModificarPersonaRequest;
import uy.carga.pdi.admin.ws.ModificarPersonaResponse;
import uy.carga.pdi.admin.ws.ModoSimulacionTipo;
import uy.carga.pdi.config.WebServiceConfig;
import uy.carga.pdi.organismo.Organismo;
import uy.carga.pdi.persona.PersonaDatos;
import uy.carga.pdi.simulacion.ConfiguracionSimulacion;
import uy.carga.pdi.simulacion.ModoSimulacion;
import uy.carga.pdi.simulacion.SimulacionService;

/**
 * Servicio SOAP de administración. La autenticación (HTTP Basic) y la validación contra admin.xsd las hacen
 * interceptores configurados en {@link WebServiceConfig}.
 */
@Endpoint
public class AdminEndpoint {

	private static final String NS = WebServiceConfig.ADMIN_NAMESPACE;

	private static final DatatypeFactory DATATYPE_FACTORY = DatatypeFactory.newDefaultInstance();

	private final AdminService adminService;

	private final SimulacionService simulacionService;

	public AdminEndpoint(AdminService adminService, SimulacionService simulacionService) {
		this.adminService = adminService;
		this.simulacionService = simulacionService;
	}

	// ===== Personas =====

	@PayloadRoot(namespace = NS, localPart = "AltaPersonaRequest")
	@ResponsePayload
	public AltaPersonaResponse altaPersona(@RequestPayload AltaPersonaRequest request) {
		AltaPersonaResponse response = new AltaPersonaResponse();
		response.setPersona(aDatosPersona(adminService.altaPersona(aPersonaDatos(request.getPersona()))));
		return response;
	}

	@PayloadRoot(namespace = NS, localPart = "ModificarPersonaRequest")
	@ResponsePayload
	public ModificarPersonaResponse modificarPersona(@RequestPayload ModificarPersonaRequest request) {
		ModificarPersonaResponse response = new ModificarPersonaResponse();
		response.setPersona(aDatosPersona(adminService.modificarPersona(aPersonaDatos(request.getPersona()))));
		return response;
	}

	@PayloadRoot(namespace = NS, localPart = "ConsultarPersonaRequest")
	@ResponsePayload
	public ConsultarPersonaResponse consultarPersona(@RequestPayload ConsultarPersonaRequest request) {
		ConsultarPersonaResponse response = new ConsultarPersonaResponse();
		response.setPersona(aDatosPersona(adminService.consultarPersona(request.getNroDocumento())));
		return response;
	}

	@PayloadRoot(namespace = NS, localPart = "BajaPersonaRequest")
	@ResponsePayload
	public BajaPersonaResponse bajaPersona(@RequestPayload BajaPersonaRequest request) {
		adminService.bajaPersona(request.getNroDocumento());
		BajaPersonaResponse response = new BajaPersonaResponse();
		response.setNroDocumento(request.getNroDocumento());
		return response;
	}

	// ===== Organismos =====

	@PayloadRoot(namespace = NS, localPart = "AltaOrganismoRequest")
	@ResponsePayload
	public AltaOrganismoResponse altaOrganismo(@RequestPayload AltaOrganismoRequest request) {
		Organismo organismo = adminService.altaOrganismo(request.getCodigo(), request.getNombre(),
				request.getClave());
		AltaOrganismoResponse response = new AltaOrganismoResponse();
		response.setCodigo(organismo.getCodigo());
		response.setActivo(organismo.isActivo());
		return response;
	}

	@PayloadRoot(namespace = NS, localPart = "BajaOrganismoRequest")
	@ResponsePayload
	public BajaOrganismoResponse bajaOrganismo(@RequestPayload BajaOrganismoRequest request) {
		Organismo organismo = adminService.bajaOrganismo(request.getCodigo());
		BajaOrganismoResponse response = new BajaOrganismoResponse();
		response.setCodigo(organismo.getCodigo());
		response.setActivo(organismo.isActivo());
		return response;
	}

	// ===== Simulación =====

	@PayloadRoot(namespace = NS, localPart = "ConfigurarSimulacionRequest")
	@ResponsePayload
	public ConfigurarSimulacionResponse configurarSimulacion(@RequestPayload ConfigurarSimulacionRequest request) {
		long latencia = request.getLatenciaMs() != null ? request.getLatenciaMs() : 0L;
		ConfiguracionSimulacion nueva = simulacionService.configurar(
				new ConfiguracionSimulacion(ModoSimulacion.valueOf(request.getModo().value()), latencia));
		ConfigurarSimulacionResponse response = new ConfigurarSimulacionResponse();
		response.setEstado(aEstado(nueva));
		return response;
	}

	@PayloadRoot(namespace = NS, localPart = "ConsultarSimulacionRequest")
	@ResponsePayload
	public ConsultarSimulacionResponse consultarSimulacion(@RequestPayload ConsultarSimulacionRequest request) {
		ConsultarSimulacionResponse response = new ConsultarSimulacionResponse();
		response.setEstado(aEstado(simulacionService.configuracion()));
		return response;
	}

	// ===== Mapeos =====

	private static PersonaDatos aPersonaDatos(DatosPersona dto) {
		return new PersonaDatos(dto.getNroDocumento(), dto.getNombre1().trim(), vacioANull(dto.getNombre2()),
				dto.getPrimerApellido().trim(), vacioANull(dto.getSegundoApellido()),
				aLocalDate(dto.getFechaNacimiento()), dto.getSexo(), dto.getCodNacionalidad());
	}

	private static DatosPersona aDatosPersona(PersonaDatos datos) {
		DatosPersona dto = new DatosPersona();
		dto.setNroDocumento(datos.nroDocumento());
		dto.setNombre1(datos.nombre1());
		dto.setNombre2(datos.nombre2());
		dto.setPrimerApellido(datos.primerApellido());
		dto.setSegundoApellido(datos.segundoApellido());
		dto.setFechaNacimiento(aXml(datos.fechaNacimiento()));
		dto.setSexo(datos.sexo());
		dto.setCodNacionalidad(datos.codNacionalidad());
		return dto;
	}

	private static EstadoSimulacion aEstado(ConfiguracionSimulacion configuracion) {
		EstadoSimulacion estado = new EstadoSimulacion();
		estado.setModo(ModoSimulacionTipo.fromValue(configuracion.modo().name()));
		estado.setLatenciaMs(configuracion.latenciaMs());
		return estado;
	}

	private static String vacioANull(String valor) {
		return valor == null || valor.isBlank() ? null : valor.trim();
	}

	private static LocalDate aLocalDate(XMLGregorianCalendar fecha) {
		return LocalDate.of(fecha.getYear(), fecha.getMonth(), fecha.getDay());
	}

	private static XMLGregorianCalendar aXml(LocalDate fecha) {
		return DATATYPE_FACTORY.newXMLGregorianCalendarDate(fecha.getYear(), fecha.getMonthValue(),
				fecha.getDayOfMonth(), DatatypeConstants.FIELD_UNDEFINED);
	}

}
