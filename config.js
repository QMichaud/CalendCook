/* ============================================================
   CONFIGURATION — Mes Recettes
   ------------------------------------------------------------
   Connexion à Supabase pour partager les données (calendrier,
   recettes, liste de courses) entre les membres d'un foyer.

   Chaque personne se connecte avec son adresse e-mail. Seules
   les adresses membres d'un foyer (table « foyer_membres ») peuvent
   lire ou modifier ses données : la clé ci-dessous peut donc être
   publique sans risque (voir supabase_setup.sql).

   Si tu laisses SUPABASE_URL et SUPABASE_KEY vides, l'application
   fonctionne quand même, mais chaque appareil garde ses propres
   données en local (pas de partage entre appareils).
   ============================================================ */
const APP_CONFIG = {

  // Adresse de ton projet Supabase (Project Settings → API → Project URL)
  SUPABASE_URL: 'https://daqvcpasenudmhwemsvk.supabase.co',

  // Clé publique "anon" de ton projet (Project Settings → API → anon public)
  // Ne JAMAIS mettre ici la clé "service_role".
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcXZjcGFzZW51ZG1od2Vtc3ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNDE5NTcsImV4cCI6MjEwNTkxNzk1N30.KmlIEt-DrYjKPttAEoN5JR62y54BrpKtta29CjVdXRk',

  // (Facultatif) Foyer ouvert par défaut quand une personne est membre
  // de plusieurs foyers. Les membres se gèrent depuis l'app (« Mon foyer »).
  ROOM: 'foyerRatMic'

};
