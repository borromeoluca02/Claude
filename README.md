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
  1. **✏️ Disegna percorso** — tocchi la mappa dove vuoi passare e l'app
     inserisce la curva di raccordo (raggio predefinito) più il rettilineo.
  2. **Manuale** — pulsanti *+ Rettilineo* / *+ Curva*, con campi numerici per
     lunghezza, raggio, angolo, senso e larghezza.
  3. **Automatico** — vedi *Generazione*.
* Si trascinano: il punto di partenza, la direzione, i pallini di fine elemento.
  Sul pallino di una curva selezionata si controllano **insieme raggio e angolo**.
* **Larghezza corsia** per singolo tratto, con restringimento progressivo
  (es. da 5 m a 3 m dentro lo stesso tratto). Il valore nominale è 5 m, il
  minimo di regola 3 m: si può scendere sotto, ma il tratto diventa rosso.
* Al centro dell'asse del percorso è sempre scritto lo **sviluppo totale**
  (misurato sul centro della corsia), con il campo di larghezza min–max.

### Strutture
* Libreria pronta: rampa, doppia, table top, step up/down, gobba, whoops,
  rollers, piramide, wall, parabolica, chicane, curva sopraelevata.
* Ogni sagoma vista dall'alto riporta **nome e altezza all'interno** e le
  **dimensioni sui lati** (lunghezza e larghezza in metri).
* Posizionamento: tocco sulla mappa, trascinamento lungo il percorso
  (progressiva + scostamento laterale) oppure coordinate libere.
* Accanto a ogni struttura compare **Δ**, la distanza dall'ostacolo precedente.

### Controllo delle distanze (verde / rosso)
* Fra due ostacoli consecutivi devono esserci fra **3 m e 25 m** (valori
  modificabili nella scheda *Regole*). **Anche una curva è un ostacolo**, così
  come la griglia di partenza o la rampa di lancio.
* Dentro l'intervallo → bordo **verde**. Fuori → bordo **rosso**, con il motivo
  scritto nella scheda della struttura e nella scheda *Verifica*.
* **Nessun controllo blocca il posizionamento**: la struttura resta dove l'hai
  messa, viene soltanto segnalata. Il pulsante *Porta in posizione valida* la
  sposta alla progressiva valida più vicina, se vuoi.
* Sono segnalati allo stesso modo: corsia sotto il minimo, raggio sotto il
  minimo, percorso o struttura che escono dall'area, incroci del tracciato.

### Partenza
* **Roller cross** — griglia con *4 corsie da 1,25 m* (fronte 5 m), box di
  partenza da *1,00 × 1,25 m* ciascuno, e dopo la linea *5 m* di corsie guidate
  che seguono il tracciato. Numero di corsie, larghezze e profondità sono
  modificabili; il totale è ricalcolato al volo.
* **Skate cross** — la partenza è su una **rampa di lancio** (nome, lunghezza,
  larghezza, altezza configurabili): niente box né corsie.
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

## Struttura del codice

```
public/
  index.html              pagina e scheletro dell'interfaccia
  css/app.css             interfaccia (desktop + cassetto mobile)
  css/svg.css             stili del disegno (inclusi anche negli export)
  js/geometry.js          vettori, poligoni, polilinee
  js/model.js             schema del progetto, libreria strutture, default
  js/track.js             geometria del tracciato, ostacoli, validazione
  js/generator.js         generazione automatica delle varianti
  js/render.js            disegno SVG (quote, colori, miniature)
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
