import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

export async function GET() {
  try {
    const snapshot = await db.collection('session').orderBy('createdAt', 'desc').get();

    const sessions = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        images: data.images ?? [],
        hair_plys: data.hair_plys ?? [],
        hasHairPly: Array.isArray(data.hair_plys) && data.hair_plys.length > 0,
        currentProfile: data.currentProfile ?? null,
      };
    });

    return NextResponse.json({ sessions });
  } catch (err) {
    console.error('admin-sessions error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
