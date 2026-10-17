# Plan dvorišta

Planer rubnjaka za dvorište. Oblike slažeš na platnu, a za svaki oblik i za cijelo dvorište
aplikacija računa komade od 100 i 33 cm, rezove, težinu i cijenu.

```sh
pnpm install
pnpm dev        # http://localhost:6123 (i na lokalnoj mreži, za mobitel)
```

Plan se automatski sprema u `data/plan.json`, preko `/api/plan` u `vite.config.ts`. Kopija
ostaje i u pregledniku, pa aplikacija radi i kad poslužitelj nije dostupan.

Nepravilni oblici uvoze se kao SVG iz Photoshopa (izbornik → *Uvezi SVG*, ili SVG povuci na platno).
Svaki zatvoreni obris postaje oblik, a rub počinje na oštrom kutu ili na prijelazu između ravnog dijela i luka.

## Provjera

```sh
pnpm typecheck
pnpm e2e        # dev server mora raditi; data/plan.json vraća na stanje prije testa
```

Prečaci su kao u Excalidrawu, popis se otvara tipkom `?` u aplikaciji.
