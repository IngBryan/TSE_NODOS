package uy.carga.pdi.simulacion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import uy.carga.pdi.config.PdiProperties;

class SimulacionServiceTest {

	private final SimulacionService service = new SimulacionService(new PdiProperties(
			new PdiProperties.Admin("admin", "x"), new PdiProperties.OrganismoInicial(null, null, null),
			new PdiProperties.Simulacion(ModoSimulacion.NORMAL, 0)));

	@Test
	void arrancaConLaConfiguracionInicial() {
		assertThat(service.configuracion()).isEqualTo(new ConfiguracionSimulacion(ModoSimulacion.NORMAL, 0));
		assertThatCode(service::aplicar).doesNotThrowAnyException();
	}

	@Test
	void enModoCaidoLanzaServicioNoDisponible() {
		service.configurar(new ConfiguracionSimulacion(ModoSimulacion.CAIDO, 0));

		assertThatThrownBy(service::aplicar).isInstanceOf(PdiNoDisponibleException.class);
	}

	@Test
	void enModoLentoDemoraLaLatenciaConfigurada() {
		service.configurar(new ConfiguracionSimulacion(ModoSimulacion.LENTO, 200));

		long inicio = System.nanoTime();
		service.aplicar();
		long transcurridoMs = (System.nanoTime() - inicio) / 1_000_000;

		assertThat(transcurridoMs).isGreaterThanOrEqualTo(190);
	}

	@Test
	void rechazaConfiguracionInvalida() {
		assertThatThrownBy(() -> new ConfiguracionSimulacion(null, 0)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new ConfiguracionSimulacion(ModoSimulacion.LENTO, -1))
			.isInstanceOf(IllegalArgumentException.class);
	}

}
