package uy.carga.pdi.simulacion;

import org.springframework.ws.soap.server.endpoint.annotation.FaultCode;
import org.springframework.ws.soap.server.endpoint.annotation.SoapFault;

@SoapFault(faultCode = FaultCode.SERVER, faultStringOrReason = "Servicio no disponible")
public class PdiNoDisponibleException extends RuntimeException {

	public PdiNoDisponibleException() {
		super("Servicio no disponible (simulación)");
	}

}
