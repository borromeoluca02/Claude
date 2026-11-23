# Cross Builder — configuratore di percorsi roller cross & skate cross

Applicazione web 2D (funziona da computer e da telefono, anche con il dito) per
disegnare e verificare percorsi di **roller cross** e **skate cross** dentro
un'area di qualsiasi forma. Niente da installare: è una pagina statica più
Firebase (Hosting + Authentication + Firestore) per il salvataggio online.

---

## Cosa sa fare

### Area di gara
* Rettangolo, **trapezio**, **triangolo** o poligono con un numero qualsiasi di vertici.
* Ogni vertice è modificabile a mano (tabella X/Y) o trascinabile sulla mappa
  con il pulsante ◇ **Modifica area**: forme irregolari comprese.
* Sui lati dell'area compaiono le quote; in alto superficie e perimetro.

### Percorso
* Il tracciato è una catena di **rettilinei** e **curve** con continuità di
  tangente: le curve hanno raggio e angolo propri, il percorso non si spezza mai.
* Tre modi per costruirlo:
  1. **✏️ Disegna percorso** — muovi il puntatore e vedi in tempo reale il
     tratto che stai per aggiungere, con lunghezza e sviluppo totale: la corsia
     si allunga e si accorcia seguendo il mouse, e un clic fissa la misura.
     Dopo il primo tratto l'app inserisce da sola la curva di raccordo (raggio
     predefinito) più il rettilineo tangente. Se distanze o misure non tornano
     l'anteprima diventa rossa e dice perché, ma il clic vale comunque.
  2. **Manuale** — pulsanti *+ Rettilineo* / *+ Curva*, con campi numerici per
     lunghezza, raggio, angolo, senso e larghezza.
  3. **Automatico** — vedi *Generazione*.
* Si trascinano: il punto di partenza, la direzione, i pallini di fine elemento.
  Sul pallino di una curva selezionata si controllano **insieme raggio e angolo**.
* **Larghezza corsia** per singolo tratto, con restringimento progressivo
  (es. da 5 m a 3,5 m dentro lo stesso tratto). Il regolamento chiede 5 m sul
  rettilineo di partenza e sulla prima curva e almeno 3,5 m sul resto: sotto il
  minimo impostato il tratto diventa rosso, ma resta modificabile.
* Al centro dell'asse del percorso è sempre scritto lo **sviluppo totale**
  (misurato sul centro della corsia), con il campo di larghezza min–max.

### Strutture
* Libreria con gli ostacoli della tabella dell'Art. 64, raggruppati come nel
  regolamento (**Gimkane**, **Barriere**, **Rampe**) e quotati secondo i disegni
  dell'**Allegato 3**. Accanto a ogni gruppo c'è il contatore delle quote
  obbligatorie (1 Gimkana, 4 Barriere, 3 Rampe di almeno 2 tipologie).
* Ogni sagoma vista dall'alto riporta **nome e altezza all'interno** e le
  **dimensioni sui lati** (lunghezza e larghezza in metri).
* Posizionamento: tocco sulla mappa, trascinamento lungo il percorso
  (progressiva + scostamento laterale) oppure coordinate libere.
* Accanto a ogni struttura compare **Δ**, la distanza dall'ostacolo precedente.

### Controllo delle distanze (verde / rosso)
* Fra due ostacoli consecutivi devono esserci fra **5 m e 25 m** (Art. 65,
  valori modificabili nella scheda *Regole*). **Anche una curva è un ostacolo**,
  così come la griglia di partenza o la rampa di lancio.
* Il **primo ostacolo** si misura dalla **linea di partenza** e non può stare a
  meno di **12 m**; fra l'**ultimo ostacolo e l'arrivo** servono almeno **10 m**.
* Dentro l'intervallo → bordo **verde**. Fuori → bordo **rosso**, con il motivo
  scritto nella scheda della struttura e nella scheda *Verifica*.
* **Nessun controllo blocca il posizionamento**: la struttura resta dove l'hai
  messa, viene soltanto segnalata. Il pulsante *Porta in posizione valida* la
  sposta alla progressiva valida più vicina, se vuoi.
* Sono segnalati allo stesso modo: corsia sotto il minimo, raggio sotto il
  minimo, percorso o struttura che escono dall'area, incroci del tracciato.

### Partenza
* **Roller cross** — griglia con *4 corsie da 1,25 m* (fronte 5 m), box di
  partenza da *1,00 × 1,25 m* ciascuno, e dopo la linea *5 m* di corsie separate
  che seguono il tracciato. Numero di corsie, larghezze e profondità sono
  modificabili; il totale è ricalcolato al volo.
* **Skate cross** — la partenza è su una **rampa di lancio**, preimpostata con le
  quote dell'Allegato 3 (piattaforma 2,00 m a quota 2,00 m, scivolo 4,80 m a 25°,
  ingombro a terra 6,35 m): niente box né corsie.
* **Categoria** (Giovanissimi/Esordienti, Ragazzi/Allievi/Master,
  Juniores/Seniores): imposta le altezze normate di salti a secco (30/40/50 cm)
  e sottopassi (90/110 cm) e aggiorna gli ostacoli già posati.
