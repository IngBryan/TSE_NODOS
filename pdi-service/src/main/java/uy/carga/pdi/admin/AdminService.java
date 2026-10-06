package uy.carga.pdi.admin;

import java.time.Clock;
import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import uy.carga.pdi.organismo.Organismo;
import uy.carga.pdi.organismo.OrganismoRepository;
import uy.carga.pdi.persona.Persona;
import uy.carga.pdi.persona.PersonaDatos;
import uy.carga.pdi.persona.PersonaRepository;

/** Administración en caliente de personas y organismos de la PDI simulada. */
@Service
public class AdminService {

	private static final Logger log = LoggerFactory.getLogger(AdminService.class);

	private final PersonaRepository personaRepository;

	private final OrganismoRepository organismoRepository;

	private final PasswordEncoder passwordEncoder;

	private final Clock clock;

	@Autowired
	public AdminService(PersonaRepository personaRepository, OrganismoRepository organismoRepository,
			PasswordEncoder passwordEncoder) {
		this(personaRepository, organismoRepository, passwordEncoder, Clock.systemDefaultZone());
	}

	AdminService(PersonaRepository personaRepository, OrganismoRepository organismoRepository,
			PasswordEncoder passwordEncoder, Clock clock) {
		this.personaRepository = personaRepository;
		this.organismoRepository = organismoRepository;
		this.passwordEncoder = passwordEncoder;
		this.clock = clock;
	}

	/** Da de alta una persona. Si existía dada de baja, la reactiva con los datos nuevos. */
	@Transactional
	public PersonaDatos altaPersona(PersonaDatos datos) {
		validarFechaNacimiento(datos.fechaNacimiento());
		Persona persona = personaRepository.findByNroDocumento(datos.nroDocumento())
			.map(existente -> {
				if (existente.isActivo()) {
					throw new RecursoDuplicadoException("Ya existe una persona con el documento " + datos.nroDocumento());
				}
				existente.actualizar(datos);
				return existente;
			})
			.orElseGet(() -> personaRepository.save(new Persona(datos)));
		log.info("Persona dada de alta id={}", persona.getId());
		return persona.datos();
	}

	@Transactional
	public PersonaDatos modificarPersona(PersonaDatos datos) {
		validarFechaNacimiento(datos.fechaNacimiento());
		Persona persona = personaActiva(datos.nroDocumento());
		persona.actualizar(datos);
		log.info("Persona modificada id={}", persona.getId());
		return persona.datos();
	}

	@Transactional(readOnly = true)
	public PersonaDatos consultarPersona(String nroDocumento) {
		return personaActiva(nroDocumento).datos();
	}

	/** Baja lógica: la persona deja de aparecer en obtDocDigitalizado (responde "no encontrada"). */
	@Transactional
	public void bajaPersona(String nroDocumento) {
		Persona persona = personaActiva(nroDocumento);
		persona.darDeBaja();
		log.info("Persona dada de baja id={}", persona.getId());
	}

	@Transactional
	public Organismo altaOrganismo(String codigo, String nombre, String clave) {
		if (organismoRepository.existsByCodigo(codigo)) {
			throw new RecursoDuplicadoException("Ya existe un organismo con el código " + codigo);
		}
		Organismo organismo = organismoRepository.save(new Organismo(codigo, nombre, passwordEncoder.encode(clave)));
		log.info("Organismo dado de alta: {}", codigo);
		return organismo;
	}

	@Transactional
	public Organismo bajaOrganismo(String codigo) {
		Organismo organismo = organismoRepository.findByCodigo(codigo)
			.orElseThrow(() -> new RecursoNoEncontradoException("No existe el organismo " + codigo));
		organismo.desactivar();
		log.info("Organismo desactivado: {}", codigo);
		return organismo;
	}

	private Persona personaActiva(String nroDocumento) {
		return personaRepository.findByNroDocumentoAndActivoTrue(nroDocumento)
			.orElseThrow(() -> new RecursoNoEncontradoException("No existe una persona con el documento " + nroDocumento));
	}

	private void validarFechaNacimiento(LocalDate fechaNacimiento) {
		if (fechaNacimiento.isAfter(LocalDate.now(clock))) {
			throw new DatosInvalidosException("La fecha de nacimiento no puede ser futura");
		}
	}

}
