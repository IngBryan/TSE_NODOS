package uy.carga.pdi.simulacion;

public record ConfiguracionSimulacion(ModoSimulacion modo, long latenciaMs) {

	public ConfiguracionSimulacion {
		if (modo == null) {
			throw new IllegalArgumentException("El modo de simulación es obligatorio");
		}
		if (latenciaMs < 0) {
			throw new IllegalArgumentException("La latencia no puede ser negativa");
		}
	}

}
