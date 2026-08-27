// ---------------------------------------------------------------------------
// CONFIGURACION
// Completá estos tres valores siguiendo el README. Sin esto la app no arranca.
// ---------------------------------------------------------------------------

// Panel de Supabase -> Settings -> API Keys -> Project URL
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';

// La "Publishable key" (empieza con sb_publishable_).
// En proyectos viejos puede llamarse "anon" y estar en la pestaña Legacy API
// Keys; las dos funcionan igual, pero las legacy quedan deprecadas a fin de
// 2026, asi que si podés elegí la publishable.
//
// Va commiteada al repo publico sin problema: es publica por diseño y no da
// acceso a nada, porque las politicas RLS exigen sesion iniciada.
// La que NUNCA va acá es la "secret" (sb_secret_) ni la vieja "service_role".
export const SUPABASE_ANON_KEY = 'sb_publishable_TU_CLAVE';

// Email de la cuenta unica del clan (la que creaste en Authentication -> Users).
// Nadie lo escribe al entrar: solo se pide la contraseña.
export const CLAN_EMAIL = 'clan@timings.local';

// Texto del encabezado.
export const APP_TITLE = 'Timings IAO';

// ---------------------------------------------------------------------------
// IMAGENES
//
// Las fotos van en la carpeta img/ del repo. El nombre del archivo se deduce
// del nombre del boss: "Gran Dragón Verde" -> img/gran-dragon-verde.png
// (minusculas, sin acentos, espacios por guiones).
//
// Si falta un archivo no pasa nada: esa tarjeta muestra la inicial del nombre.
// Ver img/LEEME.txt para la lista exacta de nombres esperados.
//
// Para un caso puntual con otro formato o nombre, poné la ruta a mano en la
// entrada del boss:   { id: '...', name: '...', img: 'img/lo-que-sea.gif' }
// ---------------------------------------------------------------------------

export const IMG_DIR = 'img';
export const IMG_EXT = 'png';   // 'gif' si usás sprites animados
