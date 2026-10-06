package uy.carga.pdi.admin;

import org.springframework.ws.soap.server.endpoint.annotation.FaultCode;
import org.springframework.ws.soap.server.endpoint.annotation.SoapFault;

@SoapFault(faultCode = FaultCode.CLIENT)
public class RecursoDuplicadoException extends RuntimeException {

	public RecursoDuplicadoException(String mensaje) {
		super(mensaje);
	}

}
