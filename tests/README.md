# Tests automatiques

Ces tests ouvrent l’application dans un navigateur sans fenêtre (Chromium, via Playwright),
sur un téléphone simulé (iPhone 13 ou Pixel 7), et vérifient qu’elle se comporte comme prévu.

- Ils testent **les fichiers du dépôt** (le code de la branche) : rien n’est publié.
- **Aucune donnée réelle** n’est touchée : Supabase est remplacé par un faux serveur en mémoire,
  les polices et services extérieurs sont simulés. Pas besoin d’internet (sauf pour l’installation).

## Installation (une fois)

Il faut [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
cd tests
npm install
npx playwright install chromium
```

## Lancer les tests

```bash
cd tests
npm test                 # tous les tests, puis un résumé
node run.js photos       # seulement les tests dont le nom contient « photos »
node courses.test.js     # un seul fichier
SHOTS=captures npm test  # enregistre aussi des captures d’écran dans tests/captures/
```

Chaque vérification affiche ✓ ou ✗ ; le résumé final indique le nombre d’échecs.

## Ce qui est testé

| Fichier | Contenu |
|---|---|
| `calendrier.test.js` | semaine affichée, jours passés, choix d’une recette pour un créneau (cartes, recherche, filtres saisons / ingrédients), retrait, nouvelle recette depuis un créneau |
| `recettes.test.js` | onglet Recettes (cartes, filtres), fiche (étapes, portions − / +), menu ⋯, formulaire, pop-up « modifications non enregistrées », validation des ingrédients, suppression |
| `import-texte.test.js` | lecture des lignes d’ingrédients (unités, fractions, « Sel, poivre »…), 5 textes de livres de cuisine (`fixtures/`), import dans le formulaire |
| `import-lien.test.js` | import depuis un lien (Marmiton, blog WordPress) avec la vraie fonction de lecture, messages d’erreur, « Remplir depuis ce lien » |
| `fonction-import.test.js` | la fonction Supabase `import-recette` elle-même : lecture des pages, adresses interdites (réseau interne), redirections, connexion obligatoire |
| `courses.test.js` | ajout, coche, menu « Vider », import des ingrédients d’une semaine (regroupement des quantités) |
| `photos.test.js` | Android (appareil photo / galerie), iPhone (un seul bouton), photos HEIC, fichiers illisibles, photo de profil |
| `apparence.test.js` | couleur des boutons et du fond, gardées sur l’appareil |
| `fusion.test.js` | fusion des modifications faites en même temps sur deux appareils, synchronisation avec le foyer |
| `publiques.test.js` | critères pour publier, pseudo obligatoire, onglet Recherche, ajout d’une recette publique |
| `sql.test.js` | `supabase_setup.sql` exécuté deux fois sur un PostgreSQL local jetable, droits d’accès et fonctions (foyers, pseudos, recettes publiques, notes). Ignoré si PostgreSQL n’est pas installé (`PG_BIN=/chemin/bin` pour l’indiquer) |

## Organisation

- `lib/app.js` : outils communs (ouvrir l’application, faux Supabase, glisser du doigt…).
- `fixtures/` : textes de recettes, pages web et photos utilisés par les tests.
