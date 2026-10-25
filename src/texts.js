// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs
// and errors. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './minio/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your MinIO server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur MinIO dans la configuration.",
    de: 'Gib die Adresse deines MinIO-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor MinIO en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:9000',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:9000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:9000',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:9000',
  },
  noSecret: {
    en: 'Enter the secret key that goes with the access key in the configuration.',
    fr: "Saisissez la clé secrète qui va avec la clé d'accès dans la configuration.",
    de: 'Gib den geheimen Schlüssel zum Zugriffsschlüssel in der Konfiguration ein.',
    es: 'Introduzca la clave secreta de la clave de acceso en la configuración.',
  },
};

// One short explanation per error kind (src/minio/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'MinIO does not answer',
    fr: 'MinIO ne répond pas',
    de: 'MinIO antwortet nicht',
    es: 'MinIO no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: allow self-signed certificates in the configuration',
    fr: 'certificat refusé : acceptez les certificats auto-signés dans la configuration',
    de: 'Zertifikat abgelehnt: Erlaube selbstsignierte Zertifikate in der Konfiguration',
    es: 'certificado rechazado: acepte los certificados autofirmados en la configuración',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'access refused: check the keys and the admin:Prometheus permission',
    fr: 'accès refusé : vérifiez les clés et le droit admin:Prometheus',
    de: 'Zugriff verweigert: Prüfe die Schlüssel und das Recht admin:Prometheus',
    es: 'acceso denegado: compruebe las claves y el permiso admin:Prometheus',
  },
  [ERROR_KINDS.NOT_MINIO]: {
    en: 'no MinIO server at this address (the API port, 9000 by default)',
    fr: "aucun serveur MinIO à cette adresse (le port de l'API, 9000 par défaut)",
    de: 'kein MinIO-Server unter dieser Adresse (der API-Port, standardmäßig 9000)',
    es: 'no hay ningún servidor MinIO en esta dirección (el puerto de la API, 9000)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.TOO_LARGE]: {
    en: 'MinIO answers too much data (thousands of buckets)',
    fr: 'MinIO renvoie trop de données (des milliers de buckets)',
    de: 'MinIO liefert zu viele Daten (Tausende Buckets)',
    es: 'MinIO devuelve demasiados datos (miles de buckets)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    version: (version) => `version ${version}`,
    free: (size, percent) => `${size} free (${percent} %)`,
    drives: (online, offline) => `${online} drive(s) online, ${offline} offline`,
    buckets: (count) => `${count} bucket(s)`,
    unhealthy: 'write quorum lost',
  },
  fr: {
    ok: 'Connecté',
    version: (version) => `version ${version}`,
    free: (size, percent) => `${size} libres (${percent} %)`,
    drives: (online, offline) => `${online} disque(s) en ligne, ${offline} hors ligne`,
    buckets: (count) => `${count} bucket(s)`,
    unhealthy: "quorum d'écriture perdu",
  },
  de: {
    ok: 'Verbunden',
    version: (version) => `Version ${version}`,
    free: (size, percent) => `${size} frei (${percent} %)`,
    drives: (online, offline) => `${online} Laufwerk(e) online, ${offline} offline`,
    buckets: (count) => `${count} Bucket(s)`,
    unhealthy: 'Schreib-Quorum verloren',
  },
  es: {
    ok: 'Conectado',
    version: (version) => `versión ${version}`,
    free: (size, percent) => `${size} libres (${percent} %)`,
    drives: (online, offline) => `${online} disco(s) en línea, ${offline} fuera de línea`,
    buckets: (count) => `${count} bucket(s)`,
    unhealthy: 'quórum de escritura perdido',
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  unknownBucket: {
    en: 'This device is not a MinIO bucket, or the bucket no longer exists.',
    fr: "Cet appareil n'est pas un bucket MinIO, ou le bucket n'existe plus.",
    de: 'Dieses Gerät ist kein MinIO-Bucket, oder der Bucket existiert nicht mehr.',
    es: 'Este dispositivo no es un bucket de MinIO, o el bucket ya no existe.',
  },
};

// The `sentence` outputs of the scene actions.
export const SENTENCE_TEXT = {
  en: {
    unreachable: 'MinIO does not answer.',
    online: 'MinIO answers, its figures are not known yet.',
    bucketUnknown: (name) => `Bucket ${name}: size not known yet.`,
    server: (free, percent, offline) =>
      `MinIO: ${free} free (${percent} %), ${offline} drive(s) offline.`,
    bucket: (name, size, objects) => `Bucket ${name}: ${size}, ${objects} object(s).`,
  },
  fr: {
    unreachable: 'MinIO ne répond pas.',
    online: 'MinIO répond, ses chiffres ne sont pas encore connus.',
    bucketUnknown: (name) => `Bucket ${name} : taille pas encore connue.`,
    server: (free, percent, offline) =>
      `MinIO : ${free} libres (${percent} %), ${offline} disque(s) hors ligne.`,
    bucket: (name, size, objects) => `Bucket ${name} : ${size}, ${objects} objet(s).`,
  },
  de: {
    unreachable: 'MinIO antwortet nicht.',
    online: 'MinIO antwortet, seine Zahlen sind noch nicht bekannt.',
    bucketUnknown: (name) => `Bucket ${name}: Größe noch nicht bekannt.`,
    server: (free, percent, offline) =>
      `MinIO: ${free} frei (${percent} %), ${offline} Laufwerk(e) offline.`,
    bucket: (name, size, objects) => `Bucket ${name}: ${size}, ${objects} Objekt(e).`,
  },
  es: {
    unreachable: 'MinIO no responde.',
    online: 'MinIO responde, sus cifras aún no se conocen.',
    bucketUnknown: (name) => `Bucket ${name}: tamaño aún no conocido.`,
    server: (free, percent, offline) =>
      `MinIO: ${free} libres (${percent} %), ${offline} disco(s) fuera de línea.`,
    bucket: (name, size, objects) => `Bucket ${name}: ${size}, ${objects} objeto(s).`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** "1.2 GB" (decimal units, as MinIO shows them), with the decimal mark of the language. */
export function formatBytes(bytes, language = 'en') {
  if (bytes === null || bytes === undefined) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const number = new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${number} ${units[unit]}`;
}

/** A percentage with the decimal mark of the language. */
export const formatPercent = (value, language = 'en') =>
  value === null
    ? '-'
    : new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, {
        maximumFractionDigits: 1,
      }).format(value);

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
