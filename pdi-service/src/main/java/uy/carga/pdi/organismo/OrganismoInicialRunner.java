package uy.carga.pdi.organismo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import uy.carga.pdi.config.PdiProperties;

/**
 * Crea al arrancar el organismo configurado por variables de entorno, si todavía no existe. Así la clave del
 * componente central no queda en el repositorio (ni en las migraciones).
 */
@Component
public class OrganismoInicialRunner implements ApplicationRunner {

	private static final Logger log = LoggerFactory.getLogger(OrganismoInicialRunner.class);

	private final OrganismoRepository repository;

	private final PasswordEncoder passwordEncoder;

	private final PdiProperties.OrganismoInicial organismoInicial;

	public OrganismoInicialRunner(OrganismoRepository repository, PasswordEncoder passwordEncoder,
			PdiProperties properties) {
		this.repository = repository;
		this.passwordEncoder = passwordEncoder;
		this.organismoInicial = properties.organismoInicial();
	}

	@Override
	@Transactional
	public void run(ApplicationArguments args) {
		if (!organismoInicial.configurado() || repository.existsByCodigo(organismoInicial.codigo())) {
			return;
		}
		String nombre = organismoInicial.nombre() == null || organismoInicial.nombre().isBlank()
				? organismoInicial.codigo() : organismoInicial.nombre();
		repository.save(new Organismo(organismoInicial.codigo(), nombre,
				passwordEncoder.encode(organismoInicial.clave())));
		log.info("Organismo inicial creado: {}", organismoInicial.codigo());
	}

}
