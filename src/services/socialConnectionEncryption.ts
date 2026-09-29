/**
 * Social Connections — encryption service.
 *
 * AES-GCM-256 via WebCrypto (browser, Node 18+ and edge compatible).
 * Envelope format: base64(iv) ':' base64(ciphertext || auth tag).
 *
 * Key management seam: in production the key comes from the server-only
 * SOCIAL_CONN_ENCRYPTION_KEY environment variable and lives only in the
 * server process; in demo mode a clearly-labelled development key is used so
 * the flow is testable without a backend. This module is the single place a
 * production KMS/HSM integration plugs in.
 */
import { randomToken } from '../domain/social';

const DEMO_KEY_LABEL = 'lockflow-dev-social-conn-key (demo only — not for production)';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export class SocialConnectionEncryptionService {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly serverSecret?: string) {}

  private key(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      const secret = this.serverSecret ?? DEMO_KEY_LABEL;
      this.keyPromise = importKey(secret);
    }
    return this.keyPromise;
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    );
    return `${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
  }

  async decrypt(envelope: string): Promise<string> {
    const key = await this.key();
    const [ivB64, dataB64] = envelope.split(':');
    if (!ivB64 || !dataB64) {
      throw new Error('Invalid encrypted envelope format.');
    }
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivB64) },
      key,
      fromBase64(dataB64),
    );
    return new TextDecoder().decode(plain);
  }

  /** Convenience wrapper for PKCE verifier storage. */
  encryptVerifier(verifier: string): Promise<string> {
    return this.encrypt(verifier);
  }

  decryptVerifier(envelope: string): Promise<string> {
    return this.decrypt(envelope);
  }

  /** Fresh URL-safe state token (plain value is returned once, never stored). */
  newStateToken(): string {
    return randomToken(32);
  }
}
