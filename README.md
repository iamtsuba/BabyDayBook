# Baby Day Book

Journal de la journée de bébé (allaitement, tire-lait, biberon, bain, couches, sommeil, médicaments), en **PWA** : un seul fichier `index.html`, installable sur le téléphone.

- Hébergement : GitHub Pages
- Données : Supabase (tables `babydaybook_children` et `babydaybook_events`, RLS par utilisateur)
- Connexion : email + mot de passe (désactiver « Confirm email » dans Supabase › Authentication › Providers › Email)

## Mise en place Supabase
1. Exécuter `supabase/schema.sql` dans le SQL Editor.
2. Renseigner la clé publique (publishable / anon) dans `index.html` (`SUPABASE_KEY`).

Toutes les heures sont affichées à l'heure de Paris ; les dates sont stockées en UTC.
