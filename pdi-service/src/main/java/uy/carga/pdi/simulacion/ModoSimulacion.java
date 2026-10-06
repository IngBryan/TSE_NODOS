package uy.carga.pdi.simulacion;

public enum ModoSimulacion {

	/** Responde normalmente. */
	NORMAL,

	/** Espera la latencia configurada antes de responder (para que el central llegue a su timeout). */
	LENTO,

	/** Responde de inmediato con un SOAP Fault de servidor (servicio no disponible). */
	CAIDO

}
