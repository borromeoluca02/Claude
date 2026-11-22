# Collegare l'app al proprio progetto Firebase

## Scorciatoia: uno script fa quasi tutto

```bash
bash tools/setup-firebase.sh
```

Accede al tuo account (si apre il browser), sceglie o crea il progetto, registra
l'app web, scrive `public/js/firebase-config.js` e `.firebaserc`, crea il
database Firestore e pubblica il sito. Al termine stampa l'indirizzo e l'unica
cosa che la CLI non può fare: abilitare i metodi di accesso, con il link diretto
alla pagina giusta.

Opzioni: `bash tools/setup-firebase.sh <project-id>` per saltare la scelta,
`--no-deploy` per fermarsi prima della pubblicazione, e la variabile
`FIRESTORE_LOCATION` per cambiare regione (default `eur3`).

Il resto di questa guida è la stessa procedura fatta a mano, utile se qualcosa
non va o se preferisci passare dalla console.

---

Tutto quello che segue si fa una volta sola. I passaggi 1-4 sono nella console
Firebase, il 5 collega l'app e il 6 la pubblica online.

## 1. Progetto

<https://console.firebase.google.com> → accedi con il tuo account Google →
**Aggiungi progetto** (oppure apri quello che hai già).
Annota l'**ID progetto**: è il nome tecnico, tutto minuscolo, del tipo
`cross-builder-1a2b3`. Non è il nome visualizzato e non è la tua email.

## 2. Accesso degli utenti

**Build → Authentication → Inizia** → scheda **Sign-in method**:

* abilita **Google** (indica una email di assistenza);
* se vuoi far provare l'app senza registrazione, abilita anche **Anonimo**.

In **Authentication → Settings → Domini autorizzati** devono comparire i domini
da cui si userà l'app. `<project-id>.web.app` e `<project-id>.firebaseapp.com`
ci sono già; aggiungi `localhost` per le prove in locale e l'eventuale dominio
personalizzato.

## 3. Database

**Build → Firestore Database → Crea database** → modalità **produzione** →
scegli la regione (per l'Italia va bene `eur3` o `europe-west8`).

Le regole di accesso sono già nel repository (`firestore.rules`): ogni utente
legge e scrive soltanto i propri percorsi, salvati in
`users/{uid}/projects/{id}`.

## 4. App web

**Impostazioni progetto** (ingranaggio) → **Le tue app** → icona **`</>`** →
registra l'app (il nickname è libero, l'hosting lo colleghiamo dopo).
Compare un blocco di codice come questo:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "cross-builder-1a2b3.firebaseapp.com",
  projectId: "cross-builder-1a2b3",
  storageBucket: "cross-builder-1a2b3.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123"
};
```

Questi valori **non sono segreti**: identificano il progetto e sono visibili a
chiunque apra il sito. La sicurezza la fanno le regole di Firestore del punto 3.

## 5. Collegare l'app

Due modi, equivalenti:

* **Nel file** — incolla i valori in `public/js/firebase-config.js`. Valgono per
  chiunque apra il sito.
* **Dall'app** — scheda **Cloud → Configurazione Firebase**, incolla il blocco e
  premi *Salva configurazione*. Resta solo in quel browser: comodo per provare.

Fatto questo, nella scheda Cloud compaiono *Accedi con Google* e il salvataggio
dei progetti sul cloud.

## 6. Pubblicare online

```bash
cp .firebaserc.example .firebaserc     # scrivi dentro l'ID progetto del punto 1
npx firebase-tools login               # si apre il browser: accedi con il tuo account
npx firebase-tools deploy --only hosting,firestore:rules
```

Al termine il sito è su `https://<project-id>.web.app`, raggiungibile da
computer e telefono, installabile sulla schermata Home.

### Pubblicazione automatica (facoltativa)

`.github/workflows/firebase-hosting.yml` pubblica a ogni push sul ramo `main`.
Richiede due segreti nel repository GitHub (Settings → Secrets and variables →
Actions):

| Segreto | Dove si prende |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Impostazioni progetto → Account di servizio → Genera nuova chiave privata (incolla tutto il JSON) |
| `FIREBASE_PROJECT_ID` | l'ID progetto del punto 1 |

Il comando `npx firebase-tools init hosting:github` li configura da solo.

## Problemi frequenti

| Sintomo | Causa |
|---|---|
| `auth/unauthorized-domain` all'accesso | il dominio non è fra quelli autorizzati (punto 2) |
| `auth/operation-not-allowed` | il metodo di accesso non è abilitato (punto 2) |
| `permission-denied` nel salvataggio | regole non pubblicate: `npx firebase-tools deploy --only firestore:rules` |
| Il popup di Google non si apre su telefono | normale: l'app ripiega da sola sul reindirizzamento |
| "Firebase non configurato" nella scheda Cloud | manca il punto 5 |
