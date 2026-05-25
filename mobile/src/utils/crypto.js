import * as Crypto from 'expo-crypto';

export async function sha256(str) {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    str
  );
}
