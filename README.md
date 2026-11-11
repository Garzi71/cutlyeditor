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
  - 12 animovaných stylů jako na Instagramu a TikToku (Karaoke, Pop, Highlight box, One word, Build up, Bounce, Neon…) s živým náhledem, nebo klasické titulky dole
  - jazyk automaticky nebo ručně (čeština, slovenština, angličtina…)
  - při prvním použití se stáhne asi 583 MB (s NVIDIA zrychlením navíc 685 MB), pak to funguje bez internetu
  - *Apply this style to all captions* nastaví stejný vzhled všem titulkům najednou
- Text i titulky se exportují přesně tak, jak vypadají v náhledu

## Barvy a filtry (fáze 3)

- Záložka **Color** u každého videa a fotky (vpravo):
  - **Auto color**: jedním kliknutím srovná vyvážení bílé, expozici a černou/bílou; výsledek jde doladit posuvníky
  - **Match**: přizpůsobí barvy klipu jinému klipu (např. dva různé mobily)
  - Light (expozice, kontrast, světla, stíny, bílá, černá), Color (teplota, odstín, saturace, živost)
  - **HSL**: úprava jednotlivých barev (např. jen modré nebe), **křivky** (All/R/G/B), ostrost, vinetace
  - *Apply this look to all clips* zkopíruje vzhled na všechny klipy
- Záložka **Filters** (vlevo): 20 filtrů s náhledem na tvém klipu, intenzita filtru, **import vlastních .cube LUT**
- **Adjustment layer**: vrstva na timeline, která obarví všechno pod sebou (jako v CapCutu)
- Náhled i export počítají barvy stejně (3D LUT), takže výsledné video vypadá přesně jako v editoru

## Pohyb, rychlost, přechody a efekty (fáze 4)

- **Keyframy** u pozice, měřítka, rotace, průhlednosti a hlasitosti: kosočtverec ◆ vedle vlastnosti přidá klíčový snímek na místě přehrávací hlavy, šipky skáčou mezi nimi, u každého jde nastavit plynulost (Smooth, Linear, Ease in/out, Hold). Tažení klipu v přehrávači keyframy rovnou zapisuje.
- **Speed**: stálá rychlost 0,1×–100×, **rychlostní rampy** (Montage, Hero, Bullet, Jump cut…) s upravitelnou křivkou, **pozpátku**. Hlas při zrychlení nemění výšku.
- **Přechody**: 15 druhů (prolínačka, přes černou/bílou, posuny, stěrače, zoom, rozmazání, kruh, otočení). Najeď myší na střih mezi dvěma klipy na timeline a klikni na **+**, nebo vyber klip a přechod v záložce Transitions.
- **Animation**: příchod a odchod klipu nebo textu (fade, zoom, slide, pop, spin, blur, u textu i psací stroj).
- **Effects**: 10 video efektů jako vrstva na timeline (rozmazání, otřes, glitch, záblesk, VHS, zrno, RGB split, zrcadlo, pulzující zoom, pixelizace).
- **Zvuk**: fade in/out a keyframy hlasitosti.
- Export kreslí každý snímek stejným kódem jako přehrávač, takže video vypadá přesně jako v editoru. Trvá zhruba tak dlouho, jak je video dlouhé (1080p).

## AI nástroje a sociální sítě (fáze 5)

- **Remove background** (záložka Video): vystřihne lidi z videa bez zeleného plátna (Robust Video Matting, běží offline). Model (15 MB) se stáhne při prvním zapnutí. Pod klip dej obrázek nebo video, které bude novým pozadím. Běží na grafice, a když ji model na daném počítači nepočítá správně, Cutly to sám pozná a přepne na procesor (pomalejší, hlavně export).
- **Remove silences** (záložka Audio): najde pauzy v řeči, ukáže je červeně na timeline a po potvrzení je vystřihne. Práh hlasitosti se nastaví sám podle nahrávky.
- **Noise reduction** (záložka Audio): odstraní šum a hučení na pozadí (RNNoise), síla jde nastavit.
- **Šablony**: 6 vestavěných na úvodní obrazovce (Vlog intro, TikTok hook, Slideshow…), vlastní projekt jde uložit jako šablonu (ikona v horní liště) a sdílet jako soubor `.cutlytemplate`.
- **Export pro sítě**: předvolby TikTok, Reels, Shorts, YouTube, Instagram, X. Když má výstup jiný tvar než projekt, vybereš ořez, rozmazané pozadí nebo černé pruhy.

## Nový vzhled a animované titulky (fáze 6)

- **Animované šablony titulků**: v záložce Text → *Auto captions* vybereš styl ještě před generováním, u hotových titulků ho změníš v inspektoru (záložka *Templates*) pro všechny najednou. Fungují i na obyčejný text.
- **Word animation**: jak se slova objevují (všechna / postupně / po jednom), příchod (pop, bounce, slide, fade, zoom), box za slovem, zvětšení a záře právě vysloveného slova.
- Efekty a přechody mají **živé náhledy**, po najetí myší se přehrají.
- Přehrávač: **náhled jako na TikToku, Instagram Reels nebo YouTube Shorts** (ikona telefonu, pro poměr 9:16), bezpečné zóny a celá obrazovka.
- **Poměr stran** se mění přímo v přehrávači (16:9, 4:3, 2.35:1, 9:16, 3:4, 1:1… , podle původního videa nebo vlastní).
- **Vodicí čáry s přichytáváním**: při posouvání klipu nebo textu v přehrávači se přichytí ke středu a okrajům (Alt přichytávání vypne).
- Sjednocený vzhled: stejné výšky ovládacích prvků, čitelnější texty, sbalitelné sekce barev, vlastní potvrzovací okna, export s odhadem velikosti souboru.

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
5. **AI nástroje:** odstranění pozadí, šumu a ticha, šablony, export pro sítě
6. **Vzhled:** přepracované rozhraní, animované šablony titulků, živé náhledy efektů

## Struktura kódu (pro zvědavé)

- `src/main/` – „backend“: okno aplikace, FFmpeg (`ffmpeg.ts`), export (`exporter.ts`)
- `src/preload/` – bezpečný most mezi backendem a rozhraním
- `src/renderer/src/` – rozhraní v Reactu
  - `store.ts` – stav aplikace a všechny editační operace (+ undo)
  - `engine/player.ts` – přehrávač náhledu
  - `components/` – jednotlivé panely (timeline, přehrávač, inspektor…)
- `src/shared/types.ts` – datový model projektu
