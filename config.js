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
