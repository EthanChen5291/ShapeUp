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
  'Includes {n} free/month · resets monthly, unused don\'t roll over': 'Incluye {n} gratis/mes · se reinicia cada mes, lo no usado no se acumula',
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
  '50 AI looks': '50 estilos con IA',
  '200 AI looks': '200 estilos con IA',
  'Start free': 'Empezar gratis',
  'Try 8 looks': 'Probar 8 estilos',
  'Get 50 looks': 'Obtener 50 estilos',
  'Get 200 looks': 'Obtener 200 estilos',
  'Browse 30+ expert-curated styles rendered on your 3D scan — no generation needed, no cost ever.':
    'Explora más de 30 estilos seleccionados por expertos renderizados en tu escaneo 3D: sin generación, sin costo nunca.',
  '8 custom renders for less than a buck. Test a fade, a crop, and a taper before your next appointment.':
    '8 renders personalizados por menos de un dólar. Prueba un fade, un crop y un taper antes de tu próxima cita.',
  '50 looks to explore. Find what works for your face shape, then walk in with a reference photo.':
    '50 estilos para explorar. Encuentra lo que va con tu rostro y llega con una foto de referencia.',
  'Serious about your hair. 200 looks at 7.5¢ each — experiment until you find a signature style.':
    'En serio con tu cabello. 200 estilos a 7.5¢ cada uno: experimenta hasta encontrar tu estilo distintivo.',

  // ── Free-for-limited-time mode ──
  'Status': 'Estado',
  'Limited time': 'Tiempo limitado',
  'limited time': 'tiempo limitado',
  'Every look is on the house for a limited time — try a fade, a crop, and a taper, all free.':
    'Cada look corre por cuenta de la casa por tiempo limitado: prueba un fade, un crop y un taper, todo gratis.',
  'Everything’s free right now — make as many looks as you like, on the house.':
    'Todo es gratis ahora mismo: crea todos los looks que quieras, por cuenta de la casa.',
  'ShapeUp is completely free!': '¡ShapeUp es completamente gratis!',
  'We believe everyone should be able to explore their hairstyles at no cost. Because it costs us some money to run, we may add options to donate, but no payment. Try on as many hairstyles as you want and tell us what you think!':
    'Creemos que todo el mundo debería poder explorar sus peinados sin coste alguno. Como mantenerlo nos cuesta algo de dinero, es posible que añadamos opciones para donar, pero nunca pagos obligatorios. ¡Prueba todos los peinados que quieras y dinos qué te parece!',

  // ── Phone-bonus ribbon + modal ──
  'Free generations offer': 'Oferta de generaciones gratis',
  'Add your phone number and get': 'Agrega tu número de teléfono y obtén',
  '{n} free generations': '{n} generaciones gratis',
  'one tap, fully secure': 'un toque, totalmente seguro',
  'Claim +{n}': 'Reclamar +{n}',
  'Dismiss offer': 'Descartar oferta',
  '+{n} generations added!': '¡+{n} generaciones agregadas!',
  'Get {n} free generations': 'Obtén {n} generaciones gratis',
  'Verify your phone number and we’ll drop {n} generations into your account. We only use it to keep the bonus fair — no spam, ever.':
    'Verifica tu número de teléfono y agregaremos {n} generaciones a tu cuenta. Solo lo usamos para que el bono sea justo: nunca spam.',
  'Enter the 6-digit code we just texted you.': 'Ingresa el código de 6 dígitos que te enviamos por SMS.',
  'Phone number': 'Número de teléfono',
  'Include your country code, e.g. +1.': 'Incluye tu código de país, p. ej. +1.',
  'Verification code': 'Código de verificación',
  'They’re in your balance now. Go try a new look!': 'Ya están en tu saldo. ¡Prueba un nuevo look!',
  'Text me a code': 'Envíame un código',
  'Sending…': 'Enviando…',
  'Verify & claim +{n}': 'Verificar y reclamar +{n}',
  'Use a different number': 'Usar otro número',
  'Enter a valid phone number, including country code.': 'Ingresa un número de teléfono válido, con código de país.',
  "Couldn't send the code. Check the number and try again.": 'No se pudo enviar el código. Revisa el número e inténtalo de nuevo.',
  'Enter the code we texted you.': 'Ingresa el código que te enviamos.',
  'That code was incorrect or expired. Try again.': 'Ese código es incorrecto o expiró. Inténtalo de nuevo.',
  "Couldn't grant your bonus. Please try again.": 'No se pudo otorgar tu bono. Inténtalo de nuevo.',
  "Couldn't reach the server. Please try again.": 'No se pudo conectar con el servidor. Inténtalo de nuevo.',

  // ── Landing page ──
  'dashboard': 'panel',
  'Completely Free For Everyone · 3D Preview in 60 Seconds':
    'Completamente gratis para todos · Vista 3D en 60 segundos',
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
  'FOR EVERY HAIRSTYLE': 'PARA CADA PEINADO',
  'See yourself in as many cuts as you want — on the house, for a limited time.':
    'Verte en todos los cortes que quieras: por cuenta de la casa, por tiempo limitado.',
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
  'Explore My Best Hairstyles': 'Explora mis mejores peinados',
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
  '50 haircut generations': '50 generaciones de corte',
  '200 haircut generations': '200 generaciones de corte',
  'Explorer': 'Explorador',
  'Pick your style.': 'Elige tu estilo.',
  'Try It For Yourself': 'Pruébalo tú mismo',
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
  // chatter — sketch
  'Sketching the cut…': 'Bosquejando el corte…',
  'Reading your curl pattern…': 'Leyendo tu patrón de rizos…',
  'Combing through the details…': 'Repasando los detalles…',
  'Eyeballing the blend…': 'Calibrando el degradado…',
  // chatter — hairstep
  'Sculpting it in 3D…': 'Esculpiéndolo en 3D…',
  'Setting every strand…': 'Colocando cada mechón…',
  'Spinning the chair around…': 'Girando la silla…',
  'Holding up the mirror…': 'Levantando el espejo…',

  // ── Barber card (public /b/<slug>) ──
  'Try on {cut}': 'Pruébate {cut}',
  'Links': 'Enlaces',
  'This barber hasn’t added recommendations yet.':
    'Este barbero aún no ha agregado recomendaciones.',
  'Explore the best hairstyles for you': 'Explora los mejores peinados para ti',
  'All': 'Todos',
  'Tap any cut to see it on your own head.':
    'Toca cualquier corte para verlo en tu propia cabeza.',
  'Virtual try-on': 'Prueba virtual',
  'Fitting room by ShapeUp': 'Probador de ShapeUp',
  'Photo of {name}': 'Foto de {name}',
  'Services': 'Servicios',
  'Filter styles': 'Filtrar estilos',
  'Barber’s pick': 'Recomendación del barbero',
  'Barber’s picks': 'Recomendaciones del barbero',
  'Men’s': 'Hombres',
  'Women’s': 'Mujeres',
  'What are we doing today?': '¿Qué hacemos hoy?',
  'Keep it familiar, or discover the cuts that suit you best.':
    'Mantén lo de siempre, o descubre los cortes que mejor te quedan.',
  'Just doing a trim.': 'Solo un recorte.',
  'Show me my best hairstyles': 'Muéstrame mis mejores peinados',
  'From the menu': 'Del menú',
  'Tap a cut to try it on': 'Toca un corte para probártelo',
  'Sure. What kind of trim?': 'Claro. ¿Qué tipo de recorte?',
  'Leave a note for your barber': 'Deja una nota para tu barbero',
  'Clean up the sides, keep the length…': 'Limpia los lados, mantén el largo…',
  'Show it to them from the chair — nothing to send.':
    'Muéstrasela desde la silla — no hay nada que enviar.',
  'While you wait — see your best hairstyles':
    'Mientras esperas — mira tus mejores peinados',
  'Finding the cuts that fit you.': 'Buscando los cortes que te quedan.',
  'Preparing the selfie camera': 'Preparando la cámara para selfies',

  // ── Barber batch flow ──
  'Close sign-in': 'Cerrar inicio de sesión',
  'Save your place': 'Guarda tu lugar',
  'One quick sign-in to continue.': 'Un inicio de sesión rápido para continuar.',
  'Your preview stays private and your choice stays connected to this barber.':
    'Tu vista previa se mantiene privada y tu elección queda vinculada con este barbero.',
  'One selfie · eight ideas': 'Una selfie · ocho ideas',
  'Here’s how it works.': 'Así funciona.',
  'Take or upload one selfie': 'Toma o sube una selfie',
  'We show you 8 hairstyles picked for your face and hair.':
    'Te mostramos 8 peinados elegidos para tu rostro y cabello.',
  'Choose your favorite and make final touches.':
    'Elige tu favorito y haz los retoques finales.',
  "We'll send it to your barber along with the appointment.":
    'Se lo enviaremos a tu barbero junto con la cita.',
  "Let's go.": 'Vamos.',
  'Keep your hairline, both temples, and full face visible.':
    'Mantén visibles la línea del cabello, ambas sienes y todo el rostro.',
  'That photo didn’t load — try another one.':
    'Esa foto no se cargó — prueba con otra.',
  'Personal analysis': 'Análisis personal',
  'Finding what works with your hair.': 'Buscando lo que funciona con tu cabello.',
  'Reading your hair and face': 'Analizando tu cabello y rostro',
  'Choosing 8 realistic styles': 'Eligiendo 8 estilos realistas',
  'Building every look': 'Creando cada look',
  '{ready} of 8 ready': '{ready} de 8 listos',
  'Your looks from earlier': 'Tus looks anteriores',
  'Your best matches': 'Tus mejores opciones',
  'Your chair is filling up.': 'Tu silla se está llenando.',
  'Eight cuts, picked for you.': 'Ocho cortes, elegidos para ti.',
  'Start over': 'Empezar de nuevo',
  'Straight': 'Liso',
  'Wavy': 'Ondulado',
  'Curly': 'Rizado',
  'Coily': 'Crespo',
  'dense': 'denso',
  'medium density': 'densidad media',
  'low density': 'baja densidad',
  'intact hairline': 'línea del cabello intacta',
  'mature hairline': 'línea del cabello madura',
  'receding hairline': 'línea del cabello en retroceso',
  'these 8 work with that': 'estos 8 funcionan con eso',
  'Your 8 hairstyle matches': 'Tus 8 peinados ideales',
  'Your best hairstyle matches': 'Tus mejores peinados',
  'Style {n} is still being built': 'El estilo {n} aún se está creando',
  'Style {n}': 'Estilo {n}',
  'Rendering': 'Renderizando',
  'Editing': 'Editando',
  'Waiting': 'En espera',
  'This look needs another pass.': 'Este look necesita otro intento.',
  'Retry {title}': 'Reintentar {title}',
  'Retrying…': 'Reintentando…',
  'Retry': 'Reintentar',
  'Open {title} in 3D': 'Abrir {title} en 3D',
  '{title} 360 preview': 'Vista 360 de {title}',
  '{title} preview': 'Vista previa de {title}',
  'Preview ready': 'Vista previa lista',
  'All 8 looks': 'Los 8 looks',
  'Best matches': 'Mejores opciones',
  'Your pick': 'Tu elección',
  'Make a small adjustment': 'Haz un pequeño ajuste',
  'Final Touches': 'Retoques finales',
  'Applying…': 'Aplicando…',
  'Sending 360…': 'Enviando 360…',
  'Send 360 to {name}': 'Enviar 360 a {name}',
  'That selfie needs another try.': 'Esa selfie necesita otro intento.',
  'Your looks could not be finished. Please try again.':
    'No se pudieron terminar tus looks. Inténtalo de nuevo.',
  'That adjustment did not finish. Try again from the grid.':
    'Ese ajuste no terminó. Inténtalo de nuevo desde la cuadrícula.',
  'That adjustment did not finish. Please try again.':
    'Ese ajuste no terminó. Inténtalo de nuevo.',
  'This look could not be retried.': 'No se pudo reintentar este look.',
  'Check your connection and retry this look.':
    'Revisa tu conexión y vuelve a intentar este look.',
  '{density} density': 'densidad {density}',
  '{state} hairline': 'línea del cabello {state}',
  '{top}" top / {sides}" sides / {back}" back':
    '{top}" arriba / {sides}" lados / {back}" atrás',
  '{shape} face': 'rostro {shape}',
  'Growth: {patterns}': 'Crecimiento: {patterns}',
  'high': 'alta',
  'med': 'media',
  'low': 'baja',
  'intact': 'intacta',
  'mature': 'madura',
  'receding': 'en retroceso',
  'Before we continue': 'Antes de continuar',
  'A quick note on your face data': 'Una nota rápida sobre los datos de tu rostro',
  'Our 3D rendering processes biometric data — specifically, facial geometry used to render your haircut preview. This data is not sold or shared with third parties.':
    'Nuestro renderizado 3D procesa datos biométricos — específicamente, la geometría facial usada para crear la vista previa de tu corte. Estos datos no se venden ni se comparten con terceros.',
  'Used solely for your haircut preview': 'Se usan solo para la vista previa de tu corte',
  'Stored in your account; delete anytime': 'Se guardan en tu cuenta; bórralos cuando quieras',
  'Not used to train models or identify you': 'No se usan para entrenar modelos ni identificarte',
  'By tapping “I agree” you consent to this processing under our':
    'Al tocar “Acepto”, autorizas este procesamiento según nuestra',
  'I agree': 'Acepto',
  'Could not save consent. Please try again.':
    'No se pudo guardar el consentimiento. Inténtalo de nuevo.',

  // ── Barber try-on (embedded selfie -> generate -> send flow) ──
  'Try it on yourself': 'Pruébalo en ti mismo',
  'All styles': 'Todos los estilos',
  'Take a selfie': 'Toma una selfie',
  'Your photo': 'Tu foto',
  '{n} ahead of you': '{n} delante de ti',
  'Let’s see how it looks on you!': '¡Veamos cómo te queda!',
  'Preparing your preview': 'Preparando tu vista previa',
  'Applying the hairstyle': 'Aplicando el peinado',
  'Building your 3D look': 'Creando tu look en 3D',
  'Checking your photo…': 'Revisando tu foto…',
  'Photo looks good': 'La foto se ve bien',
  'Keep your full head in frame': 'Mantén toda la cabeza dentro del encuadre',
  'Use this photo': 'Usar esta foto',
  'Camera unavailable — upload a photo instead.':
    'La cámara no está disponible — sube una foto.',
  'Take the photo': 'Tomar la foto',
  'Upload a photo': 'Subir una foto',
  'View controls': 'Controles de vista',
  'Before': 'Antes',
  'Reset view': 'Restablecer vista',
  'Retake selfie': 'Tomar otra selfie',
  'Your original photo': 'Tu foto original',
  'Drag to rotate · scroll to zoom': 'Arrastra para girar · desliza para acercar',
  'Book with {name}': 'Reservar con {name}',
  'Book appointment': 'Reservar cita',
  'One quick sign-in — it’s how we send you the result and let this barber know what you want.':
    'Un inicio de sesión rápido — así te enviamos el resultado y le mostramos a este barbero lo que quieres.',
  'Uploading…': 'Subiendo…',
  'Take or choose a photo': 'Toma o elige una foto',
  'Editing your photo…': 'Editando tu foto…',
  'Building your 3D cut…': 'Construyendo tu corte en 3D…',
  'In line for the 3D render — {n} ahead of you…': 'En la fila para el render 3D — {n} delante de ti…',
  'Drag to rotate': 'Arrastra para rotar',
  'The 3D render didn’t come through, but here’s your photo.':
    'El render 3D no llegó, pero aquí tienes tu foto.',
  'You, wearing {cut}': 'Tú, con {cut}',
  'Shorter on the sides, keep the top…': 'Más corto en los lados, conserva el top…',
  'Describe a change': 'Describe un cambio',
  'Go': 'Ir',
  'Send this to my barber': 'Enviar esto a mi barbero',
  'Sent! They’ll see exactly what you want before you sit down.':
    '¡Enviado! Verán exactamente lo que quieres antes de que te sientes.',
  'Sent to {name}’s ShapeUp inbox — they’ll see it before your cut.':
    'Enviado a la bandeja de ShapeUp de {name} — lo verá antes de tu corte.',
  'Couldn’t send that — screenshot this and show them in the chair instead.':
    'No se pudo enviar — toma una captura de pantalla y muéstrasela en la silla.',
  'Phone (optional)': 'Teléfono (opcional)',
  'That edit didn’t work — try a different photo or cut.':
    'Ese cambio no funcionó — prueba con otra foto o corte.',
  'Something went wrong. Check your connection and try again.':
    'Algo salió mal. Revisa tu conexión e inténtalo de nuevo.',
  'Couldn’t upload that photo — try again.': 'No se pudo subir esa foto — inténtalo de nuevo.',

  // ── Barber booking (/b/<slug> scheduler) ──
  'Book a time': 'Reservar una hora',
  'Book a chair': 'Reserva tu silla',
  'Book {time} · {price}': 'Reservar a las {time} · {price}',
  '{city} time': 'hora de {city}',
  'No open times in the next two weeks — reach out directly.':
    'No hay horarios libres en las próximas dos semanas — contáctalo directamente.',
  'Pick a day': 'Elige un día',
  'Pick a time': 'Elige una hora',
  'One quick sign-in so {name} knows the booking is real.':
    'Un inicio de sesión rápido para que {name} sepa que la reserva es real.',
  'Service (optional)': 'Servicio (opcional)',
  'Just a cut': 'Solo un corte',
  'Booking…': 'Reservando…',
  'Book {time}': 'Reservar {time}',
  'You’re booked.': 'Reserva confirmada.',
  'Add to Google Calendar': 'Agregar a Google Calendar',
  'Apple / Outlook (.ics)': 'Apple / Outlook (.ics)',
  '{name} got the details — just show up.': '{name} ya tiene los detalles — solo preséntate.',
  'Haircut with {name}': 'Corte con {name}',
  'Cut I tried on: {cut}': 'Corte que me probé: {cut}',

  // ── Barber builder: appointments ──
  'Appointments': 'Citas',
  'Appointment price': 'Precio de la cita',
  'shown before booking': 'se muestra antes de reservar',
  'Let clients book times on my card': 'Permitir que los clientes reserven horas en mi tarjeta',
  'Clients pick a real open slot; you both get a confirmation with a calendar invite. No other app needed.':
    'Los clientes eligen un horario libre real; ambos reciben una confirmación con invitación de calendario. Sin otra app.',
  'Timezone': 'Zona horaria',
  'Slot length': 'Duración del turno',
  '{n} minutes': '{n} minutos',
  'Sunday': 'Domingo',
  'Monday': 'Lunes',
  'Tuesday': 'Martes',
  'Wednesday': 'Miércoles',
  'Thursday': 'Jueves',
  'Friday': 'Viernes',
  'Saturday': 'Sábado',
  'Opens': 'Abre',
  'Closes': 'Cierra',
  'Closed': 'Cerrado',
  "That timezone isn't recognized.": 'Esa zona horaria no se reconoce.',
  'Pick a slot length from the list.': 'Elige una duración de turno de la lista.',
  'At most one window per day of the week.': 'Como máximo un horario por día de la semana.',
  'Days must be Sunday through Saturday.': 'Los días deben ser de domingo a sábado.',
  'Hours must look like 09:00.': 'Las horas deben tener el formato 09:00.',
  'Each day must open before it closes.': 'Cada día debe abrir antes de cerrar.',
  'Add at least one open day to take bookings.':
    'Agrega al menos un día abierto para recibir reservas.',
  'Upcoming appointments': 'Próximas citas',
  'Nothing on the books yet — slots are live on your card.':
    'Aún no hay citas — los horarios ya están activos en tu tarjeta.',
  'Cancel {name}’s appointment? They’ll be emailed that the time is off.':
    '¿Cancelar la cita de {name}? Se le avisará por correo que la hora quedó libre.',
  'Cancelling…': 'Cancelando…',
  'Client requests': 'Solicitudes de clientes',
  'Cuts clients sent from your card — what they want before they sit down.':
    'Cortes que los clientes enviaron desde tu tarjeta — lo que quieren antes de sentarse.',
  'Client preview: {cut}': 'Vista previa del cliente: {cut}',
  'View 360°': 'Ver 360°',
  '{n}m ago': 'hace {n} min',
  '{n}h ago': 'hace {n} h',
  '{n}d ago': 'hace {n} días',

  // ── Barber builder (/barber) ──
  'Build your barber card': 'Crea tu tarjeta de barbero',
  'Sign in to claim your link and print your mirror QR.':
    'Inicia sesión para reclamar tu enlace e imprimir el QR de tu espejo.',
  'Your barber card': 'Tu tarjeta de barbero',
  'Profile photo': 'Foto de perfil',
  'Profile': 'Perfil',
  'Upload': 'Subir',
  'Add a profile photo': 'Agregar una foto de perfil',
  'Replace your profile photo': 'Reemplazar tu foto de perfil',
  'Replace': 'Reemplazar',
  'Clients trust a face. Square crop, up to 8 MB.':
    'Los clientes confían en un rostro. Recorte cuadrado, hasta 8 MB.',
  'Looking sharp. Tap the photo to replace it.':
    'Se ve genial. Toca la foto para reemplazarla.',
  'That file isn’t an image — try a JPG or PNG.':
    'Ese archivo no es una imagen — prueba con JPG o PNG.',
  'That photo is too large — keep it under 8 MB.':
    'Esa foto es demasiado grande — debe pesar menos de 8 MB.',
  'Remove your profile photo?': '¿Quitar tu foto de perfil?',
  'Business details': 'Detalles del negocio',
  'Location': 'Ubicación',
  'Telegraph Ave, Oakland': 'Telegraph Ave, Oakland',
  'shown under your name': 'se muestra debajo de tu nombre',
  'Hours': 'Horario',
  'Tue–Sat · 9–6': 'Mar–Sáb · 9–6',
  'Services & pricing': 'Servicios y precios',
  'Add a service': 'Agregar un servicio',
  'Service name': 'Nombre del servicio',
  'Skin fade': 'Degradado al ras',
  'Price': 'Precio',
  'Remove this service?': '¿Quitar este servicio?',
  'We offer perms / texture services': 'Ofrecemos permanentes / servicios de textura',
  'Booking & links': 'Reservas y enlaces',
  'Move up': 'Mover arriba',
  'Move down': 'Mover abajo',
  'Remove this link from your card?': '¿Quitar este enlace de tu tarjeta?',
  'Notifications': 'Notificaciones',
  'Recommended cuts': 'Cortes recomendados',
  'These lead your card as “Barber’s picks” — clients tap them to try them on.':
    'Estos aparecen primero como “Recomendaciones del barbero” — los clientes los tocan para probárselos.',
  'Unsaved changes': 'Cambios sin guardar',
  'Insights': 'Estadísticas',
  'This week': 'Esta semana',
  'vs last week': 'vs. la semana pasada',
  'Booking taps': 'Toques en reservas',
  'Previews finished': 'Vistas previas completadas',
  'Most-tried styles': 'Estilos más probados',
  'Clients often leave before finishing a preview — remind them it takes under a minute.':
    'Los clientes suelen salir antes de terminar la vista previa — recuérdales que tarda menos de un minuto.',
  'Scans are up from last week ({a} → {b}).':
    'Los escaneos subieron desde la semana pasada ({a} → {b}).',
  'Your booking link got {n} taps this week.':
    'Tu enlace de reservas recibió {n} toques esta semana.',
  '{n} clients joined ShapeUp through your card.':
    '{n} clientes se unieron a ShapeUp mediante tu tarjeta.',
  '“{cut}” is your most-tried style.': '“{cut}” es tu estilo más probado.',
  'A free page for your clients — and a fitting room that shows them the cut on their own head.':
    'Una página gratis para tus clientes — y un probador que les muestra el corte en su propia cabeza.',
  'Your link': 'Tu enlace',
  'Your name': 'Tu nombre',
  'Name': 'Nombre',
  'Shop': 'Barbería',
  'Bio': 'Biografía',
  'Ten years on Telegraph Ave. Walk-ins welcome.':
    'Diez años en la Av. Telegraph. Sin cita también.',
  'Notify me at': 'Notifícame en',
  'private — never shown on your card': 'privado — nunca se muestra en tu tarjeta',
  'When a client picks a cut on your card, we’ll email you the result and their contact info — so you know exactly what to do before they sit down.':
    'Cuando un cliente elige un corte en tu tarjeta, te enviamos por correo el resultado y su contacto — para que sepas exactamente qué hacer antes de que se siente.',
  'Link type': 'Tipo de enlace',
  'Remove': 'Quitar',
  'Label (e.g. My portfolio)': 'Etiqueta (ej. Mi portafolio)',
  'Link label': 'Etiqueta del enlace',
  'Cuts you do': 'Cortes que haces',
  'Clients tap these to try them on. Pick your go-to cuts.':
    'Los clientes los tocan para probarlos. Elige tus cortes habituales.',
  'Live': 'En vivo',
  'Save changes': 'Guardar cambios',
  'Publish card': 'Publicar tarjeta',
  'Checking…': 'Comprobando…',
  'Available': 'Disponible',
  'That name is taken.': 'Ese nombre ya está tomado.',
  'QR code for your card': 'Código QR de tu tarjeta',
  'Keep this card': 'Guarda esta tarjeta',
  'Save to Apple Wallet': 'Guardar en Apple Wallet',
  'Download {name}’s Apple Wallet pass': 'Descargar el pase de Apple Wallet de {name}',
  'Your card is live': 'Tu tarjeta está en vivo',
  'Copied!': '¡Copiado!',
  'Download mirror card': 'Descargar tarjeta de espejo',
  'View card ↗': 'Ver tarjeta ↗',
  'Print it and tape it to your mirror. Clients scan it from the chair.':
    'Imprímela y pégala en tu espejo. Los clientes la escanean desde la silla.',
  'Scans': 'Escaneos',
  'Try-ons': 'Pruebas',
  'Link taps': 'Toques de enlace',
  'Clients joined': 'Clientes registrados',

  // ── For barbers (pitch page) ──
  'Build your card': 'Crea tu tarjeta',
  'Free for barbers': 'Gratis para barberos',
  'Your clients stop describing the cut.': 'Tus clientes dejan de describir el corte.',
  'They show you.': 'Te lo muestran.',
  'A free page for your chair — booking, socials, Venmo, all in one link — with a fitting room built in. A client scans the QR on your mirror, taps a cut, and sees it on their own head. No more “a little off the top.”':
    'Una página gratis para tu silla — reservas, redes, Venmo, todo en un enlace — con probador incluido. Un cliente escanea el QR de tu espejo, toca un corte y lo ve en su propia cabeza. Se acabó el “un poquito de arriba”.',
  'Build your card — free': 'Crea tu tarjeta — gratis',
  'Claim your link': 'Reclama tu enlace',
  'Pick your name — tryshapeup.cc/b/you. Add booking, Instagram, Venmo, call and text. Free, forever.':
    'Elige tu nombre — tryshapeup.cc/b/tu. Agrega reservas, Instagram, Venmo, llamadas y mensajes. Gratis, para siempre.',
  'Add the cuts you do': 'Agrega los cortes que haces',
  'Choose your go-to styles. Clients tap one and see it on their own head — before you pick up the clippers.':
    'Elige tus estilos habituales. Los clientes tocan uno y lo ven en su propia cabeza — antes de que tomes la máquina.',
  'Tape the QR to your mirror': 'Pega el QR en tu espejo',
  'Print the card. Every client in your chair scans it, shows you exactly what they want, and lands on your page.':
    'Imprime la tarjeta. Cada cliente en tu silla la escanea, te muestra exactamente lo que quiere y llega a tu página.',
  'It’s the free tool your clients actually want.':
    'Es la herramienta gratis que tus clientes realmente quieren.',
  'Every client who scans your QR and signs up is tracked back to you. Watch it on your dashboard.':
    'Cada cliente que escanea tu QR y se registra se atribuye a ti. Míralo en tu panel.',
  'Get started': 'Comenzar',
};
