# CalendCook
Calendrier de recettes de cuisine

## Import d'une recette depuis un site

Dans « Nouvelle recette », le bloc **🔗 Importer depuis un site** remplit le formulaire
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
