package uy.carga.pdi.dnic;

import uy.carga.pdi.persona.Persona;

/** Resultado de una consulta: o trae la persona, o trae el error. */
public record ResultadoConsulta(int idSolicitud, int idRespuesta, Persona persona, CodigoMensaje error) {

	public static ResultadoConsulta exito(int idSolicitud, int idRespuesta, Persona persona) {
		return new ResultadoConsulta(idSolicitud, idRespuesta, persona, null);
	}

	public static ResultadoConsulta error(int idSolicitud, int idRespuesta, CodigoMensaje error) {
		return new ResultadoConsulta(idSolicitud, idRespuesta, null, error);
	}

	public boolean esExito() {
		return error == null;
	}

}
