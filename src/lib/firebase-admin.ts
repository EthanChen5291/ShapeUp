import admin from 'firebase-admin';

function getApp() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      storageBucket: 'hackprinceton-shapeup.firebasestorage.app',
    });
  }
  return admin.app();
}

export function getDb() { getApp(); return admin.firestore(); }
export function getBucket() { getApp(); return admin.storage().bucket(); }
export const FieldValue = admin.firestore.FieldValue;

// Uploads a buffer and returns a permanent Firebase Storage download URL
// in the same format as the client SDK's getDownloadURL().
export async function uploadAndGetUrl(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const token = crypto.randomUUID();
  const file = getBucket().file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const encodedPath = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${getBucket().name}/o/${encodedPath}?alt=media&token=${token}`;
}
