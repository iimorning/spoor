import { extractErrorMessage } from './errorMessage';

/** Map raw Supabase Auth error text onto i18n keys. */
export function mapAuthError(error: unknown, t: (key: string) => string): string {
  const message = typeof error === 'string' ? error : extractErrorMessage(error);
  if (!message || message === '[object Object]') {
    return t('cloud.syncError');
  }
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) {
    return t('cloud.errInvalidCredentials');
  }
  if (m.includes('email not confirmed')) {
    return t('cloud.errEmailNotConfirmed');
  }
  if (m.includes('user already registered')) {
    return t('cloud.errAlreadyRegistered');
  }
  if (m.includes('password') && (m.includes('at least') || m.includes('weak') || m.includes('6'))) {
    return t('cloud.errWeakPassword');
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return t('cloud.errRateLimit');
  }
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) {
    return t('cloud.errGoogleNotEnabled');
  }
  if (m.includes('oauth') || m.includes('unable to exchange')) {
    return t('cloud.errGoogleFailed');
  }
  return message;
}
