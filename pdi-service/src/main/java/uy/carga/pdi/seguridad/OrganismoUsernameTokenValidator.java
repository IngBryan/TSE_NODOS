package uy.carga.pdi.seguridad;

import org.apache.wss4j.common.ext.WSSecurityException;
import org.apache.wss4j.dom.handler.RequestData;
import org.apache.wss4j.dom.message.token.UsernameToken;
import org.apache.wss4j.dom.validate.UsernameTokenValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.ws.context.MessageContext;
import uy.carga.pdi.organismo.OrganismoRepository;

/**
 * Valida el {@code wsse:UsernameToken} contra la tabla de organismos: Username = código del organismo,
 * Password (PasswordText) = su clave, que se compara contra el hash BCrypt.
 * <p>
 * PasswordDigest no se admite: para verificarlo hay que tener la clave en texto plano, y acá solo se guarda el hash.
 * La confidencialidad de la clave la da HTTPS.
 */
@Component
public class OrganismoUsernameTokenValidator extends UsernameTokenValidator {

	private static final Logger log = LoggerFactory.getLogger(OrganismoUsernameTokenValidator.class);

	private final OrganismoRepository organismoRepository;

	private final PasswordEncoder passwordEncoder;

	public OrganismoUsernameTokenValidator(OrganismoRepository organismoRepository, PasswordEncoder passwordEncoder) {
		this.organismoRepository = organismoRepository;
		this.passwordEncoder = passwordEncoder;
	}

	@Override
	protected void verifyPlaintextPassword(UsernameToken usernameToken, RequestData data) throws WSSecurityException {
		String codigo = usernameToken.getName();
		String clave = usernameToken.getPassword();
		boolean valido = codigo != null && clave != null && organismoRepository.findByCodigoAndActivoTrue(codigo)
			.map(organismo -> passwordEncoder.matches(clave, organismo.getClaveHash()))
			.orElse(false);
		if (!valido) {
			log.warn("UsernameToken rechazado para organismo={}", codigo);
			throw new WSSecurityException(WSSecurityException.ErrorCode.FAILED_AUTHENTICATION);
		}
		if (data.getMsgContext() instanceof MessageContext messageContext) {
			OrganismoAutenticado.guardar(messageContext, codigo);
		}
	}

	@Override
	protected void verifyDigestPassword(UsernameToken usernameToken, RequestData data) throws WSSecurityException {
		log.warn("UsernameToken con PasswordDigest rechazado (solo se admite PasswordText) organismo={}",
				usernameToken.getName());
		throw new WSSecurityException(WSSecurityException.ErrorCode.FAILED_AUTHENTICATION);
	}

}
