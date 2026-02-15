// =============================================
// AgentVerse — Configuration
// =============================================
//
// Ce fichier contient les clés API nécessaires au
// fonctionnement de l'authentification Google et
// du paiement Stripe. Suivez les instructions
// ci-dessous pour les obtenir.
//
// ⚠️  Les clés ci-dessous sont des PLACEHOLDERS.
//     Le site fonctionne en mode démo tant qu'elles
//     ne sont pas remplacées par de vraies clés.
// =============================================

const CONFIG = {

    // ===========================================
    // GOOGLE SIGN-IN (OAuth 2.0)
    // ===========================================
    //
    // COMMENT OBTENIR VOTRE CLIENT ID GOOGLE :
    //
    // 1. Allez sur https://console.cloud.google.com/
    // 2. Créez un nouveau projet (ou sélectionnez-en un existant)
    // 3. Dans le menu latéral : "APIs & Services" > "Credentials"
    // 4. Cliquez "Create Credentials" > "OAuth client ID"
    // 5. Type d'application : "Web application"
    // 6. Nom : "AgentVerse" (ou ce que vous voulez)
    // 7. Origines JavaScript autorisées :
    //    - Pour le développement local : http://localhost
    //    - Pour la production : https://votre-domaine.com
    // 8. Cliquez "Create" et copiez le Client ID
    // 9. Collez-le ci-dessous à la place du placeholder
    //
    // Le Client ID ressemble à :
    // "123456789-abcdefg.apps.googleusercontent.com"
    //
    GOOGLE_CLIENT_ID: 'VOTRE_GOOGLE_CLIENT_ID_ICI',

    // ===========================================
    // STRIPE (Paiement sécurisé)
    // ===========================================
    //
    // COMMENT OBTENIR VOTRE CLÉ STRIPE :
    //
    // 1. Créez un compte sur https://stripe.com/fr
    // 2. Allez dans "Developers" > "API keys"
    //    (https://dashboard.stripe.com/test/apikeys)
    // 3. Copiez la "Publishable key" (clé publique)
    //    ⚠️  NE JAMAIS exposer la "Secret key" côté client !
    // 4. Collez la clé publique ci-dessous
    //
    // En mode TEST, la clé commence par "pk_test_..."
    // En mode PRODUCTION, elle commence par "pk_live_..."
    //
    // Pour tester les paiements en mode test, utilisez :
    //   - Carte : 4242 4242 4242 4242
    //   - Date : n'importe quelle date future
    //   - CVC : n'importe quels 3 chiffres
    //
    STRIPE_PUBLISHABLE_KEY: 'VOTRE_STRIPE_PUBLISHABLE_KEY_ICI',

    // ===========================================
    // NOTE IMPORTANTE — PRODUCTION
    // ===========================================
    //
    // Ce site est actuellement un frontend statique.
    // Pour la PRODUCTION avec de vrais paiements :
    //
    // 1. Vous aurez besoin d'un serveur backend
    //    (Node.js, Python, PHP...) pour créer des
    //    Stripe Checkout Sessions de manière sécurisée
    //    avec votre Secret Key.
    //
    // 2. Le flux sera :
    //    Frontend → appel API votre backend → Stripe API
    //    → Session créée → redirection client vers Stripe
    //
    // 3. Documentation Stripe Checkout :
    //    https://stripe.com/docs/checkout/quickstart
    //
    // En attendant, le mode démo simule le paiement
    // si la clé n'est pas configurée.
    //
};
