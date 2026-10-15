package uy.carga.pdi.persona;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;

import javax.sql.DataSource;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import uy.carga.pdi.admin.AdminService;

/**
 * Regresión: con H2 2.4.240 los CHECK de la tabla persona quedan atados a la conexión que corrió Flyway. Cuando Hikari
 * la recicla (maxLifetime, 30 min por defecto) todo INSERT en persona falla con
 * {@code Check constraint invalid: "CONSTRAINT_...: "} (causa: "The database has been closed") hasta reiniciar.
 * Por eso el pom fija H2 en 2.3.232.
 */
@SpringBootTest(properties = { "spring.datasource.url=jdbc:h2:mem:pdi-reciclado;DB_CLOSE_DELAY=-1",
		"pdi.admin.usuario=admin", "pdi.admin.password=admin-test-password",
		"pdi.organismo-inicial.codigo=MTOP-CARGA", "pdi.organismo-inicial.clave=clave-de-prueba-123" })
class AltaTrasReciclarConexionesTest {

	@Autowired
	private DataSource dataSource;

	@Autowired
	private AdminService adminService;

	@Test
	void altaDePersonaFuncionaDespuesDeQueHikariCierraLaConexionDeFlyway() throws Exception {
		// Cierra todas las conexiones del pool, incluida la que creó el esquema (lo que hace maxLifetime)
		dataSource.unwrap(HikariDataSource.class).getHikariPoolMXBean().softEvictConnections();

		PersonaDatos alta = adminService.altaPersona(new PersonaDatos("41234567", "Ana", null, "Silva", null,
				LocalDate.of(1990, 1, 1), 2, 1));

		assertThat(alta.nroDocumento()).isEqualTo("41234567");
	}

}
