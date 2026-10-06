package uy.carga.pdi.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import uy.carga.pdi.organismo.Organismo;
import uy.carga.pdi.organismo.OrganismoRepository;
import uy.carga.pdi.persona.Persona;
import uy.carga.pdi.persona.PersonaDatos;
import uy.carga.pdi.persona.PersonaRepository;

@ExtendWith(MockitoExtension.class)
class AdminServiceTest {

	private static final Clock HOY = Clock.fixed(Instant.parse("2026-10-04T12:00:00Z"), ZoneId.of("UTC"));

	private final PasswordEncoder encoder = new BCryptPasswordEncoder(4);

	@Mock
	private PersonaRepository personaRepository;

	@Mock
	private OrganismoRepository organismoRepository;

	private AdminService service;

	@BeforeEach
	void setUp() {
		service = new AdminService(personaRepository, organismoRepository, encoder, HOY);
	}

	@Test
	void altaDePersonaNueva() {
		when(personaRepository.findByNroDocumento("12345678")).thenReturn(Optional.empty());
		when(personaRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

		PersonaDatos resultado = service.altaPersona(datos("12345678", "Juan"));

		assertThat(resultado.nombre1()).isEqualTo("Juan");
	}

	@Test
	void altaDePersonaActivaDuplicadaFalla() {
		when(personaRepository.findByNroDocumento("12345678"))
			.thenReturn(Optional.of(new Persona(datos("12345678", "Juan"))));

		assertThatThrownBy(() -> service.altaPersona(datos("12345678", "Otro")))
			.isInstanceOf(RecursoDuplicadoException.class);
	}

	@Test
	void altaDePersonaDadaDeBajaLaReactiva() {
		Persona existente = new Persona(datos("12345678", "Juan"));
		existente.darDeBaja();
		when(personaRepository.findByNroDocumento("12345678")).thenReturn(Optional.of(existente));

		PersonaDatos resultado = service.altaPersona(datos("12345678", "Juana"));

		assertThat(existente.isActivo()).isTrue();
		assertThat(resultado.nombre1()).isEqualTo("Juana");
		verify(personaRepository, never()).save(any());
	}

	@Test
	void rechazaFechaDeNacimientoFutura() {
		PersonaDatos futura = new PersonaDatos("12345678", "Juan", null, "Pérez", null, LocalDate.of(2026, 10, 5), 1,
				1);

		assertThatThrownBy(() -> service.altaPersona(futura)).isInstanceOf(DatosInvalidosException.class);
	}

	@Test
	void modificarPersonaInexistenteFalla() {
		when(personaRepository.findByNroDocumentoAndActivoTrue("12345678")).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.modificarPersona(datos("12345678", "Juan")))
			.isInstanceOf(RecursoNoEncontradoException.class);
	}

	@Test
	void modificarYBajaDePersona() {
		Persona persona = new Persona(datos("12345678", "Juan"));
		when(personaRepository.findByNroDocumentoAndActivoTrue("12345678")).thenReturn(Optional.of(persona));

		assertThat(service.modificarPersona(datos("12345678", "Juan Pablo")).nombre1()).isEqualTo("Juan Pablo");
		service.bajaPersona("12345678");

		assertThat(persona.isActivo()).isFalse();
	}

	@Test
	void altaDeOrganismoGuardaLaClaveHasheada() {
		when(organismoRepository.existsByCodigo("MTOP-CARGA")).thenReturn(false);
		when(organismoRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

		Organismo organismo = service.altaOrganismo("MTOP-CARGA", "MTOP", "clave-de-prueba-123");

		assertThat(organismo.getClaveHash()).isNotEqualTo("clave-de-prueba-123");
		assertThat(encoder.matches("clave-de-prueba-123", organismo.getClaveHash())).isTrue();
	}

	@Test
	void altaDeOrganismoDuplicadoFalla() {
		when(organismoRepository.existsByCodigo("MTOP-CARGA")).thenReturn(true);

		assertThatThrownBy(() -> service.altaOrganismo("MTOP-CARGA", "MTOP", "clave-de-prueba-123"))
			.isInstanceOf(RecursoDuplicadoException.class);
	}

	@Test
	void bajaDeOrganismo() {
		Organismo organismo = new Organismo("MTOP-CARGA", "MTOP", "hash");
		when(organismoRepository.findByCodigo("MTOP-CARGA")).thenReturn(Optional.of(organismo));

		assertThat(service.bajaOrganismo("MTOP-CARGA").isActivo()).isFalse();
	}

	@Test
	void bajaDeOrganismoInexistenteFalla() {
		when(organismoRepository.findByCodigo("NO")).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.bajaOrganismo("NO")).isInstanceOf(RecursoNoEncontradoException.class);
	}

	private static PersonaDatos datos(String documento, String nombre) {
		return new PersonaDatos(documento, nombre, null, "Pérez", "García", LocalDate.of(1980, 5, 10), 1, 1);
	}

}
