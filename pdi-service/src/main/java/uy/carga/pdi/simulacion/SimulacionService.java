package uy.carga.pdi.simulacion;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import uy.carga.pdi.config.PdiProperties;

/**
 * Simulación de fallas de la PDI, para probar timeouts, reintentos y circuit breaker del componente central
 * (escenario "la PDI no responde"). Solo afecta a las operaciones DNIC, nunca a la administración.
 * <p>
 * El estado vive en memoria a propósito: es una herramienta de prueba de un mock y vuelve al valor configurado
 * al reiniciar. Si se levantan varias réplicas, hay que configurar cada una.
 */
@Service
public class SimulacionService {

	private static final Logger log = LoggerFactory.getLogger(SimulacionService.class);

	private volatile ConfiguracionSimulacion configuracion;

	public SimulacionService(PdiProperties properties) {
		this.configuracion = new ConfiguracionSimulacion(properties.simulacion().modo(),
				properties.simulacion().latenciaMs());
	}

	public ConfiguracionSimulacion configuracion() {
		return configuracion;
	}

	public ConfiguracionSimulacion configurar(ConfiguracionSimulacion nueva) {
		this.configuracion = nueva;
		log.info("Simulación configurada: modo={}, latenciaMs={}", nueva.modo(), nueva.latenciaMs());
		return nueva;
	}

	/** Aplica la simulación vigente antes de atender una operación DNIC. */
	public void aplicar() {
		ConfiguracionSimulacion actual = this.configuracion;
		switch (actual.modo()) {
			case NORMAL -> {
			}
			case LENTO -> esperar(actual.latenciaMs());
			case CAIDO -> throw new PdiNoDisponibleException();
		}
	}

	private void esperar(long latenciaMs) {
		try {
			Thread.sleep(latenciaMs);
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
		}
	}

}
