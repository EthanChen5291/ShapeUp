# make the camera smoother (smooth lerp + less movement per mouse dx/dy)

# if nothing changes, get barber summary returns "No change"

What was set up
Stack: Next.js 15 + TypeScript + Tailwind + react-three-fiber + Gemini API

Ethan (LLM Pipeline / UI)
File	What to do
src/hooks/useLLM.ts	Hook is wired — copy .env.local.example → .env.local and add GEMINI_API_KEY
src/app/api/edit/route.ts	Gemini edit endpoint. Swap model: string only after product review
src/components/EditPanel.tsx	
Prompt input + sliders + undo/redo stack — extend the UI here

Coco (Three.js / Edit Loop)
File	What to do
src/components/HairScene.tsx	Placeholder sphere/boxes already respond to all 5 params. Swap in .glb using the useGLTF stub at the bottom. Name mesh groups Hair_Top, Hair_Side*, Hair_Back
src/components/HairScene.tsx:104	updateHairMesh(scene, params) — call this after loading the .glb to drive mesh scales
public/models/	Drop .glb files here
Shared contract (do not change without team sync)
src/types/index.ts — UserHeadProfile, HairParams, LLMEditResponse
src/data/mockProfile.ts — mock data + preset library
src/lib/llmPrompt.ts — LLM system prompt + few-shot examples
To run: npm run dev → http://localhost:3000
