// ---------------------------------------------------------------------------
// LISTA DE BOSSES
//
// Este es el unico archivo que tenes que tocar para agregar o corregir bosses.
// Cada boss necesita:
//
//   id     Identificador interno. Sin espacios ni acentos. NO lo cambies una vez
//          que el boss tiene registros cargados, porque se pierde el historial.
//   name   Como se muestra en pantalla.
//   min    Minutos desde la muerte hasta que PUEDE aparecer.
//   max    Minutos desde la muerte hasta que YA TENDRIA que haber aparecido.
//          Si el respawn es exacto y no tiene ventana, poné el mismo valor que min.
//   zone   Opcional. Zona o mapa.
//   img    Opcional. URL del sprite. Si no hay, se muestra la inicial del nombre.
//
// Ayuda para convertir:  1 h = 60   3 h 30 m = 210   6 h = 360   9 h = 540
// ---------------------------------------------------------------------------

export const BOSSES = [
  { id: 'garveloth',   name: 'Garveloth',   min: 30,  max: 45  },
  { id: 'archimago',   name: 'Archimago',   min: 360, max: 540 },
  { id: 'djin',        name: 'Djin',        min: 240, max: 390 },
  { id: 'guarda',      name: 'Guarda',      min: 210, max: 330 },
  { id: 'gorgona',     name: 'Gorgona',     min: 45,  max: 100 },
  { id: 'khern-ghard', name: 'Khern Ghard', min: 300, max: 480 },

  // Pegá el resto acá abajo con el mismo formato, por ejemplo:
  // { id: 'nombre-del-boss', name: 'Nombre Del Boss', min: 120, max: 180, zone: 'Dungeon X' },
];
