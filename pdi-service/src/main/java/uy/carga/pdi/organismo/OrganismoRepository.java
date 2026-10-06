package uy.carga.pdi.organismo;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrganismoRepository extends JpaRepository<Organismo, Long> {

	Optional<Organismo> findByCodigo(String codigo);

	Optional<Organismo> findByCodigoAndActivoTrue(String codigo);

	boolean existsByCodigo(String codigo);

}
