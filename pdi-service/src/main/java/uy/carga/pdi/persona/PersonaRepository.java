package uy.carga.pdi.persona;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PersonaRepository extends JpaRepository<Persona, Long> {

	Optional<Persona> findByNroDocumento(String nroDocumento);

	Optional<Persona> findByNroDocumentoAndActivoTrue(String nroDocumento);

}
