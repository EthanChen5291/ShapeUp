// Spanish (Español) translations, keyed by the English source string.
// Keep keys byte-for-byte identical to the English text passed to t().
// Use {name} placeholders for interpolated values.

export const es: Record<string, string> = {
  // ── Generic / shared ──
  'Save': 'Guardar',
  'Saved': 'Guardado',
  'Cancel': 'Cancelar',
  'Edit': 'Editar',
  'Delete': 'Eliminar',
  'Export': 'Exportar',
  'Sign in': 'Iniciar sesión',
  'Sign up': 'Registrarse',
  'Sign out': 'Cerrar sesión',
  'Log out': 'Cerrar sesión',
  'Continue': 'Continuar',
  'Back': 'Atrás',
  'Next': 'Siguiente',
  'Done': 'Listo',
  'Close': 'Cerrar',
  'Loading…': 'Cargando…',
  'Something went wrong': 'Algo salió mal',
  'Something went wrong. Please try again.': 'Algo salió mal. Inténtalo de nuevo.',

  // ── Profile menu / nav ──
  'Settings': 'Configuración',
  'Home': 'Inicio',
  'Dashboard': 'Panel',
  'Rescan': 'Reescanear',
  'Pricing': 'Precios',
  'Contact': 'Contacto',
  'Account': 'Cuenta',
  'Credits': 'Créditos',

  // ── Settings: sign-in gate ──
  'Sign in to manage your account, appearance, render quality, and privacy settings.':
    'Inicia sesión para administrar tu cuenta, apariencia, calidad de renderizado y configuración de privacidad.',

  // ── Settings: Account ──
  'Your public display name': 'Tu nombre público para mostrar',
  'your username': 'tu nombre de usuario',

  // ── Settings: Appearance ──
  'Appearance': 'Apariencia',
  'Theme for the app interface': 'Tema de la interfaz de la aplicación',
  'Light': 'Claro',
  'System': 'Sistema',
  'Dark': 'Oscuro',

  // ── Settings: Render Quality ──
  'Render Quality': 'Calidad de renderizado',
  'How sharply hairstyles render': 'Qué tan nítidos se renderizan los peinados',
  'Performance': 'Rendimiento',
  'Lighter render, faster on any device': 'Renderizado ligero, más rápido en cualquier dispositivo',
  'Balanced': 'Equilibrado',
  'Default — looks great on most screens': 'Predeterminado: se ve genial en la mayoría de las pantallas',
  'High': 'Alta',
  '3× pass render for maximum hair definition': 'Renderizado de 3 pasadas para la máxima definición del cabello',

  // ── Settings: Language ──
  'Language': 'Idioma',
  'App display language': 'Idioma de la aplicación',
  'English': 'English',
  'Español': 'Español',

  // ── Settings: 3D Scan ──
  '3D Scan': 'Escaneo 3D',
  'Rebuild your 3D head model from a new photo.': 'Reconstruye tu modelo 3D de cabeza con una nueva foto.',

  // ── Settings: Privacy & Data ──
  'Privacy & Data': 'Privacidad y datos',
  'Improve ShapeUp': 'Mejorar ShapeUp',
  'We use your information to enhance our user experience.':
    'Usamos tu información para mejorar la experiencia de usuario.',
  'Biometric consent': 'Consentimiento biométrico',
  'not granted': 'no otorgado',
  "What's that?": '¿Qué es eso?',
  'Revoke consent': 'Revocar consentimiento',
  'Consent revoked. Your facial scans have been deleted.':
    'Consentimiento revocado. Tus escaneos faciales han sido eliminados.',
  "This is your go-ahead for us to turn your selfie into a personal 3D head model — the magic that lets you try on cuts and see how they actually sit on you. Your scan stays yours: kept private and just for your models. You can revoke this anytime and we'll delete it. One heads-up — once you revoke, state law means we can't build any new models for you.":
    'Esta es tu autorización para que convirtamos tu selfie en un modelo 3D personal de tu cabeza, la magia que te permite probarte cortes y ver cómo te quedan de verdad. Tu escaneo sigue siendo tuyo: se mantiene privado y solo para tus modelos. Puedes revocarlo en cualquier momento y lo eliminaremos. Un aviso: una vez que lo revoques, la ley estatal implica que no podremos crear nuevos modelos para ti.',
  'Download my data': 'Descargar mis datos',
  'Export your account info as JSON (GDPR / CCPA).':
    'Exporta la información de tu cuenta como JSON (GDPR / CCPA).',
  'Delete account': 'Eliminar cuenta',
  'Permanently removes your data. This cannot be undone.':
    'Elimina tus datos de forma permanente. Esto no se puede deshacer.',
  'Confirm delete': 'Confirmar eliminación',
  'All scans, projects, and your account will be deleted.':
    'Se eliminarán todos los escaneos, proyectos y tu cuenta.',
  'policy': 'política',
  'Spanish': 'Español',

  // ── Tokens / profile menu ──
  'Tokens': 'Fichas',
  '{plan} plan': 'Plan {plan}',
  'Get more tokens': 'Obtener más fichas',
  'Refer a friend for': 'Invita a un amigo por',
  '6 tokens': '6 fichas',
  'REDEEM A CODE': 'CANJEAR UN CÓDIGO',
  'Redeem': 'Canjear',
  'Show my barber a 360°': 'Mostrar a mi barbero un 360°',

  // ── Dashboard popups ──
  'Scan now!': '¡Escanea ahora!',
  'Drop in the chair and start styling yourself in 3D!':
    '¡Siéntate en la silla y empieza a peinarte en 3D!',
  'Take Picture': 'Tomar foto',
  "You've hit the limit of {max} cuts. Delete one to make room for a fresh style.":
    'Has alcanzado el límite de {max} cortes. Elimina uno para hacer espacio para un nuevo estilo.',
  'Got it': 'Entendido',

  // ── Referral popup ──
  'Refer a friend': 'Invita a un amigo',
  'Get': 'Obtén',
  'together': 'juntos',
  'Share your invite link. When a friend signs up and completes their first scan, you both get 3 tokens — 6 in total. There’s no limit, so invite as many friends as you like.':
    'Comparte tu enlace de invitación. Cuando un amigo se registra y completa su primer escaneo, ambos reciben 3 fichas: 6 en total. No hay límite, así que invita a todos los amigos que quieras.',
  'Your invite link': 'Tu enlace de invitación',
  'Generating your link…': 'Generando tu enlace…',
  'Copied': 'Copiado',
  'Copy': 'Copiar',

  // ── Reuse scan popup ──
  'New project': 'Nuevo proyecto',
  'Start from your saved scan, or take a fresh selfie.':
    'Empieza desde tu escaneo guardado o toma una nueva selfie.',
  'Setting up…': 'Configurando…',
  'Use my selfie': 'Usar mi selfie',
  'Take a new selfie': 'Tomar una nueva selfie',
  'Reusing your scan is free — no token spent.':
    'Reutilizar tu escaneo es gratis: no se gasta ninguna ficha.',

  // ── Delete confirm ──
  'Delete this cut?': '¿Eliminar este corte?',
  'Are you sure you want to delete': '¿Seguro que quieres eliminar',
  'No, keep it': 'No, consérvalo',
  'Yes, delete': 'Sí, eliminar',

  // ── Titles / nav ──
  'My': 'Mis',
  'Cuts': 'Cortes',
  'Saved##title': 'Guardados',
  'home': 'inicio',
  'saved': 'guardados',
  'explore': 'explorar',
  'settings': 'ajustes',
  'all': 'todos',
  'recent': 'recientes',
  'find a style...': 'busca un estilo...',
  'Scan now': 'Escanea ahora',
  'new cut': 'nuevo corte',
  'Browse my cuts': 'Ver mis cortes',
  'your keepers go here': 'tus favoritos van aquí',
  'Nothing pinned yet. Tap the bookmark on any cut and it lands on this wall.':
    'Aún no has fijado nada. Toca el marcador en cualquier corte y aparecerá en este muro.',
  'sign in to see your keepers': 'inicia sesión para ver tus favoritos',
  'Your saved cuts live here. Sign in to bookmark styles and build your collection.':
    'Tus cortes guardados viven aquí. Inicia sesión para marcar estilos y crear tu colección.',
  'Pick a cut to show your barber a 360°': 'Elige un corte para mostrar a tu barbero un 360°',
  'Style it': 'Estilízalo',
  'you': 'tú',

  // ── Scan result / ScanResultPopup ──
  'Your scan': 'Tu escaneo',

  // ── Scan popup ──
  'Analyzing your look...': 'Analizando tu aspecto...',
  'Please allow up to 2 minutes while we build your 3D model':
    'Espera hasta 2 minutos mientras creamos tu modelo 3D',
  'Unknown error': 'Error desconocido',
  'Try again': 'Intentar de nuevo',
  'Retake photo': 'Volver a tomar la foto',
  "Let's meet you": 'Conozcámonos',
  'Take a selfie!': '¡Toma una selfie!',
  'Close scan dialog': 'Cerrar el diálogo de escaneo',
  'Set up!': '¡Configura!',
  'Choose a username': 'Elige un nombre de usuario',
  'Letters, numbers, and underscores only.': 'Solo letras, números y guiones bajos.',
  'e.g. freshcuts_mike': 'p. ej. freshcuts_mike',
  'Saving…': 'Guardando…',
  'Retake': 'Repetir',
  'Proceed': 'Continuar',
  'Make this your main selfie?': '¿Hacer esta tu selfie principal?',
  'Your main selfie is the one new projects start from. You can keep your current one if you prefer.':
    'Tu selfie principal es la base de los nuevos proyectos. Puedes conservar la actual si lo prefieres.',
  'No': 'No',
  'Yes': 'Sí',
  'the looking glass': 'el espejo',

  // ── Build phrases (processing) ──
  'Building model': 'Construyendo modelo',
  'Drawing blueprint': 'Dibujando plano',
  'Mapping your features': 'Mapeando tus rasgos',
  'Sculpting in 3D': 'Esculpiendo en 3D',
  'Tracing every angle': 'Trazando cada ángulo',
  'Shaping the geometry': 'Dando forma a la geometría',
  'Adding depth': 'Añadiendo profundidad',
  'Refining the mesh': 'Refinando la malla',
  'Smoothing the surface': 'Suavizando la superficie',
  'Polishing details': 'Puliendo detalles',
  'Aligning the lighting': 'Alineando la iluminación',
  'Almost there': 'Casi listo',

  // ── Live checklist ──
  'The barber’s checklist': 'La lista del barbero',
  'One face in frame': 'Un rostro en el encuadre',
  'Arm’s length away': 'A un brazo de distancia',
  'Facing forward': 'Mirando al frente',
  'Good, even light': 'Buena luz uniforme',
  'Holding still': 'Sin moverte',
  'Sit against a plain, solid-color wall with no bright window or lamp behind your head — it keeps your hair sharp for the 3D model!':
    'Colócate frente a una pared lisa de color sólido, sin ventanas brillantes ni lámparas detrás de tu cabeza: así tu cabello se mantiene nítido para el modelo 3D.',

  // ── Pricing page ──
  'back': 'volver',
  'pricing': 'precios',
  'See yourself in the cut before you sit in the chair.':
    'Mírate con el corte antes de sentarte en la silla.',
  'avg barber visit': 'visita promedio al barbero',
  '1 AI look': '1 estilo con IA',
  'popular': 'popular',
  'one-time purchase · no subscription · secured by stripe':
    'compra única · sin suscripción · protegido por stripe',
  'Free': 'Gratis',
  'Starter': 'Inicial',
  'Popular': 'Popular',
  'Pro': 'Pro',
  'forever': 'para siempre',
  'one-time': 'pago único',
  'Prebaked styles': 'Estilos prediseñados',
  '8 AI looks': '8 estilos con IA',
  '30 AI looks': '30 estilos con IA',
  '100 AI looks': '100 estilos con IA',
  'Start free': 'Empezar gratis',
  'Try 8 looks': 'Probar 8 estilos',
  'Get 30 looks': 'Obtener 30 estilos',
  'Get 100 looks': 'Obtener 100 estilos',
  'Browse 30+ expert-curated styles rendered on your 3D scan — no generation needed, no cost ever.':
    'Explora más de 30 estilos seleccionados por expertos renderizados en tu escaneo 3D: sin generación, sin costo nunca.',
  '8 custom renders. Enough to test a fade, a crop, and a taper before your next appointment.':
    '8 renders personalizados. Suficiente para probar un fade, un crop y un taper antes de tu próxima cita.',
  '30 looks to explore. Find what works for your face shape, then walk in with a reference photo.':
    '30 estilos para explorar. Encuentra lo que va con tu rostro y llega con una foto de referencia.',
  'Serious about your hair. 100 looks at 15¢ each — experiment until you find a signature style.':
    'En serio con tu cabello. 100 estilos a 15¢ cada uno: experimenta hasta encontrar tu estilo distintivo.',

  // ── Landing page ──
  'dashboard': 'panel',
  'Free to try · No credit card · 3D preview in ~60 sec':
    'Gratis para probar · Sin tarjeta de crédito · Vista 3D en ~60 seg',
  'see it first.': 'míralo primero.',
  'love': 'ámalo',
  'it more.': 'aún más.',
  'Take one selfie. See 10+ haircuts on your actual 3D face.':
    'Toma una selfie. Mira más de 10 cortes en tu rostro 3D real.',
  'Walk into the barber knowing exactly what you want.':
    'Llega al barbero sabiendo exactamente lo que quieres.',
  'sound familiar?': '¿te suena familiar?',
  'You describe it.': 'Tú lo describes.',
  'They hear something different.': 'Ellos entienden algo distinto.',
  'You walk out of the barber disappointed — not because your barber was bad, but because there was no way to show exactly what you meant.':
    'Sales del barbero decepcionado, no porque tu barbero fuera malo, sino porque no había forma de mostrar exactamente lo que querías.',
  '~6 weeks': '~6 semanas',
  'to grow back a bad cut': 'para que crezca un mal corte',
  'A bad cut takes time to go away. Hair grows about half an inch a month.':
    'Un mal corte tarda en desaparecer. El cabello crece alrededor de un centímetro al mes.',
  '$45+ a visit': '$45+ por visita',
  'no preview, full commitment': 'sin vista previa, compromiso total',
  'You bind yourself to paying before you see anything, with no refunds :(':
    'Te comprometes a pagar antes de ver nada, sin reembolsos :(',
  '1 in 3': '1 de cada 3',
  "leave wishing they'd said more": 'se van deseando haber dicho más',
  "The cut isn't what you wanted. Yet you stay quiet in the chair.":
    'El corte no es el que querías. Aun así te quedas callado en la silla.',
  'We show you how any hairstyle looks on your face. Then, we give your barber the steps to make it happen.':
    'Te mostramos cómo se ve cualquier peinado en tu rostro. Luego le damos a tu barbero los pasos para lograrlo.',
  '60 secs': '60 seg',
  'SCAN TO 3D PREVIEW': 'DEL ESCANEO A LA VISTA 3D',
  'Just one minute from selfie to full 3D model.':
    'Solo un minuto de la selfie al modelo 3D completo.',
  '1 selfie': '1 selfie',
  'ALL YOU NEED': 'TODO LO QUE NECESITAS',
  'One photo is all it takes. Help us secure the best cut for you.':
    'Basta una foto. Ayúdanos a conseguir el mejor corte para ti.',
  '$2': '$2',
  'FOR 8 HAIRSTYLES': 'POR 8 PEINADOS',
  'Less than a coffee to see yourself in 8 different cuts.':
    'Menos que un café para verte en 8 cortes diferentes.',
  'how it': 'cómo',
  'works': 'funciona',
  'This demo is live — send a message and try it yourself.':
    'Esta demostración está en vivo: envía un mensaje y pruébalo tú mismo.',
  'Selfie': 'Selfie',
  '30 seconds': '30 segundos',
  'just one selfie': 'solo una selfie',
  'Describe': 'Describe',
  'text it like a friend': 'escríbelo como a un amigo',
  'tap send — step 3 updates live': 'toca enviar — el paso 3 se actualiza en vivo',
  'Show your barber': 'Muéstrale a tu barbero',
  'your 3D preview, live': 'tu vista 3D, en vivo',
  'Ready to see your next cut?': '¿Listo para ver tu próximo corte?',
  "Preview My Cut — It's Free": 'Ver mi corte — Es gratis',
  'takes about 60 seconds · no account required':
    'toma unos 60 segundos · no requiere cuenta',
  'Get a glimpse of all': 'Vislumbra todo lo que',
  'could be.': 'podrías ser.',
  'clean & sharp': 'limpio y definido',
  'textured top': 'parte superior texturizada',
  'volume & flow': 'volumen y movimiento',
  'low maintenance': 'bajo mantenimiento',
  'effortless cool': 'estilo sin esfuerzo',
  'versatile classic': 'clásico versátil',
  '1 haircut generation': '1 generación de corte',
  '8 haircut generations': '8 generaciones de corte',
  '30 haircut generations': '30 generaciones de corte',
  '100 haircut generations': '100 generaciones de corte',
  'Explorer': 'Explorador',
  'Pick your style.': 'Elige tu estilo.',
  'Try It Free — No Card Needed': 'Pruébalo gratis — Sin tarjeta',
  'takes about 60 seconds': 'toma unos 60 segundos',
  'Your photo stays private': 'Tu foto se mantiene privada',
  'We never sell or share your scan. Delete your data anytime from settings.':
    'Nunca vendemos ni compartimos tu escaneo. Elimina tus datos cuando quieras desde la configuración.',
  'AI trained on real cuts': 'IA entrenada con cortes reales',
  '3D facial mesh and strand-level simulation built from real barbershop styles.':
    'Malla facial 3D y simulación a nivel de mechón creadas a partir de estilos reales de barbería.',
  'Free to try, no risk': 'Gratis para probar, sin riesgo',
  'Your first previews are completely free. Pay only if you love the results.':
    'Tus primeras vistas previas son totalmente gratis. Paga solo si te encantan los resultados.',
  'Privacy': 'Privacidad',
  'Terms': 'Términos',
  'Biometric notice': 'Aviso biométrico',
  'Delete my data': 'Eliminar mis datos',
  'create your account': 'crea tu cuenta',
  'sign in to purchase': 'inicia sesión para comprar',
  'Start exploring.': 'Empieza a explorar.',
  'One step away.': 'A un paso.',

  // ── SignUpWidget (auth) ──
  'Go to dashboard': 'Ir al panel',
  'Check your inbox': 'Revisa tu bandeja de entrada',
  'We sent a 6-digit code to {email}': 'Enviamos un código de 6 dígitos a {email}',
  'Verify': 'Verificar',
  'Verifying…': 'Verificando…',
  'Two-factor authentication': 'Autenticación de dos factores',
  'Enter the code sent to your phone': 'Ingresa el código enviado a tu teléfono',
  'Enter the code sent to {email}': 'Ingresa el código enviado a {email}',
  'One sec…': 'Un momento…',
  'Continue with email': 'Continuar con correo',
  'or': 'o',
  'Continue with Google': 'Continuar con Google',
  'password': 'contraseña',
  'Free to start · No credit card · By continuing, you agree to the':
    'Gratis para empezar · Sin tarjeta de crédito · Al continuar, aceptas los',
  'and': 'y',
  'Privacy Policy': 'Política de privacidad',
  // auth error messages (translated at render via t(error))
  'Sign-in is not configured for this deployment.':
    'El inicio de sesión no está configurado para esta implementación.',
  'Sign-in is still loading. Try again in a moment.':
    'El inicio de sesión aún se está cargando. Inténtalo de nuevo en un momento.',
  'Wrong password — try again.': 'Contraseña incorrecta: inténtalo de nuevo.',
  'This password was found in a data breach. Please choose a different one.':
    'Esta contraseña apareció en una filtración de datos. Elige una diferente.',
  'This account was created with Google. Use "Continue with Google" to sign in.':
    'Esta cuenta se creó con Google. Usa "Continuar con Google" para iniciar sesión.',
  'Your account has been suspended. Contact support for help.':
    'Tu cuenta ha sido suspendida. Contacta a soporte para obtener ayuda.',
  'Too many attempts — please wait a moment and try again.':
    'Demasiados intentos: espera un momento e inténtalo de nuevo.',
  "You're already signed in.": 'Ya has iniciado sesión.',
  'Please enter both your email and password.':
    'Ingresa tu correo y tu contraseña.',
  'No account found with that email.':
    'No se encontró ninguna cuenta con ese correo.',
  'Sign-in incomplete — please try again.':
    'Inicio de sesión incompleto: inténtalo de nuevo.',
  'Sign-up failed — please try again.':
    'El registro falló: inténtalo de nuevo.',
  'Password is too weak — use at least 8 characters with a mix of letters and numbers.':
    'La contraseña es demasiado débil: usa al menos 8 caracteres con una mezcla de letras y números.',
  'An account with this email already exists. Try signing in instead.':
    'Ya existe una cuenta con este correo. Intenta iniciar sesión.',
  'Invalid code — try again': 'Código inválido: inténtalo de nuevo',
  'Verification failed — please try again.':
    'La verificación falló: inténtalo de nuevo.',
  'Google sign-in failed': 'Error al iniciar sesión con Google',

  // ── PricingPopup ──
  'out of tokens': 'sin fichas',
  'top up your cuts': 'recarga tus cortes',
  'Get more to keep the fresh cuts coming.':
    'Consigue más para seguir con los cortes frescos.',

  // ── Studio ──
  'Error — check console': 'Error — revisa la consola',
  'Building your 3D model…': 'Construyendo tu modelo 3D…',
  'We infer shape, hairline & proportions from your photos — a great likeness, not a measurement.':
    'Inferimos la forma, la línea del cabello y las proporciones a partir de tus fotos: un gran parecido, no una medición.',
  'The barber’s': 'Del barbero',
  'Toolbox': 'Caja de herramientas',
  'new request': 'nueva solicitud',
  'Render in 3D': 'Renderizar en 3D',
  'Voice': 'Voz',
  'Enter your desired hairstyle in the toolbox!':
    '¡Escribe el peinado que deseas en la caja de herramientas!',
  'Hair Parameters': 'Parámetros del cabello',
  'Hair length': 'Largo del cabello',
  'Width': 'Ancho',
  'Ponytail-ness': 'Nivel de coleta',
  'Density': 'Densidad',
  'Wavyness': 'Ondulación',
  'Parting': 'Raya',
  'live measurements': 'medidas en vivo',
  'auto': 'auto',
  'take it to your barber': 'llévaselo a tu barbero',
  'Barber’s order': 'Orden del barbero',
  'preset': 'preajuste',
  'type': 'tipo',
  'Project not found': 'Proyecto no encontrado',
  'the toolbox': 'la caja de herramientas',
  'THE': 'EL',
  'studio': 'estudio',
  'live · 3d sculpt': 'en vivo · escultura 3d',
  'Rendering your barber video': 'Renderizando tu video de barbero',
  'Hide photo': 'Ocultar foto',
  'Show photo': 'Mostrar foto',

  // ── EditPanel (toolbox) ──
  'Apply': 'Aplicar',
  'Apply hair edit request': 'Aplicar solicitud de edición de cabello',
  'Hair editor controls': 'Controles del editor de cabello',
  'Styling…': 'Estilizando…',
  'Rendering…': 'Renderizando…',
  'FRESH CUT': 'CORTE FRESCO',
  'shapeup approved': 'aprobado por shapeup',
  'oops': 'ups',
  'More trending cuts': 'Más cortes en tendencia',
  'Sketching the cut progress': 'Progreso del bosquejo del corte',
  'Sculpting in 3D progress': 'Progreso del esculpido en 3D',
  // prompt placeholders
  '"Messy taper fade, please."': '"Un taper fade despeinado, por favor."',
  '"Take the sides down to a #2."': '"Baja los lados a un #2."',
  '"Keep the length, just add texture."': '"Conserva el largo, solo añade textura."',
  '"Mid fade, clean line-up."': '"Mid fade, perfilado limpio."',
  '"Curly on top, skin fade sides."': '"Rizado arriba, skin fade a los lados."',
  // chatter — gemini
  'Sketching the cut…': 'Bosquejando el corte…',
  'Reading your curl pattern…': 'Leyendo tu patrón de rizos…',
  'Combing through the details…': 'Repasando los detalles…',
  'Eyeballing the blend…': 'Calibrando el degradado…',
  // chatter — hairstep
  'Sculpting it in 3D…': 'Esculpiéndolo en 3D…',
  'Setting every strand…': 'Colocando cada mechón…',
  'Spinning the chair around…': 'Girando la silla…',
  'Holding up the mirror…': 'Levantando el espejo…',
};
