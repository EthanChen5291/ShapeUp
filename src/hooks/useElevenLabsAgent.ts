'use client';

import { useRef } from 'react';

const VOICE_ID = 'IKne3meq5aSn9XLyUdCD';
const API_KEY  = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;

export function useElevenLabsAgent(
  onTranscript: (text: string) => void,
) {
  const activeRef = useRef(false);

  async function speak(_text: string) {
    // ElevenLabs TTS is currently disabled — no-op
    if (!API_KEY) return;
  }

  function listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
      const rec = new SR();
      let transcript = '';
      rec.onresult = (e: any) => {
        transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(' ');
      };
      rec.onend = () => resolve(transcript);
      rec.onerror = (e: any) => {
        if (e.error === 'no-speech') resolve('');
        else reject(e);
      };
      rec.start();
    });
  }

  async function loop() {
    await speak("How would you like to style your hair today?");
    while (activeRef.current) {
      const feedback = await listen();
      console.log('[ElevenLabs] feedback:', feedback);
      if (!activeRef.current) break;
      if (feedback.trim()) onTranscript(feedback);
      await speak("Got it! Updating your hairstyle now.");
    }
  }

  return {
    start() { if (!API_KEY) return; activeRef.current = true; loop(); },
    stop()  { activeRef.current = false; },
  };
}
