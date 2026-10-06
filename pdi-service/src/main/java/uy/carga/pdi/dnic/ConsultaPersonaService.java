package uy.carga.pdi.dnic;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Optional;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import uy.carga.pdi.config.CorrelationIdFilter;
import uy.carga.pdi.consulta.ConsultaRegistro;
import uy.carga.pdi.consulta.ConsultaRegistroRepository;
import uy.carga.pdi.organismo.OrganismoRepository;
import uy.carga.pdi.persona.Persona;
import uy.carga.pdi.persona.PersonaRepository;

/**
 * Lógica de {@code obtDocDigitalizado}: autentica al organismo, valida el documento, busca la persona y registra
 * la consulta. No calcula la edad: eso lo hace el componente central (CU-03, paso 3).
 */
@Service
public class ConsultaPersonaService {

	static final String RESULTADO_OK = "OK";

	private static final Pattern CEDULA = Pattern.compile("\\d{6,8}");

	private final PersonaRepository personaRepository;

	private final OrganismoRepository organismoRepository;

	private final ConsultaRegistroRepository consultaRepository;

	private final PasswordEncoder passwordEncoder;

	private final MeterRegistry meterRegistry;

	public ConsultaPersonaService(PersonaRepository personaRepository, OrganismoRepository organismoRepository,
			ConsultaRegistroRepository consultaRepository, PasswordEncoder passwordEncoder,
			MeterRegistry meterRegistry) {
		this.personaRepository = personaRepository;
		this.organismoRepository = organismoRepository;
		this.consultaRepository = consultaRepository;
		this.passwordEncoder = passwordEncoder;
		this.meterRegistry = meterRegistry;
	}

	@Transactional
	public ResultadoConsulta consultar(SolicitudConsulta solicitud) {
		if (!organismoAutorizado(solicitud.organismo(), solicitud.claveAcceso1())) {
			return registrarError(solicitud, solicitud.nroDocumento(), CodigoMensaje.ORGANISMO_NO_AUTORIZADO);
		}
		if (!tipoDocumentoSoportado(solicitud.tipoDocumento())) {
			return registrarError(solicitud, solicitud.nroDocumento(), CodigoMensaje.TIPO_DOCUMENTO_NO_SOPORTADO);
		}
		Optional<String> documento = normalizarDocumento(solicitud.nroDocumento());
		if (documento.isEmpty()) {
			return registrarError(solicitud, solicitud.nroDocumento(), CodigoMensaje.DOCUMENTO_INVALIDO);
		}
		Optional<Persona> persona = personaRepository.findByNroDocumentoAndActivoTrue(documento.get());
		if (persona.isEmpty()) {
			return registrarError(solicitud, documento.get(), CodigoMensaje.PERSONA_NO_ENCONTRADA);
		}
		int idRespuesta = registrar(solicitud, documento.get(), RESULTADO_OK);
		return ResultadoConsulta.exito(solicitud.idSolicitud(), idRespuesta, persona.get());
	}

	/**
	 * Acepta la cédula con o sin puntos y guion ("1.234.567-8" → "12345678"). No valida el dígito verificador.
	 */
	static Optional<String> normalizarDocumento(String nroDocumento) {
		if (nroDocumento == null) {
			return Optional.empty();
		}
		String limpio = nroDocumento.replaceAll("[.\\-\\s]", "");
		return CEDULA.matcher(limpio).matches() ? Optional.of(limpio) : Optional.empty();
	}

	private static boolean tipoDocumentoSoportado(String tipoDocumento) {
		return tipoDocumento == null || tipoDocumento.isBlank() || "DO".equalsIgnoreCase(tipoDocumento.trim());
	}

	private boolean organismoAutorizado(String codigo, String clave) {
		if (codigo == null || codigo.isBlank() || clave == null || clave.isEmpty()) {
			return false;
		}
		return organismoRepository.findByCodigoAndActivoTrue(codigo.trim())
			.map(organismo -> passwordEncoder.matches(clave, organismo.getClaveHash()))
			.orElse(false);
	}

	private ResultadoConsulta registrarError(SolicitudConsulta solicitud, String documento, CodigoMensaje error) {
		int idRespuesta = registrar(solicitud, documento, error.name());
		return ResultadoConsulta.error(solicitud.idSolicitud(), idRespuesta, error);
	}

	private int registrar(SolicitudConsulta solicitud, String documento, String resultado) {
		ConsultaRegistro registro = consultaRepository.save(new ConsultaRegistro(solicitud.organismo(), documento,
				solicitud.idSolicitud(), resultado, MDC.get(CorrelationIdFilter.MDC_KEY)));
		Counter.builder("pdi.consultas")
			.description("Consultas obtDocDigitalizado por resultado")
			.tag("resultado", resultado)
			.register(meterRegistry)
			.increment();
		return registro.getId();
	}

}
