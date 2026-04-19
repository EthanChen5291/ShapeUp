'use client';

import { HairParams, UserHeadProfile } from '@/types';

import EditPanel from '@/components/EditPanel';
import HairEditLoop from '@/components/HairEditLoop';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useSmirk } from '@/hooks/useSmirk';
import { useEffect, useState } from 'react';

const HairScene  = dynamic(() => import('@/components/HairScene'),  { ssr: false });
const ScanCamera = dynamic(() => import('@/components/ScanCamera'), { ssr: false });

type AppState = 'scan' | 'hairEditLoop' | '3d';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('scan');
  const [profile, setProfile]   = useState<UserHeadProfile | null>(null);
  const [params,  setParams]    = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [imageUrl,  setImageUrl]    = useState<string | null>(null);
  const [baldifiedDataUrl, setBaldifiedDataUrl] = useState<string | null>(null);
  const [faceliftPlyReady, setFaceliftPlyReady] = useState(false);
  const [hairstepPlyUrl, setHairstepPlyUrl]     = useState<string | null>(null);

  const smirk = useSmirk(profile?.faceScanData?.imageDataUrl);

  // Fire hairstep in the background once we have a session + captured image (~30–60s)
  useEffect(() => {
    const imageDataUrl = profile?.faceScanData?.imageDataUrl;
    if (!sessionId || !imageDataUrl) return;
    fetch('/api/hairstep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl, sessionId }),
    })
      .then(r => r.json())
      .then(data => { if (data.plyUrl) setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(data.plyUrl)}`); })
      .catch(() => {});
  }, [sessionId, profile]);

  const handleParamsChange = (next: HairParams) => {
    setParams(next);
    setProfile(prev => prev ? { ...prev, currentStyle: { ...prev.currentStyle, params: next } } : prev);
  };

  const handleScanComplete = (p: UserHeadProfile, sid: string | null, url: string | null) => {
    setProfile(p);
    setParams(p.currentStyle.params);
    if (sid && url) {
      setSessionId(sid);
      setImageUrl(url);
      setAppState('hairEditLoop');
    } else {
      // Fallback: no Firebase session — go straight to 3D
      setAppState('3d');
    }
  };

  if (appState === 'scan') {
    return (
      <main className="flex h-screen bg-gray-950 items-center justify-center">
        <div className="w-96">
          <ScanCamera
            hairType="straight"
            onScanComplete={handleScanComplete}
            onDismiss={() => {
              setProfile(mockUserHeadProfile);
              setAppState('3d');
            }}
          />
        </div>
      </main>
    );
  }

  if (appState === 'hairEditLoop' && sessionId && imageUrl) {
    return (
      <HairEditLoop
        sessionId={sessionId}
        initialImageUrl={imageUrl}
        onRenderIn3D={(dataUrl) => {
          setBaldifiedDataUrl(dataUrl);
          setFaceliftPlyReady(true);
          setAppState('3d');
        }}
        onHairstepPlyReady={(plyUrl) => {
          setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(plyUrl)}`);
        }}
      />
    );
  }

  // 3D scene fallback
  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="flex-1 relative">
        {imageUrl && (
          <div className="absolute top-3 left-3 z-10 rounded-xl overflow-hidden border-2 border-white/20 shadow-lg" style={{ width: 80, height: 80 }}>
            <img src={imageUrl} alt="scan" className="w-full h-full object-cover" />
          </div>
        )}
        <HairScene
          params={params}
          colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
          profile={profile ?? mockUserHeadProfile}
          autoFaceliftDataUrl={baldifiedDataUrl ?? undefined}
          faceliftPlyReady={faceliftPlyReady}
          hairstepPlyUrl={hairstepPlyUrl ?? undefined}
          flameData={
            smirk.result
              ? {
                  vertices: smirk.result.vertices_canonical,
                  faces: smirk.result.faces,
                }
              : undefined
          }
        />
      </div>

      <div className="w-72 border-l border-gray-800 flex-shrink-0 flex flex-col">
        <div className="p-3 border-b border-gray-800">
          <button
            onClick={() => setAppState('scan')}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 transition-colors"
          >
            📷 Rescan Face
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <EditPanel
            profile={profile ?? mockUserHeadProfile}
            onParamsChange={handleParamsChange}
            sessionId={sessionId}
            latestImageUrl={imageUrl}
            onImageUpdated={(url) => setImageUrl(url)}
            onPlyReady={(plyUrl) => setHairstepPlyUrl(`/api/proxy-ply?url=${encodeURIComponent(plyUrl)}`)}
          />
        </div>
      </div>
    </main>
  );
}
