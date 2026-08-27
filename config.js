// ---------------------------------------------------------------------------
// CONFIGURACION
// Completá estos tres valores siguiendo el README. Sin esto la app no arranca.
// ---------------------------------------------------------------------------

// Panel de Supabase -> Project Settings -> Data API
export const SUPABASE_URL = 'https://aisnhvheqfhpzlkvzhkt.supabase.co/';

// La clave "anon public". Va commiteada al repo sin problema: es publica por
// diseño y no da acceso a nada, porque las politicas RLS exigen sesion iniciada.
// La que NUNCA va acá es la "service_role".
export const SUPABASE_ANON_KEY = 'sb_publishable_9c9c_RBKdfAOvDDJMXd4Wg_tg_cboQt';

// Email de la cuenta unica del clan (la que creaste en Authentication -> Users).
// Nadie lo escribe al entrar: solo se pide la contraseña.
export const CLAN_EMAIL = 'barderos@timing.local';

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
export const IMG_EXT = 'png'; // 'gif' si usás sprites animados
