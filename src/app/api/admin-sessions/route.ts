import { NextResponse } from 'next/server';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function GET() {
  try {
    const q = query(collection(db, 'session'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);

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
