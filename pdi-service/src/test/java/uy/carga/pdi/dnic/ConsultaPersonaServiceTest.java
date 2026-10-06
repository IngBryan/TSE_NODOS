package uy.carga.pdi.dnic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import uy.carga.pdi.consulta.ConsultaRegistro;
import uy.carga.pdi.consulta.ConsultaRegistroRepository;
import uy.carga.pdi.organismo.Organismo;
import uy.carga.pdi.organismo.OrganismoRepository;
import uy.carga.pdi.persona.Persona;
import uy.carga.pdi.persona.PersonaDatos;
import uy.carga.pdi.persona.PersonaRepository;

@ExtendWith(MockitoExtension.class)
class ConsultaPersonaServiceTest {

	private static final String ORGANISMO = "MTOP-CARGA";

	private static final String CLAVE = "clave-de-prueba-123";

	// Costo bajo para que el test sea rápido
	private static final PasswordEncoder ENCODER = new BCryptPasswordEncoder(4);

	private static final String CLAVE_HASH = ENCODER.encode(CLAVE);

	@Mock
	private PersonaRepository personaRepository;

	@Mock
	private OrganismoRepository organismoRepository;

	@Mock
	private ConsultaRegistroRepository consultaRepository;

	private SimpleMeterRegistry meterRegistry;

	private ConsultaPersonaService service;

	@BeforeEach
	void setUp() {
		meterRegistry = new SimpleMeterRegistry();
		service = new ConsultaPersonaService(personaRepository, organismoRepository, consultaRepository, ENCODER,
				meterRegistry);
		lenient().when(consultaRepository.save(any())).thenAnswer(invocation -> {
			ConsultaRegistro registro = invocation.getArgument(0);
			ReflectionTestUtils.setField(registro, "id", 42);
			return registro;
		});
	}

	@Test
	void devuelveLaPersonaCuandoTodoEsValido() {
		organismoValido();
		Persona persona = persona("12345678");
		when(personaRepository.findByNroDocumentoAndActivoTrue("12345678")).thenReturn(Optional.of(persona));

		ResultadoConsulta resultado = service.consultar(solicitud("12345678"));

		assertThat(resultado.esExito()).isTrue();
		assertThat(resultado.persona()).isSameAs(persona);
		assertThat(resultado.idSolicitud()).isEqualTo(7);
		assertThat(resultado.idRespuesta()).isEqualTo(42);
		assertThat(meterRegistry.counter("pdi.consultas", "resultado", "OK").count()).isEqualTo(1);
	}

	@Test
	void normalizaCedulaConPuntosYGuion() {
		organismoValido();
		when(personaRepository.findByNroDocumentoAndActivoTrue("12345678"))
			.thenReturn(Optional.of(persona("12345678")));

		assertThat(service.consultar(solicitud("1.234.567-8")).esExito()).isTrue();
	}

	@Test
	void rechazaClaveIncorrecta() {
		when(organismoRepository.findByCodigoAndActivoTrue(ORGANISMO))
			.thenReturn(Optional.of(new Organismo(ORGANISMO, "MTOP", CLAVE_HASH)));

		ResultadoConsulta resultado = service.consultar(
				new SolicitudConsulta(ORGANISMO, "otra-clave", "DO", "12345678", 7));

		assertThat(resultado.error()).isEqualTo(CodigoMensaje.ORGANISMO_NO_AUTORIZADO);
		verify(personaRepository, never()).findByNroDocumentoAndActivoTrue(any());
	}

	@Test
	void rechazaOrganismoInexistenteOInactivo() {
		when(organismoRepository.findByCodigoAndActivoTrue("OTRO")).thenReturn(Optional.empty());

		ResultadoConsulta resultado = service.consultar(new SolicitudConsulta("OTRO", CLAVE, "DO", "12345678", 7));

		assertThat(resultado.error()).isEqualTo(CodigoMensaje.ORGANISMO_NO_AUTORIZADO);
	}

	@Test
	void rechazaSinOrganismoOSinClave() {
		assertThat(service.consultar(new SolicitudConsulta(null, CLAVE, "DO", "12345678", 7)).error())
			.isEqualTo(CodigoMensaje.ORGANISMO_NO_AUTORIZADO);
		assertThat(service.consultar(new SolicitudConsulta(ORGANISMO, null, "DO", "12345678", 7)).error())
			.isEqualTo(CodigoMensaje.ORGANISMO_NO_AUTORIZADO);
	}

	@Test
	void rechazaTipoDocumentoDistintoDeCedula() {
		organismoValido();

		ResultadoConsulta resultado = service.consultar(
				new SolicitudConsulta(ORGANISMO, CLAVE, "PASAPORTE", "12345678", 7));

		assertThat(resultado.error()).isEqualTo(CodigoMensaje.TIPO_DOCUMENTO_NO_SOPORTADO);
	}

	@ParameterizedTest
	@NullAndEmptySource
	@ValueSource(strings = { "12345", "123456789", "12a45678" })
	void rechazaDocumentoInvalido(String documento) {
		organismoValido();

		assertThat(service.consultar(solicitud(documento)).error()).isEqualTo(CodigoMensaje.DOCUMENTO_INVALIDO);
	}

	@Test
	void informaPersonaNoEncontrada() {
		organismoValido();
		when(personaRepository.findByNroDocumentoAndActivoTrue("12345678")).thenReturn(Optional.empty());

		ResultadoConsulta resultado = service.consultar(solicitud("12345678"));

		assertThat(resultado.error()).isEqualTo(CodigoMensaje.PERSONA_NO_ENCONTRADA);
		assertThat(resultado.idRespuesta()).isEqualTo(42);
	}

	@Test
	void registraCadaConsultaConSuResultado() {
		organismoValido();
		when(personaRepository.findByNroDocumentoAndActivoTrue("12345678")).thenReturn(Optional.empty());

		service.consultar(solicitud("12345678"));

		ArgumentCaptor<ConsultaRegistro> captor = ArgumentCaptor.forClass(ConsultaRegistro.class);
		verify(consultaRepository).save(captor.capture());
		assertThat(captor.getValue().getOrganismoCodigo()).isEqualTo(ORGANISMO);
		assertThat(captor.getValue().getNroDocumento()).isEqualTo("12345678");
		assertThat(captor.getValue().getIdSolicitud()).isEqualTo(7);
		assertThat(captor.getValue().getResultado()).isEqualTo("PERSONA_NO_ENCONTRADA");
	}

	@Test
	void laSolicitudNoExponeLaClaveEnToString() {
		assertThat(solicitud("12345678").toString()).doesNotContain(CLAVE);
	}

	private void organismoValido() {
		when(organismoRepository.findByCodigoAndActivoTrue(ORGANISMO))
			.thenReturn(Optional.of(new Organismo(ORGANISMO, "MTOP", CLAVE_HASH)));
	}

	private static SolicitudConsulta solicitud(String documento) {
		return new SolicitudConsulta(ORGANISMO, CLAVE, "DO", documento, 7);
	}

	private static Persona persona(String documento) {
		return new Persona(new PersonaDatos(documento, "Juan", null, "Pérez", "García", LocalDate.of(1980, 5, 10), 1,
				1));
	}

}
