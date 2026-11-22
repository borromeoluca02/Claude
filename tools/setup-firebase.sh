#!/usr/bin/env bash
# Collega l'app a un progetto Firebase e la pubblica online.
#
#   bash tools/setup-firebase.sh                 # interattivo
#   bash tools/setup-firebase.sh <project-id>    # progetto già scelto
#   bash tools/setup-firebase.sh <project-id> --no-deploy
#
# Fa tutto da solo tranne due cose che richiedono il tuo account:
#   1. l'accesso Google (si apre il browser, tu approvi);
#   2. l'attivazione dei metodi di accesso, che la CLI non espone: lo script
#      stampa il link diretto alla pagina giusta.

set -euo pipefail

CLI_VERSION="13.35.1"
APP_NAME="Cross Builder"
LOCATION="${FIRESTORE_LOCATION:-eur3}"   # eur3 = Europa multiregione
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="${1:-}"
DEPLOY=1
for arg in "$@"; do [ "$arg" = "--no-deploy" ] && DEPLOY=0; done
[ "${PROJECT:-}" = "--no-deploy" ] && PROJECT=""

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

command -v node >/dev/null || { err "Serve Node.js: https://nodejs.org"; exit 1; }
FB=(npx --yes "firebase-tools@${CLI_VERSION}")

# estrae un campo da un JSON della CLI, provando le forme che usa
jget() { node -e '
  let raw = ""; process.stdin.on("data", d => raw += d).on("end", () => {
    const start = raw.indexOf("{");
    let data = {};
    try { data = JSON.parse(start >= 0 ? raw.slice(start) : raw); } catch (e) {}
    const path = process.argv[1].split(".");
    let v = data.result !== undefined ? data.result : data;
    for (const k of path) { if (v == null) break; v = Array.isArray(v) && /^\d+$/.test(k) ? v[+k] : v[k]; }
    process.stdout.write(v == null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
  });' "$1"; }

step "1/6 · Accesso a Firebase"
if "${FB[@]}" login:list 2>/dev/null | grep -qi "logged in"; then
  info "già connesso: $("${FB[@]}" login:list 2>/dev/null | grep -oE '[^ ]+@[^ ]+' | head -1)"
else
  info "si apre il browser: accedi con l'account Google del progetto"
  "${FB[@]}" login
fi

step "2/6 · Progetto"
if [ -z "$PROJECT" ] && [ -f .firebaserc ]; then
  PROJECT="$(node -e 'try{process.stdout.write((require("./.firebaserc").projects||{}).default||"")}catch(e){}')"
  [ -n "$PROJECT" ] && info "letto da .firebaserc: $PROJECT"
fi
if [ -z "$PROJECT" ]; then
  echo "  Progetti disponibili:"
  "${FB[@]}" projects:list 2>/dev/null | sed -n '1,40p' | sed 's/^/    /'
  echo
  read -r -p "  ID del progetto da usare (vuoto = ne creo uno nuovo): " PROJECT || true
fi
if [ -z "$PROJECT" ]; then
  DEFAULT_ID="cross-builder-$(tr -dc 'a-z0-9' </dev/urandom | head -c6 || echo $RANDOM)"
  read -r -p "  ID del nuovo progetto [$DEFAULT_ID]: " NEW_ID || true
  PROJECT="${NEW_ID:-$DEFAULT_ID}"
  info "creo il progetto $PROJECT…"
  "${FB[@]}" projects:create "$PROJECT" --display-name "$APP_NAME"
fi
info "progetto: $PROJECT"
node -e '
  const fs = require("fs");
  fs.writeFileSync(".firebaserc", JSON.stringify({ projects: { default: process.argv[1] } }, null, 2) + "\n");
' "$PROJECT"
info "scritto .firebaserc"

step "3/6 · App web"
APP_ID="$("${FB[@]}" apps:list WEB --project "$PROJECT" --json 2>/dev/null | jget "0.appId" || true)"
if [ -z "$APP_ID" ]; then
  info "nessuna app web registrata: la creo"
  APP_ID="$("${FB[@]}" apps:create WEB "$APP_NAME" --project "$PROJECT" --json 2>/dev/null | jget "appId" || true)"
fi
[ -z "$APP_ID" ] && { err "Non sono riuscito a ottenere l'ID dell'app web. Registrala dalla console e rilancia."; exit 1; }
info "app web: $APP_ID"

step "4/6 · Configurazione nel codice"
CFG_JSON="$("${FB[@]}" apps:sdkconfig WEB "$APP_ID" --project "$PROJECT" --json 2>/dev/null || true)"
node -e '
  const fs = require("fs");
  const raw = process.argv[1];
  const start = raw.indexOf("{");
  let data = {};
  try { data = JSON.parse(start >= 0 ? raw.slice(start) : raw); } catch (e) {}
  const r = data.result || data;
  let cfg = r.sdkConfig || r;
  if (!cfg.apiKey && typeof r.fileContents === "string") {
    const m = r.fileContents.match(/\{[\s\S]*\}/);
    if (m) { try { cfg = JSON.parse(m[0]); } catch (e) {} }
  }
  if (!cfg || !cfg.apiKey) {
    console.error("Configurazione non riconosciuta. Incollala a mano in public/js/firebase-config.js");
    process.exit(2);
  }
  const keys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"];
  const out = {};
  for (const k of keys) if (cfg[k]) out[k] = cfg[k];
  const body = Object.entries(out).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join("\n");
  fs.writeFileSync("public/js/firebase-config.js",
`/* Configurazione Firebase — generata da tools/setup-firebase.sh
   Questi valori identificano il progetto e non sono segreti: la sicurezza
   è data dalle regole in firestore.rules. */
window.FIREBASE_CONFIG = {
${body}
};
`);
  console.log("  scritto public/js/firebase-config.js per il progetto " + out.projectId);
' "$CFG_JSON"

step "5/6 · Database Firestore"
if "${FB[@]}" firestore:databases:list --project "$PROJECT" 2>/dev/null | grep -q "(default)"; then
  info "database già presente"
else
  info "creo il database in $LOCATION…"
  "${FB[@]}" firestore:databases:create "(default)" --location "$LOCATION" --project "$PROJECT" \
    || info "non creato dalla CLI: fallo dalla console (Build → Firestore Database → Crea database)"
fi

step "6/6 · Pubblicazione"
if [ "$DEPLOY" = "1" ]; then
  "${FB[@]}" deploy --only hosting,firestore:rules --project "$PROJECT"
else
  info "saltata (--no-deploy)"
fi

cat <<EOF

$(bold "Fatto.")
  Sito:    https://${PROJECT}.web.app
  Console: https://console.firebase.google.com/project/${PROJECT}/overview

$(bold "Resta un passaggio, che la CLI non permette di fare:")
  apri  https://console.firebase.google.com/project/${PROJECT}/authentication/providers
  e abilita  Google  (e, se vuoi far provare l'app senza registrazione, Anonimo).
  Senza questo, il pulsante "Accedi con Google" risponde auth/operation-not-allowed.

  I domini ${PROJECT}.web.app e ${PROJECT}.firebaseapp.com sono già autorizzati.
  Per le prove in locale aggiungi localhost in
  Authentication → Settings → Domini autorizzati.

  Ricordati di salvare la configurazione appena scritta:
    git add public/js/firebase-config.js .firebaserc && git commit -m "Collega il progetto Firebase"
EOF
