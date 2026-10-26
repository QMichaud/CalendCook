# CalendCook
Calendrier de recettes de cuisine

## Import d'une recette depuis un site

Dans « Nouvelle recette », le bloc **⚡ Remplir automatiquement** → « Depuis un lien » remplit le formulaire
(nom, photo, durée, nombre de personnes, ingrédients, étapes) à partir d'un lien Marmiton,
750g, Cuisine AZ, Ptitchef… Rien n'est enregistré avant « Enregistrer » : on relit, on corrige.

L'import passe par une petite fonction Supabase (un navigateur n'a pas le droit de lire
directement la page d'un autre site). Elle est gratuite (plan gratuit : 500 000 appels par mois)
et n'utilise aucune IA. À installer **une seule fois** :

1. Supabase → ton projet → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nom de la fonction : `import-recette` (exactement).
3. Remplace tout le code proposé par le contenu de
   [`supabase/functions/import-recette/index.ts`](supabase/functions/import-recette/index.ts).
4. **Deploy function**. Laisse l'option « Verify JWT » activée.

Avec l'outil en ligne de commande Supabase, c'est équivalent à :
`supabase functions deploy import-recette`.

La fonction n'accepte que les personnes connectées à l'application et ne lit que des pages
publiques (adresses internes refusées).

L'onglet **« Depuis un texte »** fonctionne sans rien installer : on colle le texte d'une recette
(copié depuis une note, un message, ou la photo d'un livre de cuisine) et l'application repère
le nombre de personnes, les ingrédients et les étapes. Ce qui n'est pas utilisé (introduction,
astuces…) reste consultable sous les ingrédients.

## Tests automatiques

Le dossier [`tests/`](tests/README.md) contient des tests qui ouvrent l'application dans un
navigateur simulé (sans toucher aux vraies données) : `cd tests && npm install && npm test`.