* In entrambi i casi la zona di partenza vale come primo ostacolo: la distanza
  della prima struttura si misura dalla fine delle corsie guidate (o della rampa).

### Generazione automatica
Scheda **Genera**. I parametri sono tutti facoltativi: *i campi lasciati vuoti
non vincolano la generazione*.

| Parametro | Effetto |
|---|---|
| Larghezza percorso | larghezza della corsia delle varianti |
| Lunghezza totale | obiettivo di sviluppo dell'asse |
| Curve minime | numero minimo di curve |
| Curve richieste (raggio + quantità) | es. «4 curve con R 8 m» |
| Numero strutture | se vuoto, l'app riempie da sola i tratti idonei |
| Margine dal bordo | distanza di sicurezza dal perimetro dell'area |
| Schema | serpentina, ovale, spirale, libera o tutti insieme |
| Quante opzioni | quante varianti proporre |

Ogni variante viene disegnata in miniatura con sviluppo, numero di curve,
strutture e **le differenze rispetto a quanto hai chiesto** (per esempio
«lunghezza 174 m invece di 220 m» oppure «mancano 2 curve R8»): così si vede
subito cosa l'area riesce davvero a contenere. *Usa questa opzione* la carica
nell'editor, dove resta modificabile come un percorso disegnato a mano.

### Verifica di conformità
La scheda *Verifica* confronta il progetto con il Regolamento Tecnico e elenca
ogni controllo con esito e riferimento all'articolo. Per il roller cross:
lunghezza 250–300 m, rettilineo di partenza ≥ 20 m, larghezze 5 m / 3,5 m,
almeno 2 curve a destra e 2 a sinistra, prima curva vicina alla partenza larga
5 m e di ampiezza > 50°, 12 m dalla partenza al primo ostacolo, 10 m
dall'ultimo ostacolo all'arrivo, quote degli ostacoli per gruppo, misure minime
delle rampe (larghezza 1,80 m, altezza 0,40 m), altezze per categoria, gimkane
su rettilineo largo almeno 5 m. Per lo skate cross (Art. 102): larghezza 5 m,
4 gate su rampa alta al massimo 2 m, almeno 2 curve di raggio < 5 m, 3 rampe con
h ≥ 0,50 m e 2 funbox/bank to bank alti 1,50–2 m e larghi 4 m.

Anche il generatore automatico lavora con questi vincoli: senza una lunghezza
obiettivo punta all'intervallo 250–300 m, alterna le curve per averne almeno 2
per lato, lascia il tratto di arrivo e distribuisce gli ostacoli coprendo le
quote dei tre gruppi.

