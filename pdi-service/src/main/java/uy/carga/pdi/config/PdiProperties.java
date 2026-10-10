package uy.carga.pdi.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import uy.carga.pdi.simulacion.ModoSimulacion;

/**
 * Configuración propia de la PDI simulada. Los secretos llegan por variables de entorno (ver .env.example).
 */
@Validated
@ConfigurationProperties("pdi")
public record PdiProperties(
		@Valid @NotNull Admin admin,
		@Valid @NotNull OrganismoInicial organismoInicial,
		@Valid @NotNull Simulacion simulacion,
		@Valid @NotNull WsSecurity wsSecurity) {

	/** Vigencia máxima aceptada para el wsu:Timestamp del header WS-Security. */
	public record WsSecurity(@Min(1) int timestampTtlSegundos) {
	}

	/** Credenciales HTTP Basic del servicio SOAP de administración. */
	public record Admin(@NotBlank String usuario, @NotBlank String password) {
	}

	/** Organismo que se crea al arrancar si no existe (p. ej. el componente central de carga.uy). Opcional. */
	public record OrganismoInicial(String codigo, String nombre, String clave) {

		public boolean configurado() {
			return codigo != null && !codigo.isBlank() && clave != null && !clave.isBlank();
		}
	}

	/** Estado inicial de la simulación de fallas. */
	public record Simulacion(@NotNull ModoSimulacion modo, @Min(0) long latenciaMs) {
	}

}
