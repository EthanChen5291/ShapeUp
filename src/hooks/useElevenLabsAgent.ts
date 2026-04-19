'use client';

import { useRef } from 'react';

const VOICE_ID = 'FGY2WhTYpPnrIDTdsKH5';
const API_KEY  = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;

export function useElevenLabsAgent(
  onFeedback: (generatedImageUrl: string) => void,
) {
  const activeRef = useRef(false);

  async function speak(text: string) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.play();
    });
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
      const res = await fetch('/api/hair-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      console.log('[ElevenLabs] image response:', res);
      const { imageDataUrl: generated } = await res.json();
      if (generated) onFeedback(generated);
      await speak("Got it! Updating your hairstyle now.");
    }
  }

  return {
    start() { activeRef.current = true; loop(); },
    stop()  { activeRef.current = false; },
  };
}
