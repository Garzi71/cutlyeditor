# Cutly – video editor zdarma

Desktopový video editor ve stylu CapCut, bez paywallů. Vše běží lokálně na tvém PC.

## Jak ho spustit

**Nejjednodušší:** dvakrát klikni na `Spustit Cutly.bat`.

Nebo v terminálu ve složce projektu:

```bash
npm install
```

```bash
npm run dev
```

Potřebuješ mít nainstalované **Node.js** a **FFmpeg** (příkazy `ffmpeg` a `ffprobe` musí jít spustit z terminálu).

## Co umí (fáze 1)

- Nový projekt s volbou formátu **16:9 / 9:16 / 1:1 / 4:5**, rozlišení (720p–4K) a fps
- Import videa, zvuku a obrázků (tlačítkem nebo přetažením z Průzkumníka)
- Timeline s více stopami: hlavní stopa, překryvné stopy, audio stopy
- Přetahování klipů, zkracování za okraje, přichytávání (magnet), přesun na novou stopu
- Střih v místě přehrávací hlavy, mazání, duplikace, **undo/redo**
- Náhledy snímků a zvukové vlny přímo v timeline
- Přehrávač s posunem, měřítkem a rotací klipu (táhni v náhledu nebo použij panel vpravo)
- Průhlednost, hlasitost až 200 %, zamykání / skrývání / ztlumení stop
- Export do MP4 (H.264 nebo H.265) přes **GPU NVIDIA (NVENC)** nebo CPU, s ukazatelem průběhu
- Ukládání a otevírání projektů (`.cutly`), seznam posledních projektů

## Text a titulky (fáze 2)

- Záložka **Text**: tlačítko *Add text* a 10 předvoleb stylů (obrys, box, neon…)
- 10 přibalených fontů s češtinou (Montserrat, Poppins, Inter, Bebas Neue…) + všechny fonty nainstalované ve Windows
- Úprava textu: font, tloušťka, velikost, barva, obrys, pozadí, stín, zarovnání, velká písmena, šířka řádku
- **Automatické titulky** (Whisper large-v3-turbo, běží offline na tvém PC):
  - styl *Word by word* (2–3 slova, zvýraznění právě vysloveného slova) nebo *Classic* (věty dole)
  - jazyk automaticky nebo ručně (čeština, slovenština, angličtina…)
  - při prvním použití se stáhne asi 583 MB (s NVIDIA zrychlením navíc 685 MB), pak to funguje bez internetu
  - *Apply this style to all captions* nastaví stejný vzhled všem titulkům najednou
- Text i titulky se exportují přesně tak, jak vypadají v náhledu

## Klávesové zkratky

| Akce | Zkratka |
|---|---|
| Přehrát / pauza | Mezerník |
| Střih | S nebo Ctrl+B |
| Smazat | Delete |
| Duplikovat | Ctrl+D |
| Zpět / Znovu | Ctrl+Z / Ctrl+Y |
| Posun o snímek | ← → (se Shiftem o sekundu) |
| Začátek / konec | Home / End |
| Zoom timeline | Ctrl + kolečko |
| Uložit | Ctrl+S (Ctrl+Shift+S = uložit jako) |
| Export | Ctrl+E |

## Pro kamarády: instalace

1. Otevři [Releases](https://github.com/Garzi71/cutlyeditor/releases/latest) a stáhni `Cutly-Setup-x.y.z.exe`.
2. Spusť ho. Windows může ukázat „Systém Windows ochránil počítač“ (aplikace není podepsaná placeným certifikátem). Klikni na **Další informace → Přesto spustit**.
3. Hotovo. FFmpeg je přibalený, nic dalšího instalovat nemusíš.

Když vyjde nová verze, Cutly sám ukáže v pravém dolním rohu nabídku **Download**. Po stažení stačí **Restart now**.

## Vydání nové verze (pro autora)

Všechny změny musí být commitnuté. Pak stačí jeden příkaz:

```bash
npm run release
```

Ten zvýší verzi (např. 0.1.0 → 0.1.1), vytvoří tag a pošle ho na GitHub. GitHub Actions pak asi za 5–10 minut sestaví instalátor a zveřejní ho v Releases. U větší novinky použij `npm run release:minor` (0.1.x → 0.2.0).

Průběh uvidíš na záložce **Actions** v repozitáři.

Lokální sestavení instalátoru (bez zveřejnění) jde přes `npm run dist`. Instalátor se objeví ve složce `release/`. Předtím je potřeba mít FFmpeg ve `resources/ffmpeg` (stáhne ho `scripts/fetch-ffmpeg.ps1`).

## Plán dalších fází

2. **Text a titulky:** textové vrstvy, fonty a styly, automatické titulky z řeči (Whisper, offline)
3. **Barvy:** korekce barev, LUT, filtry, automatická korekce
4. **Efekty:** přechody, rychlost, keyframe animace

## Struktura kódu (pro zvědavé)

- `src/main/` – „backend“: okno aplikace, FFmpeg (`ffmpeg.ts`), export (`exporter.ts`)
- `src/preload/` – bezpečný most mezi backendem a rozhraním
- `src/renderer/src/` – rozhraní v Reactu
  - `store.ts` – stav aplikace a všechny editační operace (+ undo)
  - `engine/player.ts` – přehrávač náhledu
  - `components/` – jednotlivé panely (timeline, přehrávač, inspektor…)
- `src/shared/types.ts` – datový model projektu