### Tavola in scala con cartiglio
La scheda *Tavola* produce l'elaborato da allegare al programma di gara, nel
formato che il regolamento chiede ("planimetria quotata o in scala metrica,
completa di ostacoli e relative specifiche", Art. 65.3):

* **Foglio** A4 → A0, orizzontale o verticale, e **scala** 1:50 → 1:2000 oppure
  automatica (sceglie la più grande che fa stare l'area nel foglio). Il disegno
  è costruito in millimetri: stampato al 100% le misure sono in scala reale.
* **Foglio 1 — planimetria**: area quotata lato per lato, corridoio di gara,
  asse, griglia o rampa di partenza, ostacoli numerati, progressive ogni 25 m
  (passo regolabile), sviluppo dell'asse, scala grafica e griglia metrica
  opzionale.
* **Foglio 2 — distinta degli ostacoli**: la sequenza di percorrenza con tipo,
  gruppo, progressive di inizio e fine, distanza dal precedente, dimensioni,
  altezza ed esito del controllo. Le curve sono incluse, perché contano come
  ostacoli.
* **Foglio 3 — verifica di conformità**: tutti i controlli con esito, valore
  rilevato e articolo di riferimento, più le segnalazioni e le note.
* **Cartiglio** su ogni foglio: disciplina, nome e località, dati del tracciato,
  categoria, pavimentazione, esito della verifica, scala, formato, data,
  redattore, organizzazione e numero di foglio.
* Uscite: **Stampa / PDF** (apre i fogli impaginati a misura reale: da lì
  *Salva come PDF* con margini «nessuno» e scala **100%**, senza «adatta alla
  pagina»), **SVG** (un file per foglio, vettoriale) e **PNG a 200 dpi**.

### Salvataggio ed export
* Salvataggio automatico nel browser a ogni modifica, più l'elenco dei progetti
  salvati in locale.
* Con Firebase configurato: accesso Google o anonimo e progetti sincronizzati
  su Firestore (`users/{uid}/projects/{id}`), con cache offline.
* Export **PNG**, **SVG** (quotato), **CSV** (distinta delle strutture con
  progressive e distanze) e **JSON** del progetto; import da JSON.

---

## Avvio in locale

Serve un qualsiasi server statico (i moduli ES non si aprono da `file://`):

```bash
cd public
python3 -m http.server 8099
# poi apri http://127.0.0.1:8099
```

L'app funziona già così, salvando nel browser. Firebase serve solo per il cloud.

## Pubblicazione su Firebase

1. **Crea il progetto** su <https://console.firebase.google.com>.
2. **Authentication** → *Sign-in method* → abilita **Google** e, se lo vuoi,
   **Anonimo**.
3. **Firestore Database** → crea il database (modalità produzione).
4. **Impostazioni progetto → Le tue app → Web**: registra un'app e copia
   l'oggetto `firebaseConfig`.
5. Incolla la configurazione in uno dei due modi:
   * dentro `public/js/firebase-config.js` (vale per tutti gli utenti), oppure
   * nell'app: scheda **Cloud → Configurazione Firebase** (resta nel browser).
6. Pubblica:

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc     # e metti il tuo project id
firebase deploy --only hosting,firestore:rules
```

Da quel momento il sito è raggiungibile da internet su
`https://<project-id>.web.app`, da computer e da telefono (su iPhone e Android
si può aggiungere alla schermata Home: è una PWA con manifest).

Le regole in `firestore.rules` permettono a ogni utente di leggere e scrivere
**solo** i propri progetti.

---

## Riferimenti di regolamento

I valori normativi sono raccolti in un unico file, `public/js/regulation.js`,
così che restino facili da aggiornare quando esce una nuova stagione.

| Voce | Valore | Articolo |
|---|---|---|
| Lunghezza totale roller cross | 250–300 m | 65.4 |
| Larghezza minima percorso | 3,5 m (5 m su partenza e prima curva) | 65.4 |
| Rettilineo di partenza | min 20 m, largo min 5 m | 65.4 |
| Corsie separate in partenza | 4 box da 1,00 m × ≥1,25 m, per 5 m dopo la linea | 65.4 |
| Distanza fra ostacoli | min 5 m — max 25 m | 65.4 |
| Partenza → primo ostacolo | min 12 m | 65.6 |
| Ultimo ostacolo → arrivo | min 10 m | 65.4 |
| Curve obbligatorie | almeno 2 a destra e 2 a sinistra | 65.4 |
| Curva entro 10 m dal rettilineo iniziale | larga ≥ 5 m, ampiezza > 50° | 65.4 |
| Rampe | larghezza ≥ 1,80 m, altezza ≥ 0,40 m | 65.4 |
| Gruppi di ostacoli | ≥1 Gimkana, ≥4 Barriere, ≥3 Rampe di ≥2 tipologie | 64 |
| Salti a secco / sottopassi | 30-40-50 cm / 90-110 cm secondo la categoria | 65.4 |
| Gimkane | ≥3 elementi a 3–5 m, su rettilineo largo ≥ 5 m | 65.4 |
| Skate cross | largh. ≥5 m, 4 gate su rampa ≤2 m, ≥2 curve R<5 m, ≥3 rampe h≥0,50 m, ≥2 funbox h 1,50–2 m e largh. 4 m | 102.2 |

Le quote degli ostacoli vengono dai disegni dell'Allegato 3, che il regolamento
stesso dichiara *"misure puramente indicative"*: nell'app sono valori di
partenza e si possono cambiare per ogni singolo ostacolo.

Fonte: *FISR — Regolamento Tecnico Inline Freestyle 2025-2026 (v. 19-1-2026)*.

## Struttura del codice

```
public/
  index.html              pagina e scheletro dell'interfaccia
  css/app.css             interfaccia (desktop + cassetto mobile)
  css/svg.css             stili del disegno (inclusi anche negli export)
  js/geometry.js          vettori, poligoni, polilinee
  js/regulation.js        valori del Regolamento Tecnico FISR 2025-2026
  js/model.js             schema del progetto, libreria strutture, default
  js/track.js             geometria del tracciato, ostacoli, validazione
  js/generator.js         generazione automatica delle varianti
  js/render.js            disegno SVG (quote, colori, miniature)
  js/plate.js             tavola in scala: fogli in mm, cartiglio, distinta
  js/interact.js          pan, zoom, pinch, trascinamenti, strumento disegno
  js/ui.js                pannelli dell'interfaccia
  js/store.js             Firebase, salvataggio locale, import/export
  js/app.js               stato, azioni, cronologia (annulla/ripeti)
tools/e2e.mjs             test end-to-end con Playwright
firebase.json             Hosting + Firestore
firestore.rules           regole di accesso
```

I moduli `geometry`, `model`, `track` e `generator` non usano il DOM: si possono
importare da Node per provare calcoli e generazione senza browser.

## Test

```bash
cd public && python3 -m http.server 8099 &   # server locale
node tools/e2e.mjs                            # richiede playwright + chromium
```

Il test apre l'app su desktop e su telefono simulato, prova generazione,
strumento disegno, posizionamento strutture, restringimento corsia, modifica
dell'area, cambio disciplina, undo/redo ed export, e segnala eventuali errori JS.

## Scorciatoie

| Tasto | Azione |
|---|---|
| Ctrl/⌘ + Z | annulla |
| Ctrl/⌘ + Shift + Z | ripeti |
| Canc / Backspace | elimina l'elemento o la struttura selezionata |
| Esc | esce dallo strumento attivo |
| rotella / pinch | zoom |
| trascinamento su area vuota | sposta la vista |
