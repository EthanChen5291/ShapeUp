f## SCAN PHASE (runs once)

Camera input (video stream)

      ↓
      
MediaPipe FaceMesh → 468 landmarks (normalized coords)

MediaPipe Selfie Segmentation → hair mask

      ↓
      
Per-frame extraction:

  Face:

         landmark coords → head width, height, 
         
         crown position, ear anchors

         
  Hair:  
  
         silhouette measurements (crown_height, 
         
         side_width, back_length, top_flatness)
         
         + avg color RGB
         
         + texture roughness (frequency analysis 
         
           OR user input: straight/wavy/curly) -> discuss with bruno
           
      ↓
      
Aggregate across all frames → userHeadProfile {}

  {
  
    head_width, head_height, crown_y, ear_left, ear_right,
    
    hair_crown_height, hair_side_width, hair_back_length,
    
    hair_top_flatness, hair_color_rgb, hair_type
    
  }
  
      ↓
      
Convert normalized coords → Three.js scene units

      ↓
      
Deform canonical head mesh (pre-built .glb) 

to match head proportions







## RENDER PHASE (initial)


Select closest matching hair preset 

based on userHeadProfile measurements

      ↓
      
Scale + position hair mesh zones (top/sides/back)

to userHeadProfile params

      ↓
      
Apply hair color (mesh material color = hair_color_rgb)

      ↓
      
Mount head mesh + hair mesh → Three.js scene

OrbitControls (upper hemisphere only)






## EDIT LOOP (repeating)


User prompt

      ↓
      
LLM (Gemini 3.5 / Grok / Claude Haiku / GPT-4o mini) 

  context: userHeadProfile + current hair params
  
  output: {
  
            preset?, top_length, side_length, 
            back_length, messiness, taper }
            
      ↓
      
Update hair mesh params (no full re-render)

      ↓
      
Undo/redo stack (just store param snapshots)






## OUTPUT PHASE


Final params → LLM → barber summary string (need to analyze current userHeadProfile)

Copy / share button

