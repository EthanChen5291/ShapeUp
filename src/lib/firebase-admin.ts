import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'hackprinceton-shapeup.firebasestorage.app',
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export const FieldValue = admin.firestore.FieldValue;

// Uploads a buffer and returns a permanent Firebase Storage download URL
// in the same format as the client SDK's getDownloadURL().
export async function uploadAndGetUrl(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const token = crypto.randomUUID();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const encodedPath = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
}
