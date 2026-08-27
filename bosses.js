// ---------------------------------------------------------------------------
// LISTA DE BOSSES POR DUNGEON
//
// Cada entrada es un spawn independiente. Si el mismo bicho aparece en dos
// dungeons, van dos entradas con ids distintos: son dos timers separados.
//
//   id       Identificador interno, unico. Sin espacios ni acentos.
//            NO lo cambies una vez que tenga registros: se pierde el historial.
//   name     Como se muestra en pantalla.
//   dungeon  Nombre del dungeon. Los filtros se arman solos a partir de esto,
//            asi que alcanza con escribirlo igual en todas las entradas.
//   min      Tiempo desde la muerte hasta que PUEDE aparecer.
//   max      Tiempo desde la muerte hasta que YA TENDRIA que haber aparecido.
//   img      Opcional. URL del sprite. Sin esto se muestra la inicial.
//
// Formato de min/max: texto con horas, minutos y segundos, en cualquier
// combinacion.  '45s'   '33m 20s'   '2h'   '6h 30m'   '12h 45m 10s'
// Un numero suelto se interpreta como minutos: 210 es lo mismo que '3h 30m'.
// Si el respawn es exacto, poné el mismo valor en los dos.
// ---------------------------------------------------------------------------

export const BOSSES = [

  // ----- Dungeon Veriil -----
  { id: 'veriil-gorgona',        name: 'Gorgona',                  dungeon: 'Dungeon Veriil',  min: '45m',     max: '1h 40m'  },
  { id: 'veriil-dragon-verde',   name: 'Gran Dragón Verde',        dungeon: 'Dungeon Veriil',  min: '2h',      max: '5h'      },

  // ----- Dungeon Farzhé -----
  { id: 'farzhe-golem-plata',    name: 'Golem de Plata',           dungeon: 'Dungeon Farzhé',  min: '33m 20s', max: '46m 40s' },
  { id: 'farzhe-golem-oro',      name: 'Golem de Oro',             dungeon: 'Dungeon Farzhé',  min: '36m 40s', max: '1h 1m'   },
  { id: 'farzhe-golem-infernal', name: 'Golem Infernal',           dungeon: 'Dungeon Farzhé',  min: '41m 40s', max: '1h 10m'  },

  // ----- Dungeon Zero -----
  { id: 'zero-archimago',        name: 'Archimago',                dungeon: 'Dungeon Zero',    min: '6h',      max: '9h'      },
  { id: 'zero-dragon-negro',     name: 'Gran Dragón Negro',        dungeon: 'Dungeon Zero',    min: '12h',     max: '20h'     },
  { id: 'zero-dragon-azul',      name: 'Gran Dragón Azul',         dungeon: 'Dungeon Zero',    min: '8h',      max: '14h'     },
  { id: 'zero-golem-plata',      name: 'Golem de Plata',           dungeon: 'Dungeon Zero',    min: '33m 20s', max: '46m 40s' },
  { id: 'zero-golem-oro',        name: 'Golem de Oro',             dungeon: 'Dungeon Zero',    min: '36m 40s', max: '1h 1m'   },
  { id: 'zero-golem-infernal',   name: 'Golem Infernal',           dungeon: 'Dungeon Zero',    min: '41m 40s', max: '1h 10m'  },

  // ----- Abismo Infernal -----
  { id: 'abismo-golem-infernal', name: 'Golem Infernal',           dungeon: 'Abismo Infernal', min: '41m 40s', max: '1h 10m'  },
  { id: 'abismo-dragon-rojo',    name: 'Gran Dragón Rojo',         dungeon: 'Abismo Infernal', min: '10h',     max: '17h'     },

  // ----- Pantano -----
  { id: 'pantano-guarda',        name: 'Guarda',                   dungeon: 'Pantano',         min: '3h 30m',  max: '5h 30m'  },

  // ----- Templo Kalath -----
  { id: 'kalath-garveloth',      name: 'Gran Hechicero Garveloth', dungeon: 'Templo Kalath',   min: '30m',     max: '45m'     },
  { id: 'kalath-djin',           name: 'Djin',                     dungeon: 'Templo Kalath',   min: '4h',      max: '6h 30m'  },

  // ----- Cueva Pirata -----
  { id: 'pirata-khern-ghard',    name: 'Khern Ghard',              dungeon: 'Cueva Pirata',    min: '5h',      max: '8h'      },
];
