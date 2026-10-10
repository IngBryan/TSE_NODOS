package uy.carga.pdi.seguridad;

import org.springframework.ws.soap.server.endpoint.annotation.FaultCode;
import org.springframework.ws.soap.server.endpoint.annotation.SoapFault;

@SoapFault(faultCode = FaultCode.CLIENT)
public class WsAddressingRequeridoException extends RuntimeException {

	public WsAddressingRequeridoException(String mensaje) {
		super(mensaje);
	}

}
