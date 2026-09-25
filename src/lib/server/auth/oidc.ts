import * as client from 'openid-client';
import { env } from '$env/dynamic/private';

let cached: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
	if (!cached) {
		cached = await client.discovery(
			new URL(env.OIDC_ISSUER),
			env.OIDC_CLIENT_ID,
			env.OIDC_CLIENT_SECRET
		);
	}
	return cached;
}

export async function buildLoginUrl() {
	const config = await getOidcConfig();
	const codeVerifier = client.randomPKCECodeVerifier();
	const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
	const state = client.randomState();

	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: `${env.ORIGIN}/auth/callback`,
		// Aus der Konfiguration, damit die App nicht an einen Anbieter gebunden ist:
		// manche liefern den Anzeigenamen nur bei einem abweichenden Scope.
		scope: env.OIDC_SCOPES || 'openid profile email',
		code_challenge: codeChallenge,
		code_challenge_method: 'S256',
		state
	});

	return { url: url.href, codeVerifier, state };
}

export async function exchangeCode(currentUrl: URL, codeVerifier: string, state: string) {
	const config = await getOidcConfig();
	const tokens = await client.authorizationCodeGrant(config, currentUrl, {
		pkceCodeVerifier: codeVerifier,
		expectedState: state
	});
	const claims = tokens.claims();
	if (!claims?.sub) throw new Error('ID-Token ohne sub');
	return {
		sub: claims.sub,
		email: (claims.email as string | undefined) ?? '',
		name:
			(claims.name as string | undefined) ?? (claims.preferred_username as string | undefined) ?? 'Unbekannt'
	};
}
