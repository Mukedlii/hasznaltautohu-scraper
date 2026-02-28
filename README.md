# 🏠 Ingatlan.com Scraper

Automatikusan gyűjt ingatlan hirdetéseket az ingatlan.com-ról. Tökéletes ingatlanpiaci elemzéshez, árak figyeléséhez és adatelemzéshez.

## Mit gyűjt?

- 💰 **Ár** – hirdetési ár forintban
- 📍 **Cím** – pontos helyszín
- 📐 **Méret** – négyzetméter
- 🚪 **Szobák száma**
- 🔗 **Hirdetés linkje**
- 🏷️ **Típus** – eladó / kiadó
- 🕐 **Scrape időpontja**

## Hogyan használd?

1. Add meg a keresési URL-t az ingatlan.com-ról (pl. szűrj kerületre, típusra, árra)
2. Állítsd be hány oldalt scrape-eljen
3. Opcionálisan szűrj ár alapján
4. Futtasd le és töltsd le az eredményt CSV/JSON/Excel formátumban

## Példa input

```json
{
    "searchUrl": "https://ingatlan.com/lista/elado+lakas+budapest+XI-ker",
    "maxPages": 10,
    "maxPrice": 50000000
}
```

## Output formátum

```json
{
    "price": "45 000 000 Ft",
    "address": "Budapest, XI. kerület, Kelenföld",
    "size": "65 m²",
    "rooms": "3 szoba",
    "type": "Eladó",
    "link": "https://ingatlan.com/...",
    "scrapedAt": "2026-02-28T10:00:00.000Z"
}
```

## Felhasználási területek

- 📊 Ingatlanpiaci árelemzés
- 🔔 Árfigyelés (futtasd rendszeresen)
- 🗺️ Kerületek összehasonlítása
- 📈 Trendek követése
