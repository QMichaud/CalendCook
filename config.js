/* ============================================================
   CONFIGURATION — Mes Recettes
   ------------------------------------------------------------
   Ce fichier centralise les identifiants de synchronisation.
   Renseigne les trois valeurs ci-dessous pour que plusieurs
   appareils partagent les mêmes données (calendrier, recettes,
   liste de courses).

   Si tu laisses SUPABASE_URL et SUPABASE_KEY vides, l'application
   fonctionne quand même, mais chaque appareil garde ses propres
   données en local (pas de partage entre appareils).
   ============================================================ */
const APP_CONFIG = {

  // Adresse de ton projet Supabase (Project Settings → API → Project URL)
  SUPABASE_URL: 'https://daqvcpasenudmhwemsvk.supabase.co',        // ex. '[abcdefgh.supabase.co](https://abcdefgh.supabase.co)'

  // Clé publique "anon" de ton projet (Project Settings → API → anon public)
  // Ne JAMAIS mettre ici la clé "service_role".
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcXZjcGFzZW51ZG1od2Vtc3ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNDE5NTcsImV4cCI6MjEwNTkxNzk1N30.KmlIEt-DrYjKPttAEoN5JR62y54BrpKtta29CjVdXRk',        // ex. 'eyJhbGciOiJIUzI1NiIs...'

  // Identifiant de votre foyer / groupe. Doit être EXACTEMENT le même
  // sur tous les appareils pour qu'ils partagent les mêmes données.
  ROOM: 'foyerRatMic'

};
